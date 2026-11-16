using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using QrPrinter.Agent.Config;
using QrPrinter.Agent.Hardware;
using QrPrinter.Agent.Logging;
using QrPrinter.Agent.Printing;

namespace QrPrinter.Agent.Net;

/// <summary>
/// The running agent: heartbeat, job channel, job queue, result retries.
///
/// Four loops over one connection story, because each covers a way a shop
/// network fails:
///   heartbeat  — proves this machine is alive even when there is no work
///   channel    — pushes work the instant it is queued
///   poll       — still prints when a router kills idle connections
///   retry      — a page that printed during a blip still gets reported
///
/// Concurrency is capped by config and defaults to one, because a single
/// printer fed two documents at once produces interleaved garbage.
/// </summary>
internal sealed class AgentRuntime : IAsyncDisposable
{
    private readonly AgentConfig _config;
    private readonly DeviceIdentity _identity;
    private readonly ApiClient _api;
    private readonly ResultOutbox _outbox = new();
    private readonly JobRunner _runner;
    private readonly AgentChannel _channel;
    private readonly SemaphoreSlim _slots;

    /// <summary>
    /// Job ids this process has already accepted or finished. The server may
    /// offer the same job twice — once over the socket and again to a poll that
    /// raced it — and printing a customer's document twice is not a bug we can
    /// afford to be innocent about.
    /// </summary>
    private readonly ConcurrentDictionary<string, byte> _seen = new(StringComparer.Ordinal);

    private readonly CancellationTokenSource _shutdown = new();
    private int _pollSeconds;

    /// <summary>
    /// Jobs being printed right now. Tracked separately from <see cref="_seen"/>,
    /// which also holds finished ones and so can never be used to decide whether
    /// it is safe to shut down.
    /// </summary>
    private int _inFlight;

    public AgentRuntime(AgentConfig config, DeviceIdentity identity)
    {
        _config = config;
        _identity = identity;
        _api = new ApiClient(config, identity);
        _runner = new JobRunner(config, identity, _api, _outbox);
        _slots = new SemaphoreSlim(Math.Max(1, config.MaxConcurrentJobs));
        _pollSeconds = Math.Max(config.HeartbeatSeconds, 5);
        _channel = new AgentChannel(config, identity, AcceptAsync);
    }

    /// <summary>
    /// Starts every loop and returns. Nothing here waits: the loops run for the
    /// life of the process.
    /// </summary>
    public void Start(CancellationToken external)
    {
        AgentPaths.EnsureDirectories();
        DocumentFetcher.SweepStale(_config.StaleSpoolHours);

        FileLog.Info(
            $"agent starting: device {_identity.DeviceId} · server {_config.ApiBaseUrl} " +
            $"· {_config.MaxConcurrentJobs} job slot(s)");

        // Linked so both a service stop and Ctrl+C reach every loop the same way.
        var cancel = CancellationTokenSource.CreateLinkedTokenSource(_shutdown.Token, external).Token;

        _ = LoopSafeAsync(HeartbeatLoopAsync(cancel), "heartbeat", cancel);
        _ = LoopSafeAsync(_channel.RunAsync(cancel), "channel", cancel);
        _ = LoopSafeAsync(PollLoopAsync(cancel), "poll", cancel);
        _ = LoopSafeAsync(RetryLoopAsync(cancel), "retry", cancel);
    }

    /// <summary>
    /// Blocks until <paramref name="external"/> is cancelled. The loops are
    /// fire-and-forget by design — losing one must not lose the others — so
    /// shutdown is driven by the token, not by awaiting a task that never ends.
    /// </summary>
    public Task WaitForShutdownAsync(CancellationToken external) => Task.Delay(Timeout.Infinite, external);

    public async Task StopAsync(TimeSpan? grace = null)
    {
        FileLog.Info("agent stopping");

        // Give already-accepted jobs a moment to reach their own final result.
        var deadline = DateTime.UtcNow + (grace ?? TimeSpan.FromSeconds(Math.Min(10, _config.PrintTimeoutSeconds)));
        while (Volatile.Read(ref _inFlight) > 0 && DateTime.UtcNow < deadline)
            await Task.Delay(200).ConfigureAwait(false);

        if (Volatile.Read(ref _inFlight) > 0)
            FileLog.Warn($"{Volatile.Read(ref _inFlight)} job(s) still printing when the agent was stopped");

        _shutdown.Cancel();
        await DisposeAsync().ConfigureAwait(false);
    }

    public async ValueTask DisposeAsync()
    {
        _shutdown.Cancel();
        await _channel.DisposeAsync().ConfigureAwait(false);
        _api.Dispose();
        _slots.Dispose();
    }

    /// <summary>
    /// The heartbeat this agent would send right now, exposed for `run --once`
    /// and for the bench test so nothing has to be serialised twice.
    /// </summary>
    public HeartbeatRequest PreviewHeartbeat() => BuildHeartbeat();

    /// <summary>
    /// Takes a job offer onto the queue. Returns immediately; the print happens
    /// on its own task so a slow device never blocks the channel's read loop.
    /// </summary>
    private async Task AcceptAsync(JobOffer offer)
    {
        var jobId = offer.JobId!;

        if (!_seen.TryAdd(jobId, 0))
        {
            FileLog.Debug($"job {jobId}: already accepted here, ignoring the repeat");
            return;
        }

        await _slots.WaitAsync().ConfigureAwait(false);
        Interlocked.Increment(ref _inFlight);
        _ = Task.Run(async () =>
        {
            try
            {
                await _runner.RunAsync(offer, _shutdown.Token).ConfigureAwait(false);
            }
            finally
            {
                Interlocked.Decrement(ref _inFlight);
                _slots.Release();
            }
        }, _shutdown.Token);
    }

    private async Task HeartbeatLoopAsync(CancellationToken cancel)
    {
        while (!cancel.IsCancellationRequested)
        {
            var heartbeat = BuildHeartbeat();
            var outcome = await _api.HeartbeatAsync(heartbeat, cancel).ConfigureAwait(false);

            if (outcome.IsSuccess)
            {
                var seconds = outcome.Value?.PollIntervalSeconds;
                if (seconds is > 0)
                    _pollSeconds = Math.Clamp(seconds!.Value, 5, 300);
            }
            else if (outcome.IsTerminal)
            {
                FileLog.Error($"heartbeat refused for good: {outcome.Error}. This agent must be re-paired.");
                return;
            }

            await DelayAsync(TimeSpan.FromSeconds(_config.HeartbeatSeconds), cancel).ConfigureAwait(false);
        }
    }

    /// <summary>
    /// The heartbeat payload is built fresh each time, straight from the
    /// spooler. A cached printer list is how a dashboard ends up offering a
    /// printer somebody unplugged an hour ago.
    /// </summary>
    private HeartbeatRequest BuildHeartbeat()
    {
        var scan = PrinterRepository.Scan();
        var spooler = ServiceProbe.Query("Spooler");

        return new HeartbeatRequest(
            _identity.DeviceId,
            _identity.MachineKey,
            AgentVersion.Value,
            Environment.MachineName,
            RuntimeInformation.OSDescription,
            spooler.Running,
            scan.Ok ? PrinterRepository.Selectable(scan).Select(PrinterWire.From).ToList() : [],
            scan.IncludesStatus,
            DateTimeOffset.UtcNow,
            // The spooler's own count of queued documents across every queue,
            // which is what makes "this shop is backed up" visible on the
            // dashboard without a job-by-job query.
            scan.Ok ? scan.Printers.Sum(printer => printer.QueueLength) : 0);
    }

    private async Task PollLoopAsync(CancellationToken cancel)
    {
        // A short first wait, then the server's own cadence: an agent that just
        // paired should show work immediately rather than after a heartbeat gap.
        await DelayAsync(TimeSpan.FromSeconds(3), cancel).ConfigureAwait(false);

        while (!cancel.IsCancellationRequested)
        {
            var outcome = await _api.PollJobsAsync(cancel).ConfigureAwait(false);
            if (outcome.IsSuccess && outcome.Value != null)
            {
                foreach (var offer in outcome.Value.Where(job => job.IsUsable))
                    await AcceptAsync(offer).ConfigureAwait(false);
            }
            else if (outcome.IsTerminal)
            {
                FileLog.Error($"poll refused for good: {outcome.Error}. This agent must be re-paired.");
                return;
            }

            await DelayAsync(TimeSpan.FromSeconds(_pollSeconds), cancel).ConfigureAwait(false);
        }
    }

    /// <summary>
    /// Re-sends results the server never acknowledged. This is what makes
    /// "uncertain" a rare answer rather than the default after one Wi-Fi blip.
    /// </summary>
    private async Task RetryLoopAsync(CancellationToken cancel)
    {
        await DelayAsync(TimeSpan.FromSeconds(5), cancel).ConfigureAwait(false);

        while (!cancel.IsCancellationRequested)
        {
            foreach (var pending in _outbox.Pending())
            {
                if (cancel.IsCancellationRequested)
                    break;

                var outcome = await _api.ReportAsync(pending, cancel).ConfigureAwait(false);
                if (outcome.IsSuccess)
                    _outbox.Remove(pending.JobId);
                else if (outcome.IsTerminal)
                    FileLog.Warn($"result for job {pending.JobId} will never be accepted: {outcome.Error}");
                // Anything else stays on disk for the next pass.
            }

            await DelayAsync(TimeSpan.FromSeconds(Math.Max(15, _config.HeartbeatSeconds)), cancel)
                .ConfigureAwait(false);
        }
    }

    /// <summary>
    /// Keeps a faulted loop from taking the process with it. The loop that dies
    /// stops doing its one job; the rest of the agent keeps printing.
    /// </summary>
    private async Task LoopSafeAsync(Task loop, string name, CancellationToken cancel)
    {
        try
        {
            await loop.ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancel.IsCancellationRequested)
        {
            FileLog.Debug($"{name} loop stopped");
        }
        catch (Exception error)
        {
            FileLog.Error($"{name} loop died unexpectedly", error);
        }
    }

    private static async Task DelayAsync(TimeSpan delay, CancellationToken cancel)
    {
        try
        {
            await Task.Delay(delay, cancel).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
        }
    }
}

using QrPrinter.Agent.Config;
using QrPrinter.Agent.Logging;

namespace QrPrinter.Agent.Net;

/// <summary>
/// Turning a pairing code from the dashboard into a stored device identity.
///
/// A code is single-use and short-lived by design: it is typed on a shop PC by
/// whoever is standing there, and after one exchange it is worthless, so a
/// shoulder-hacked code is a small window rather than a permanent credential.
/// The token that comes back is the long-lived secret and is stored under
/// %PROGRAMDATA% with a narrowed ACL.
/// </summary>
internal static class Pairing
{
    public static async Task<int> RunAsync(string[] args)
    {
        var code = args.FirstOrDefault(argument => !argument.StartsWith('-'));
        if (string.IsNullOrWhiteSpace(code))
        {
            Console.Error.WriteLine("usage: QrPrinterAgent pair <CODE> [--api https://host] [--socket wss://host]");
            return Program.ExitUsage;
        }

        var api = Flag(args, "--api") ?? ExistingConfig()?.ApiBaseUrl;
        var socket = Flag(args, "--socket") ?? ExistingConfig()?.AgentSocketUrl;

        if (api == null || socket == null)
        {
            Console.Error.WriteLine(
                "this machine has no config.json yet, so the server address has to be given:\n" +
                $"  QrPrinterAgent pair {code} --api https://your-server --socket wss://your-server/agent/channel");
            return Program.ExitUsage;
        }

        var config = new AgentConfig { ApiBaseUrl = api, AgentSocketUrl = socket, Label = Flag(args, "--label") ?? "" }.Validate();

        var machineKey = DeviceIdentity.ComputeMachineKey();
        Console.WriteLine($"pairing with {api}");
        Console.WriteLine($"machine key  {machineKey}  (per-machine, never document data)");

        using var client = new ApiClient(config, UnpairedPlaceholder);
        var outcome = await client.PairAsync(code, machineKey, AgentVersion.Value, CancellationToken.None)
            .ConfigureAwait(false);

        if (!outcome.IsSuccess)
        {
            Console.Error.WriteLine($"\ncould not pair: {outcome.Error}");
            Console.Error.WriteLine(
                "Check that the code is still valid on the dashboard, and that this machine can reach the server " +
                "(`QrPrinterAgent doctor` tests that).");
            return Program.ExitFailed;
        }

        var response = outcome.Value!;
        if (string.IsNullOrWhiteSpace(response.DeviceId) || string.IsNullOrWhiteSpace(response.Token))
        {
            Console.Error.WriteLine("\nthe server answered without a device id or token; nothing was saved.");
            return Program.ExitFailed;
        }

        var identity = new DeviceIdentity(
            response.DeviceId,
            response.Token,
            machineKey,
            DateTimeOffset.UtcNow);

        identity.Save();
        config.Save();

        Console.WriteLine($"\npaired as {response.DeviceId}");
        if (response.ShopName is { Length: > 0 })
            Console.WriteLine($"shop         {response.ShopName}");
        Console.WriteLine($"identity     {AgentPaths.IdentityFile}");
        Console.WriteLine();
        if (Hardware.ServiceProbe.Query(Service.ServiceHost.Name).Running)
        {
            Console.WriteLine("The agent service is still running with the previous pairing. Restart it to use this one");
            Console.WriteLine("(administrator window): QrPrinterAgent service restart");
            return Program.ExitOk;
        }

        Console.WriteLine("Next, either:");
        Console.WriteLine("  QrPrinterAgent run                watch it work in this window (Ctrl+C stops it)");
        Console.WriteLine("  QrPrinterAgent service install    start it with Windows (administrator window, from Program Files)");
        return Program.ExitOk;
    }

    /// <summary>
    /// Pairing has no identity yet, and <see cref="ApiClient"/> needs one to
    /// build its bearer header. This record exists solely so that the one
    /// unauthenticated call can go through the same client as every other.
    /// </summary>
    private static readonly DeviceIdentity UnpairedPlaceholder =
        new("(unset)", "(unset)", "(unset)", DateTimeOffset.UnixEpoch);

    private static AgentConfig? ExistingConfig()
    {
        try
        {
            return File.Exists(AgentPaths.ConfigFile) ? AgentConfig.Load() : null;
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"existing config.json ignored: {error.Message}");
            return null;
        }
    }

    private static string? Flag(string[] args, string name)
    {
        var index = Array.IndexOf(args, name);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }
}

/// <summary>
/// `QrPrinterAgent run` — the long-lived loop in a console window, for a person
/// who wants to watch the agent work. The service host runs the same runtime.
/// </summary>
internal static class Runner
{
    public static async Task<int> RunAsync(string[] args)
    {
        var once = args.Contains("--once");

        // Two agents on one device token would take turns evicting each other
        // from the job channel. --once is a probe and is allowed alongside.
        if (!once && Hardware.ServiceProbe.Query(Service.ServiceHost.Name).Running)
        {
            Console.Error.WriteLine(
                "The QrPrinterAgent service is already running on this PC, so this window would only compete with it.\n" +
                "Watch it with `QrPrinterAgent service status` and agent.log, or stop it first (administrator window):\n" +
                "  QrPrinterAgent service stop");
            return Program.ExitFailed;
        }

        AgentPaths.EnsureDirectories();
        FileLog.Open(AgentPaths.LogFile);

        DeviceIdentity? identity = null;
        try
        {
            identity = DeviceIdentity.Load();
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"device.json could not be read: {error.Message}");
        }

        if (identity == null)
        {
            Console.Error.WriteLine(
                "this device is not paired. Run `QrPrinterAgent pair <CODE>` from the dashboard first.");
            return Program.ExitFailed;
        }

        if (!File.Exists(AgentPaths.ConfigFile))
        {
            Console.Error.WriteLine(
                $"no config.json at {AgentPaths.ConfigFile}. Pair with --api and --socket, or write it by hand.");
            return Program.ExitFailed;
        }

        var config = AgentConfig.Load();
        var spooler = Hardware.ServiceProbe.Query("Spooler");
        if (!spooler.Running)
        {
            // Not fatal: the agent still starts, still heartbeats, and the
            // dashboard shows the shop the truth. Jobs will fail until it is up.
            Console.Error.WriteLine(
                $"warning: the Windows print spooler is {spooler}. Nothing will print until it runs (services.msc → Print Spooler).");
        }

        Console.WriteLine($"agent {AgentVersion.Value} · device {identity.DeviceId} · server {config.ApiBaseUrl}");
        Console.WriteLine($"logs {AgentPaths.LogFile} · spool {AgentPaths.SpoolDir}");
        if (once)
            Console.WriteLine("--once: running one heartbeat and one poll, then exiting");

        using var shutdown = new CancellationTokenSource();
        Console.CancelKeyPress += (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            shutdown.Cancel();
        };

        var runtime = new AgentRuntime(config, identity);

        if (once)
        {
            // The self-test path: prove the channel can be reached and one
            // heartbeat lands, without waiting for a real job.
            return await SelfTestAsync(runtime, config, identity, shutdown.Token).ConfigureAwait(false);
        }

        runtime.Start(shutdown.Token);
        try
        {
            await runtime.WaitForShutdownAsync(shutdown.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // The only normal way out of a console run.
        }

        await runtime.StopAsync().ConfigureAwait(false);
        return Program.ExitOk;
    }

    /// <summary>
    /// One heartbeat and one poll, printed plainly. Used by the bench test and
    /// by support ("run it with --once and send me the output").
    /// </summary>
    private static async Task<int> SelfTestAsync(
        AgentRuntime runtime,
        AgentConfig config,
        DeviceIdentity identity,
        CancellationToken cancel)
    {
        using var api = new ApiClient(config, identity);
        var heartbeat = await api.HeartbeatAsync(runtime.PreviewHeartbeat(), cancel).ConfigureAwait(false);

        Console.WriteLine();
        Console.WriteLine(heartbeat.IsSuccess
            ? $"heartbeat    ok · server time {heartbeat.Value?.ServerTime?.ToUniversalTime():yyyy-MM-dd HH:mm:ss}Z"
            : $"heartbeat    FAILED · {heartbeat.Error}");

        var jobs = await api.PollJobsAsync(cancel).ConfigureAwait(false);
        Console.WriteLine(jobs.IsSuccess
            ? $"pending jobs {jobs.Value?.Count ?? 0}"
            : $"pending jobs FAILED · {jobs.Error}");

        await runtime.DisposeAsync().ConfigureAwait(false);

        if (!heartbeat.IsSuccess)
            return Program.ExitFailed;

        if (jobs.IsSuccess && jobs.Value is { Count: > 0 } pending)
        {
            // Reporting what is waiting without printing it: --once is a
            // connectivity probe, and silently printing a backlog from a probe
            // would surprise whoever only meant to check the link.
            Console.WriteLine($"             queued: {string.Join(", ", pending.Select(job => job.JobId))}");
        }

        return Program.ExitOk;
    }
}

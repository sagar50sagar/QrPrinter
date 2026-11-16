using QrPrinter.Agent.Config;
using QrPrinter.Agent.Logging;
using QrPrinter.Agent.Printing;

namespace QrPrinter.Agent.Net;

/// <summary>
/// Runs one job from offer to reported result.
///
/// Two decisions in here that are easy to get wrong and expensive on a counter:
///
/// * A result is written to disk before it is sent. A page that printed while
///   the shop's internet blipped must not be reported as never having happened;
///   the outbox is flushed on the next connection.
/// * A document whose hash does not match the offer is destroyed, not printed.
///   Printing the wrong bytes is worse than printing nothing.
/// </summary>
internal sealed class JobRunner
{
    private readonly AgentConfig _config;
    private readonly DeviceIdentity _identity;
    private readonly ApiClient _api;
    private readonly ResultOutbox _outbox;

    public JobRunner(
        AgentConfig config,
        DeviceIdentity identity,
        ApiClient api,
        ResultOutbox outbox)
    {
        _config = config;
        _identity = identity;
        _api = api;
        _outbox = outbox;
    }

    /// <summary>
    /// Download, print, report. Never throws: the caller is a loop that has to
    /// stay alive for the next customer.
    /// </summary>
    public async Task RunAsync(JobOffer offer, CancellationToken cancel)
    {
        var jobId = offer.JobId!;
        FileLog.Info($"job {jobId}: accepted from {_config.AgentSocketUrl}");

        PrintResult result;
        try
        {
            result = await ExecuteAsync(offer, cancel).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            // The agent is shutting down mid-print. Honest answer is "unknown",
            // because the page may already be on its way out of the device.
            result = PrintResult.Uncertain(offer.Printer ?? "printer", "the agent stopped while this job was running");
            FileLog.Warn($"job {jobId}: interrupted — reported as uncertain");
        }
        catch (Exception error)
        {
            FileLog.Error($"job {jobId}: unexpected failure", error);
            result = PrintResult.Failed(offer.Printer ?? "printer", $"the agent could not complete this job: {error.Message}");
        }

        await ReportAsync(jobId, result, cancel).ConfigureAwait(false);
    }

    private async Task<PrintResult> ExecuteAsync(JobOffer offer, CancellationToken cancel)
    {
        if (!Uri.TryCreate(offer.DocumentUrl, UriKind.Absolute, out var documentUrl))
            return PrintResult.Rejected($"the job named a document address that is not a URL: {Mask(offer.DocumentUrl)}");

        var request = new PrintRequest(
            JobId: offer.JobId!,
            Printer: offer.Printer!,
            Copies: offer.Copies ?? 1,
            Duplex: offer.Duplex ?? false,
            Colour: offer.Colour ?? false,
            Paper: offer.Paper ?? "A4",
            PageRange: offer.PageRange);

        // Checked before the network is touched, so a bad request costs nothing.
        var (printer, rejection) = PrintJobExecutor.Inspect(request);
        if (rejection != null)
            return rejection;

        DownloadedDocument? document = null;
        try
        {
            document = await DocumentFetcher
                .FetchAsync(documentUrl, request.JobId, _config, cancel)
                .ConfigureAwait(false);

            FileLog.Info($"job {request.JobId}: received {document.Bytes} bytes");

            if (offer.Sha256 is { Length: > 0 } expected &&
                !string.Equals(expected, document.Sha256, StringComparison.OrdinalIgnoreCase))
            {
                // Destroyed rather than kept: the file is already staged under the
                // job id, and leaving it invites a later retry of the wrong bytes.
                DocumentFetcher.Discard(document);
                document = null;
                return PrintResult.Rejected(
                    "the document did not match the checksum the server sent, so it was discarded and not printed");
            }

            return await PrintJobExecutor
                .ExecuteAsync(request, document, _config, cancel)
                .ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            throw;
        }
        catch (Exception error)
        {
            FileLog.Warn($"job {request.JobId}: could not fetch the document — {error.Message}");
            return PrintResult.Failed(printer?.Name ?? request.Printer, $"the document could not be fetched: {error.Message}");
        }
        finally
        {
            DocumentFetcher.Discard(document);
        }
    }

    /// <summary>
    /// Stages the result on disk first, then tries to send it. A send that fails
    /// leaves the file behind for the next flush, so a printed page is never
    /// reported as missing.
    /// </summary>
    private async Task ReportAsync(string jobId, PrintResult result, CancellationToken cancel)
    {
        var payload = new JobResult(
            jobId,
            _identity.DeviceId,
            result.Status.ToString().ToLowerInvariant(),
            result.Stage,
            result.Detail,
            DateTimeOffset.UtcNow,
            result.CopiesPrinted);

        _outbox.Write(payload);
        FileLog.Info($"job {jobId}: {result.Status} at {result.Stage}, copies confirmed {result.CopiesPrinted}");

        var outcome = await _api.ReportAsync(payload, cancel).ConfigureAwait(false);
        if (outcome.IsSuccess)
        {
            _outbox.Remove(jobId);
            return;
        }

        if (outcome.WasCancelled)
            return;

        FileLog.Warn($"job {jobId}: result not acknowledged ({outcome.Error}); it stays queued for retry");
    }

    private static string Mask(string? value) =>
        value is { Length: <= 60 } ? value ?? "" : value![..40] + "…";
}

/// <summary>
/// Finished jobs waiting to be acknowledged, one JSON file each under
/// <c>%PROGRAMDATA%\QrPrinter Agent\outbox</c>.
///
/// A directory rather than one file so a crash mid-write cannot lose every
/// pending result, only the one being written. Files are tiny — a job id, four
/// short strings and a timestamp. No document content and no document name ever
/// lands here.
/// </summary>
internal sealed class ResultOutbox
{
    private static readonly object Gate = new();

    private string Directory => System.IO.Path.Combine(AgentPaths.Root, "outbox");

    public void Write(JobResult result)
    {
        lock (Gate)
        {
            try
            {
                System.IO.Directory.CreateDirectory(Directory);
                File.WriteAllText(Path(Directories.Safe(result.JobId)), Wire.Serialize(result));
            }
            catch (Exception error)
            {
                // Losing the pending-result record hurts, but losing the print
                // would hurt more, so this never propagates.
                FileLog.Error($"could not queue the result for job {result.JobId}", error);
            }
        }
    }

    public void Remove(string jobId)
    {
        lock (Gate)
        {
            try
            {
                var path = Path(Directories.Safe(jobId));
                if (File.Exists(path))
                    File.Delete(path);
            }
            catch (IOException error)
            {
                FileLog.Warn($"result for job {jobId} printed but could not be un-queued: {error.Message}");
            }
        }
    }

    /// <summary>Everything still waiting, oldest first.</summary>
    public IReadOnlyList<JobResult> Pending()
    {
        lock (Gate)
        {
            try
            {
                if (!System.IO.Directory.Exists(Directory))
                    return [];

                var found = new List<JobResult>();
                foreach (var path in new DirectoryInfo(Directory).EnumerateFiles("*.json"))
                {
                    var result = Wire.TryDeserialize<JobResult>(File.ReadAllText(path.FullName));
                    if (result?.JobId != null)
                        found.Add(result);
                }

                return found.OrderBy(JobResult => JobResult.FinishedAt).ToList();
            }
            catch (Exception error)
            {
                FileLog.Warn($"could not read the result queue: {error.Message}");
                return [];
            }
        }
    }

    private string Path(string name) => System.IO.Path.Combine(Directory, name + ".json");
}

internal static class Directories
{
    /// <summary>
    /// A job id arrives over the network, so it is reduced to the characters
    /// <see cref="Printing.PrintSettings.IsSafeJobId"/> allows before it becomes
    /// a file name. Anything else is replaced rather than trusted.
    /// </summary>
    public static string Safe(string value)
    {
        if (PrintSettings.IsSafeJobId(value))
            return value;

        var characters = new char[Math.Min(value.Length, 64)];
        for (var i = 0; i < characters.Length; i++)
        {
            var character = value[i];
            characters[i] = char.IsAsciiLetterOrDigit(character) || character is '_' or '-' ? character : '_';
        }

        return new string(characters);
    }
}

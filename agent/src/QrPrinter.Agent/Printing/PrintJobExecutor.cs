using QrPrinter.Agent.Config;
using QrPrinter.Agent.Hardware;
using QrPrinter.Agent.Logging;

namespace QrPrinter.Agent.Printing;

public enum PrintResultStatus
{
    /// <summary>The document reached the queue and the queue released it.</summary>
    Printed,

    /// <summary>
    /// The backend said it was done but the spooler never showed the job, or
    /// it is still there. The honest answer is "we do not know", which the
    /// dashboard must not render as success.
    /// </summary>
    Uncertain,

    /// <summary>Refused before anything was sent: bad request, unknown printer, no backend.</summary>
    Rejected,

    /// <summary>Something failed on the way through.</summary>
    Failed,
}

/// <summary>
/// One print attempt, told plainly. <see cref="Detail"/> is written for a shop
/// owner to read, so it names the printer and the stage, never document text.
/// </summary>
public sealed record PrintResult(PrintResultStatus Status, string Stage, string Detail)
{
    public bool Succeeded => Status == PrintResultStatus.Printed;

    /// <summary>
    /// Copies the spooler confirmed. When a job stops part way this is what came
    /// out, which the copy count that was asked for is not.
    /// </summary>
    public int CopiesPrinted { get; init; }

    public static PrintResult Printed(string printer, string detail) =>
        new(PrintResultStatus.Printed, printer, detail);

    public static PrintResult Uncertain(string printer, string detail) =>
        new(PrintResultStatus.Uncertain, printer, detail);

    public static PrintResult Rejected(string detail) => new(PrintResultStatus.Rejected, "request", detail);

    public static PrintResult Failed(string printer, string detail) =>
        new(PrintResultStatus.Failed, printer, detail);
}

/// <summary>
/// The whole print path for one job: validate, check the printer is there,
/// hand the PDF to the backend, then watch the spooler to find out what
/// actually happened.
///
/// Watching the queue is not decoration. A zero exit code only proves Sumatra
/// finished; it does not prove the device accepted the page. The spooler entry
/// appearing and then disappearing is the closest thing to evidence available
/// without talking to the device itself.
/// </summary>
public static class PrintJobExecutor
{
    /// <summary>
    /// Everything that can be decided before a single byte reaches a queue: is
    /// the request legal, does this machine have that printer, is it a real
    /// device, is it willing to take work.
    ///
    /// This is separate from the run itself so a caller can refuse honestly
    /// before telling anyone a page is coming out. A non-null
    /// <paramref name="allowVirtualQueue"/> escape exists for a bench with no
    /// device; a job arriving from the server never sets it.
    ///
    /// The contract is one-directional: a null <c>Rejection</c> means the
    /// printer is safe to send to, and any refusal returns a null printer so a
    /// caller can never read the two fields as contradictory.
    /// </summary>
    public static (PrinterReport? Printer, PrintResult? Rejection) Inspect(
        PrintRequest request,
        bool allowVirtualQueue = false)
    {
        try
        {
            PrintSettings.Validate(request);
        }
        catch (ArgumentException error)
        {
            return (null, PrintResult.Rejected(error.Message));
        }

        var printer = PrinterRepository.Find(request.Printer);
        if (printer == null)
        {
            return (null, PrintResult.Rejected(
                $"'{request.Printer}' is not installed on this machine. Run `QrPrinterAgent printers` to see the names."));
        }

        if (printer.Kind == PrinterKind.Loopback && !allowVirtualQueue)
        {
            return (null, PrintResult.Rejected(
                $"'{printer.Name}' is a virtual queue that writes to a file, not a device. Pick a real printer."));
        }

        if (printer.State is PrinterState.Offline or PrinterState.NeedsAttention)
        {
            return (null, PrintResult.Failed(
                printer.Name,
                $"{printer.Name} is {printer.State.ToString().ToLowerInvariant()}" +
                (printer.StateReason.Length > 0 ? $" ({printer.StateReason})" : "") +
                ". Fix that on the device, then send the job again."));
        }

        return (printer, null);
    }

    /// <summary>
    /// Prints every copy as its own submission, one after another, and stops at
    /// the first one the spooler does not confirm. Copies never run in parallel:
    /// each is recognised in the queue by the same document name, and two at
    /// once would be indistinguishable.
    /// </summary>
    public static async Task<PrintResult> ExecuteAsync(
        PrintRequest request,
        DownloadedDocument document,
        AgentConfig config,
        CancellationToken cancel = default,
        bool allowVirtualQueue = false)
    {
        var (printer, rejection) = Inspect(request, allowVirtualQueue);
        if (printer == null)
            return rejection!;

        var settings = PrintSettings.Build(request);
        var copies = request.Copies;
        FileLog.Info($"job {request.JobId}: to {printer.Name} with [{settings}] × {copies}");

        PrintResult? last = null;
        for (var copy = 1; copy <= copies; copy++)
        {
            var label = copies == 1 ? $"job {request.JobId}" : $"job {request.JobId} copy {copy}/{copies}";

            if (cancel.IsCancellationRequested)
            {
                return PrintResult.Failed(
                    printer.Name,
                    $"the agent stopped after {copy - 1} of {copies} copies; the rest were never sent.") with
                {
                    CopiesPrinted = copy - 1,
                };
            }

            PrintResult attempt;
            try
            {
                attempt = await SubmitOnceAsync(printer, label, request.JobId, settings, document.Path, config, cancel)
                    .ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                // Mid-copy, the page may already be on its way out of the device.
                FileLog.Warn($"{label}: interrupted");
                attempt = PrintResult.Uncertain(printer.Name, "the agent stopped before the queue confirmed the page.");
            }

            if (!attempt.Succeeded)
            {
                return copies == 1
                    ? attempt
                    : attempt with
                    {
                        Detail = $"copy {copy} of {copies}: {attempt.Detail} {AlreadyPrinted(copy - 1)}",
                        CopiesPrinted = copy - 1,
                    };
            }

            last = attempt;
        }

        return copies == 1
            ? last! with { CopiesPrinted = 1 }
            : PrintResult.Printed(
                printer.Name,
                $"{printer.Name} accepted all {copies} copies, each as its own queue job, and the queue cleared every one.") with
            {
                CopiesPrinted = copies,
            };
    }

    private static string AlreadyPrinted(int copies) => copies switch
    {
        0 => "No copy had printed yet.",
        1 => "1 copy had already printed.",
        _ => $"{copies} copies had already printed.",
    };

    /// <summary>
    /// One submission: hand the document to the backend, then watch the queue
    /// until the spooler releases it, refuses it, or a deadline passes.
    /// </summary>
    private static async Task<PrintResult> SubmitOnceAsync(
        PrinterReport printer,
        string label,
        string jobId,
        string settings,
        string documentPath,
        AgentConfig config,
        CancellationToken cancel)
    {
        var exePath = config.SumatraExe();
        var run = await Task.Run(
                () => SumatraPdfBackend.Submit(exePath, printer.Endpoint, settings, documentPath,
                    TimeSpan.FromSeconds(config.PrintTimeoutSeconds)),
                cancel)
            .ConfigureAwait(false);

        if (!run.Started)
        {
            FileLog.Warn($"{label}: backend did not start — {run.Detail}");
            return PrintResult.Failed(printer.Name, run.Detail);
        }

        if (run.TimedOut)
        {
            FileLog.Warn($"{label}: {run.Detail}");
            return PrintResult.Uncertain(printer.Name, run.Detail);
        }

        if (!run.Succeeded)
        {
            FileLog.Warn($"{label}: backend exit {run.ExitCode} — {run.Detail}");
            return PrintResult.Failed(printer.Name, $"{printer.Name}: the print backend stopped with code {run.ExitCode} ({run.Detail})");
        }

        var confirmation = await SpoolerJobs
            .WaitForDocumentAsync(
                printer.Endpoint,
                jobId,
                TimeSpan.FromSeconds(config.JobConfirmTimeoutSeconds),
                TimeSpan.FromSeconds(config.PrintTimeoutSeconds),
                cancel)
            .ConfigureAwait(false);

        FileLog.Info($"{label}: spooler said {confirmation.Outcome} — {confirmation.Detail}");

        return confirmation.Outcome switch
        {
            JobConfirmationOutcome.Completed => PrintResult.Printed(
                printer.Name,
                $"{printer.Name} accepted the job and the queue cleared it. {confirmation.Detail}"),
            JobConfirmationOutcome.Failed => PrintResult.Failed(printer.Name, confirmation.Detail),
            JobConfirmationOutcome.Blocked => PrintResult.Failed(
                printer.Name,
                $"{printer.Name} took the job but cannot finish it: {confirmation.Detail}"),
            JobConfirmationOutcome.Cancelled => PrintResult.Uncertain(printer.Name, confirmation.Detail),
            _ => PrintResult.Uncertain(
                printer.Name,
                $"{printer.Name}: {confirmation.Detail}. The page may still come out; check the device before reprinting."),
        };
    }

    /// <summary>Download then print. Used by the job loop and by test-print.</summary>
    public static async Task<PrintResult> ExecuteAsync(
        PrintRequest request,
        Uri documentUrl,
        AgentConfig config,
        CancellationToken cancel = default)
    {
        DownloadedDocument? document = null;
        try
        {
            document = await DocumentFetcher.FetchAsync(documentUrl, request.JobId, config, cancel)
                .ConfigureAwait(false);
            FileLog.Info($"job {request.JobId}: received {document.Bytes} bytes");
            return await ExecuteAsync(request, document, config, cancel).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
            return PrintResult.Uncertain(request.Printer, "stopped before the job finished");
        }
        catch (Exception error)
        {
            FileLog.Error($"job {request.JobId}: could not fetch the document", error);
            return PrintResult.Failed(request.Printer, $"could not fetch the document: {error.Message}");
        }
        finally
        {
            DocumentFetcher.Discard(document);
        }
    }

    /// <summary>
    /// Print a document that is already on this machine. This is how the print
    /// path gets checked on real hardware without a server.
    ///
    /// <paramref name="allowVirtualQueue"/> exists only for a bench with no
    /// device attached; nothing that reaches this class from the network can set
    /// it, so a remote job can never aim a customer document at Print to PDF.
    /// </summary>
    public static async Task<PrintResult> ExecuteLocalFileAsync(
        PrintRequest request,
        string localPdf,
        AgentConfig config,
        CancellationToken cancel = default,
        bool allowVirtualQueue = false)
    {
        var source = new FileInfo(localPdf);
        if (!source.Exists)
            return PrintResult.Rejected($"no file at {localPdf}");
        if (source.Length > config.MaxDocumentBytes)
            return PrintResult.Rejected(
                $"this file is {source.Length} bytes and the limit is {config.MaxDocumentBytes}");

        Directory.CreateDirectory(AgentPaths.SpoolDir);
        var staged = Path.Combine(AgentPaths.SpoolDir, PrintSettings.SpoolFileName(request.JobId));
        File.Copy(localPdf, staged, overwrite: true);

        try
        {
            return await ExecuteAsync(
                request,
                new DownloadedDocument(staged, source.Length, "(local file)"),
                config,
                cancel,
                allowVirtualQueue).ConfigureAwait(false);
        }
        finally
        {
            DocumentFetcher.Discard(new DownloadedDocument(staged, 0, ""));
        }
    }
}

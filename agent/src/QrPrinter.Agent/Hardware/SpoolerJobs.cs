using QrPrinter.Agent.Printing;

namespace QrPrinter.Agent.Hardware;

/// <summary>One document sitting in a printer queue, as winspool reports it.</summary>
public sealed record SpoolerJob
{
    public required uint JobId { get; init; }
    public required string Document { get; init; }
    public string? StatusText { get; init; }
    public string? SubmittedBy { get; init; }
    public uint StatusBits { get; init; }
    public uint Position { get; init; }
    public uint PagesPrinted { get; init; }
    public uint TotalPages { get; init; }

    public JobStatus Status => (JobStatus)StatusBits;

    /// <summary>
    /// The spooler's own verdict that this job is finished. DELETED means the
    /// entry is on its way out; PRINTED and COMPLETE mean the pages went.
    /// </summary>
    public bool IsFinished =>
        Status.HasFlag(JobStatus.Deleted) ||
        Status.HasFlag(JobStatus.Printed) ||
        Status.HasFlag(JobStatus.Complete);

    public bool IsBlocked =>
        Status.HasFlag(JobStatus.Error) ||
        Status.HasFlag(JobStatus.UserIntervention) ||
        Status.HasFlag(JobStatus.PaperOut) ||
        Status.HasFlag(JobStatus.Offline) ||
        Status.HasFlag(JobStatus.BlockedDevq);

    /// <summary>
    /// True when this is the document the agent submitted for
    /// <paramref name="jobId"/>. The spooler shows the file name as the document
    /// title and the agent always names it QP-&lt;job id&gt;.pdf.
    /// </summary>
    public bool BelongsTo(string jobId) =>
        Document.Contains(PrintSettings.Prefix, StringComparison.Ordinal) &&
        Document.Contains(jobId, StringComparison.Ordinal);
}

/// <summary>
/// One read of a queue. <see cref="Truncated"/> means Windows reported more
/// entries than the buffer could hold at our struct size, which is the signal
/// that the layout assumption is wrong — never something to print as success.
/// </summary>
public sealed record QueueRead(IReadOnlyList<SpoolerJob> Jobs, int Win32Error, bool Truncated)
{
    public bool Usable => Win32Error == 0 && !Truncated;
}

/// <summary>Reads the live queue of one printer.</summary>
public static class SpoolerJobs
{
    /// <summary>
    /// Snapshot of the queue. A printer that cannot be opened yields an empty
    /// list plus the Win32 code, so the caller can tell "no jobs" from "no access".
    /// </summary>
    public static QueueRead Read(string printerName)
    {
        var collected = new List<SpoolerJob>();
        var truncated = false;
        var enumError = 0;

        var opened = WinSpool.WithPrinterHandle(printerName, handle =>
        {
            var ok = WinSpool.TryEnumerate(
                (size, buffer) =>
                {
                    var call = WinSpool.EnumJobsW(
                        handle, 0, uint.MaxValue, WinSpool.Level1, buffer, size, out var needed, out var returned);
                    return (call, needed, returned);
                },
                (buffer, count, bytes) =>
                {
                    for (var i = 0; i < (int)count; i++)
                    {
                        if (!WinSpool.FitsIn<WinSpool.JobInfo1>(i, bytes))
                        {
                            truncated = true;
                            break;
                        }

                        var job = WinSpool.ReadEntry<WinSpool.JobInfo1>(buffer, i).ToJob();
                        if (job.JobId != 0)
                            collected.Add(job);
                    }
                },
                out enumError);

            return ok;
        }, out var openError);

        return !opened
            ? new QueueRead([], openError, false)
            : new QueueRead(collected, enumError, truncated);
    }

    /// <summary>
    /// Watch the queue for the document this job created: first that it appears,
    /// then that it leaves. Returns as soon as either happens or a deadline hits.
    /// </summary>
    public static async Task<JobConfirmation> WaitForDocumentAsync(
        string printerName,
        string jobId,
        TimeSpan confirmTimeout,
        TimeSpan overallTimeout,
        CancellationToken cancel)
    {
        var started = DateTime.UtcNow;
        var deadline = started + overallTimeout;
        var seen = false;
        SpoolerJob? last = null;

        while (DateTime.UtcNow < deadline && !cancel.IsCancellationRequested)
        {
            var read = Read(printerName);
            if (!read.Usable)
            {
                return read.Truncated
                    ? JobConfirmation.Failed(
                        "the queue could not be read safely: Windows reported more jobs than the buffer held, " +
                        "so the job layout this build assumes is wrong on this machine")
                    : JobConfirmation.Failed($"cannot read the queue: {WinSpool.DescribeError(read.Win32Error)}");
            }

            var mine = read.Jobs.FirstOrDefault(job => job.BelongsTo(jobId));
            if (mine != null)
            {
                seen = true;
                last = mine;

                if (mine.IsBlocked)
                {
                    return JobConfirmation.Blocked(
                        mine.StatusText ?? $"queue reports 0x{mine.StatusBits:X8}",
                        mine.PagesPrinted,
                        mine.TotalPages);
                }
            }
            else if (seen)
            {
                // It was in the queue and now it is gone: the spooler drops the
                // entry once the document has been handed to the driver.
                return JobConfirmation.Completed(
                    last?.PagesPrinted ?? 0,
                    last?.TotalPages ?? 0,
                    last?.StatusText);
            }
            else if (DateTime.UtcNow - started > confirmTimeout)
            {
                return JobConfirmation.TimedOut(
                    $"the spooler never showed a job for {jobId} within {(int)confirmTimeout.TotalSeconds}s");
            }

            await Task.Delay(TimeSpan.FromSeconds(1), cancel).ConfigureAwait(false);
        }

        return cancel.IsCancellationRequested
            ? JobConfirmation.Cancelled()
            : JobConfirmation.TimedOut($"the queue did not finish within {(int)overallTimeout.TotalSeconds}s");
    }
}

/// <summary>Result of watching the spooler for one submitted document.</summary>
public sealed record JobConfirmation(
    JobConfirmationOutcome Outcome,
    string Detail,
    uint PagesPrinted,
    uint TotalPages)
{
    public bool Succeeded => Outcome == JobConfirmationOutcome.Completed;

    public static JobConfirmation Completed(uint printed, uint total, string? statusText) => new(
        JobConfirmationOutcome.Completed,
        $"spooler released the document ({printed}/{total} pages)" +
        (statusText is { Length: > 0 } ? $", last status: {statusText}" : ""),
        printed,
        total);

    public static JobConfirmation Blocked(string statusText, uint printed, uint total) =>
        new(JobConfirmationOutcome.Blocked, $"the queue is holding the job: {statusText}", printed, total);

    public static JobConfirmation Failed(string detail) => new(JobConfirmationOutcome.Failed, detail, 0, 0);

    public static JobConfirmation TimedOut(string detail) => new(JobConfirmationOutcome.TimedOut, detail, 0, 0);

    public static JobConfirmation Cancelled() =>
        new(JobConfirmationOutcome.Cancelled, "stopped before the queue confirmed the job", 0, 0);
}

public enum JobConfirmationOutcome
{
    Completed,
    Blocked,
    Failed,
    TimedOut,
    Cancelled,
}

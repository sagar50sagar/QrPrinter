using System.Text.RegularExpressions;

namespace QrPrinter.Agent.Printing;

/// <summary>
/// What the server asked for on one print job.
/// </summary>
/// <param name="Copies">1..99; the agent submits the document this many times, one queue job each.</param>
/// <param name="Duplex">Long-edge, which is what "double sided" means for a portrait document.</param>
/// <param name="Colour">False asks the driver for grayscale.</param>
/// <param name="Paper">A size name, validated against a whitelist.</param>
/// <param name="PageRange">"1-4" style, or null for all pages.</param>
public sealed record PrintRequest(
    string JobId,
    string Printer,
    int Copies = 1,
    bool Duplex = false,
    bool Colour = false,
    string Paper = "A4",
    string? PageRange = null);

/// <summary>
/// Builds the SumatraPDF `-print-settings` value.
///
/// The rule that matters: nothing from the network reaches the printer command
/// line as free text. Every field is checked here and anything unrecognised is
/// a hard error, because a job payload is data, not instructions.
/// </summary>
public static class PrintSettings
{
    /// <summary>Names Windows and Sumatra agree on for the shops we are targeting.</summary>
    private static readonly HashSet<string> AllowedPaper = new(StringComparer.OrdinalIgnoreCase)
    {
        "A3", "A4", "A5", "B4", "B5", "Legal", "Letter", "Tabloid",
    };

    private static readonly Regex PageRangePattern = new(@"^\d{1,5}(-\d{1,5})?(,\d{1,5}(-\d{1,5})?)*$", RegexOptions.Compiled);

    public static PrintRequest Validate(PrintRequest request)
    {
        if (string.IsNullOrWhiteSpace(request.JobId))
            throw new ArgumentException("a job id is required");
        if (!IsSafeJobId(request.JobId))
            throw new ArgumentException($"job id {Mask(request.JobId)} is not a safe file name");
        if (string.IsNullOrWhiteSpace(request.Printer))
            throw new ArgumentException("no printer was named for this job");
        if (request.Printer.Length > 255 || ContainsControlCharacter(request.Printer))
            throw new ArgumentException("printer name is too long or contains control characters");
        if (request.Copies is < 1 or > 99)
            throw new ArgumentException($"copies must be 1..99, got {request.Copies}");
        if (!AllowedPaper.Contains(request.Paper))
            throw new ArgumentException($"paper '{request.Paper}' is not one of {string.Join(", ", AllowedPaper)}");
        if (request.PageRange is { Length: > 0 } && !PageRangePattern.IsMatch(request.PageRange))
            throw new ArgumentException($"page range '{request.PageRange}' is not a list of page numbers");

        return request;
    }

    /// <summary>
    /// The value for Sumatra's -print-settings flag, for one submission.
    /// </summary>
    /// <remarks>
    /// These four tokens are the ones whose spelling we are confident about, so
    /// they are the only ones emitted. Page range and orientation stay out of
    /// v1: an unsupported token is silently ignored by Sumatra, which would look
    /// like a successful print of the wrong pages. Verify against the pinned
    /// build first, then add them here with a test.
    ///
    /// Copies is pinned to 1 on purpose. A driver is free to ignore the copy
    /// count, and the bench caught one doing exactly that: asked for two, one
    /// came out, and the spooler still reported success. The executor repeats
    /// the submission instead, so every copy is its own job the spooler has to
    /// confirm. The explicit 1 also overrides a copy count left in the driver's
    /// own defaults.
    /// </remarks>
    public static string Build(PrintRequest request)
    {
        Validate(request);

        var parts = new List<string>(4) { "copies=1" };

        if (request.Duplex)
            parts.Add("duplex=long");

        parts.Add($"paper={request.Paper}");
        parts.Add(request.Colour ? "color" : "mono");

        return string.Join(",", parts);
    }

    public static bool IsSafeJobId(string jobId) => Regex.IsMatch(jobId, @"^[A-Za-z0-9_-]{1,64}$");

    /// <summary>
    /// The file name prefix the agent gives every document it spools. The
    /// spooler shows this as the job's document title, which is how the agent
    /// recognises its own job in a queue that also has walk-in printouts.
    /// </summary>
    public const string Prefix = "QP-";

    /// <summary>
    /// The file name the document is spooled under.
    /// </summary>
    public static string SpoolFileName(string jobId) => $"{Prefix}{jobId}.pdf";

    private static bool ContainsControlCharacter(string value)
    {
        foreach (var character in value)
        {
            if (char.IsControl(character) || character == '"')
                return true;
        }

        return false;
    }

    private static string Mask(string value) =>
        value.Length <= 12 ? value : value[..6] + "…" + value[^3..];
}

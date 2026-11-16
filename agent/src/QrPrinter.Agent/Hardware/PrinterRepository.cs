namespace QrPrinter.Agent.Hardware;

/// <summary>The result of one walk over the local print configuration.</summary>
public sealed record PrinterScan
{
    public required IReadOnlyList<PrinterReport> Printers { get; init; }

    /// <summary>False when even the name list could not be read.</summary>
    public required bool Ok { get; init; }

    public int Win32Error { get; init; }
    public string? ErrorDetail { get; init; }

    /// <summary>
    /// True when PRINTER_INFO_2 was granted. When false, state and queue length
    /// are unknown for every printer and the report says so instead of claiming
    /// Ready.
    /// </summary>
    public bool IncludesStatus { get; init; }

    public static PrinterScan Failed(int error, string detail) => new()
    {
        Printers = [],
        Ok = false,
        Win32Error = error,
        ErrorDetail = detail,
    };
}

/// <summary>
/// Enumerates the printers this machine knows about.
///
/// Level 2 is the normal path because it carries status, port and driver. If
/// the account is too restricted for level 2, level 4 still lists names and
/// nothing else, and that limit is reported rather than papered over.
/// </summary>
public static class PrinterRepository
{
    public static PrinterScan Scan()
    {
        var level2 = ScanLevel2(out var error);
        if (level2 != null)
            return level2;

        if (error is not (WinSpool.ErrorAccessDenied or WinSpool.ErrorInvalidLevel or WinSpool.ErrorInvalidParameter))
        {
            // Anything else means the spooler itself is unreachable. The caller
            // must surface that as "printer list unknown", never as "none".
            return PrinterScan.Failed(error, WinSpool.DescribeError(error));
        }

        var level4 = ScanLevel4(out var fallbackError);
        if (level4 != null)
            return level4;

        return PrinterScan.Failed(
            fallbackError != 0 ? fallbackError : error,
            $"level 2 refused ({WinSpool.DescribeError(error)}), level 4 refused ({WinSpool.DescribeError(fallbackError)})");
    }

    /// <summary>Find a printer by name, ignoring case and the \\server prefix.</summary>
    public static PrinterReport? Find(string nameOrEndpoint)
    {
        var scan = Scan();
        if (!scan.Ok)
            return null;

        return scan.Printers.FirstOrDefault(printer =>
            string.Equals(printer.Name, nameOrEndpoint, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(printer.Endpoint, nameOrEndpoint, StringComparison.OrdinalIgnoreCase) ||
            string.Equals(printer.ShareName, nameOrEndpoint, StringComparison.OrdinalIgnoreCase));
    }

    /// <summary>
    /// Printers worth offering a customer. A virtual queue is excluded because
    /// sending a real document there silently produces nothing on paper, and a
    /// hidden queue is not the shop's to pick.
    /// </summary>
    /// <remarks>
    /// Takes an existing <see cref="PrinterScan"/> rather than scanning again:
    /// every caller has already paid for the enumeration.
    /// </remarks>
    public static IReadOnlyList<PrinterReport> Selectable(PrinterScan scan) =>
        scan.Printers.Where(printer => printer.Kind != PrinterKind.Loopback && !printer.IsHidden).ToList();

    /// <summary>
    /// Mark the printer Windows itself calls the default. The Attributes bit is
    /// not trustworthy here — see <see cref="WinSpool.GetDefaultPrinterName"/>.
    /// </summary>
    private static void ApplyDefaultPrinter(List<PrinterReport> printers)
    {
        var defaultName = WinSpool.GetDefaultPrinterName();
        if (string.IsNullOrEmpty(defaultName))
            return;

        for (var i = 0; i < printers.Count; i++)
        {
            if (string.Equals(printers[i].Name, defaultName, StringComparison.OrdinalIgnoreCase))
                printers[i] = printers[i] with { IsDefault = true, DefaultSource = "GetDefaultPrinter" };
        }
    }

    private static PrinterScan? ScanLevel2(out int win32Error)
    {
        var found = new List<PrinterReport>();
        var truncated = false;

        var ok = WinSpool.TryEnumerate(
            (size, buffer) =>
            {
                var call = WinSpool.EnumPrintersW(
                    WinSpool.EnumFlags, null, WinSpool.Level2, buffer, size, out var needed, out var returned);
                return (call, needed, returned);
            },
            (buffer, count, bytes) =>
            {
                for (var i = 0; i < (int)count; i++)
                {
                    if (!WinSpool.FitsIn<WinSpool.PrinterInfo2>(i, bytes))
                    {
                        truncated = true;
                        break;
                    }

                    var report = WinSpool.ReadEntry<WinSpool.PrinterInfo2>(buffer, i).ToReport();
                    if (report.Name.Length > 0)
                        found.Add(report);
                }
            },
            out win32Error);

        if (!ok)
            return null;

        ApplyDefaultPrinter(found);
        found.Sort(static (a, b) => string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase));
        return new PrinterScan
        {
            Printers = found,
            Ok = true,
            IncludesStatus = true,
            ErrorDetail = truncated
                ? "the spooler reported more printers than the buffer could hold; the list is incomplete"
                : found.Count == 0
                    ? "the spooler answered, but this machine has no printers installed"
                    : null,
        };
    }

    private static PrinterScan? ScanLevel4(out int win32Error)
    {
        var found = new List<PrinterReport>();
        var truncated = false;

        var ok = WinSpool.TryEnumerate(
            (size, buffer) =>
            {
                var call = WinSpool.EnumPrintersW(
                    WinSpool.EnumFlags, null, WinSpool.Level4, buffer, size, out var needed, out var returned);
                return (call, needed, returned);
            },
            (buffer, count, bytes) =>
            {
                for (var i = 0; i < (int)count; i++)
                {
                    if (!WinSpool.FitsIn<WinSpool.PrinterInfo4>(i, bytes))
                    {
                        truncated = true;
                        break;
                    }

                    var report = WinSpool.ReadEntry<WinSpool.PrinterInfo4>(buffer, i).ToReport();
                    if (report.Name.Length > 0)
                        found.Add(report);
                }
            },
            out win32Error);

        if (!ok)
            return null;

        ApplyDefaultPrinter(found);
        found.Sort(static (a, b) => string.Compare(a.Name, b.Name, StringComparison.OrdinalIgnoreCase));
        return new PrinterScan
        {
            Printers = found,
            Ok = true,
            IncludesStatus = false,
            ErrorDetail = truncated
                ? "the spooler reported more printers than the buffer could hold; the list is incomplete"
                : "only printer names are readable for this account",
        };
    }
}

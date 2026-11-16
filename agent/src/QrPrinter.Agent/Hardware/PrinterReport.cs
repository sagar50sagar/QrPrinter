namespace QrPrinter.Agent.Hardware;

public enum PrinterState
{
    /// <summary>Idle and accepting work.</summary>
    Ready,

    /// <summary>Spooler is actively feeding the device.</summary>
    Busy,

    /// <summary>Reported offline by the spooler or marked work-offline.</summary>
    Offline,

    /// <summary>Jam, out of paper, no toner, door open, or a generic device error.</summary>
    NeedsAttention,

    /// <summary>Paused by a user or by the queue.</summary>
    Paused,

    /// <summary>Could not be read — never guess here.</summary>
    Unknown,
}

/// <summary>
/// How the printer is attached, as far as the spooler is willing to say.
/// Advisory for the dashboard; it never decides whether a job may be sent.
/// </summary>
public enum PrinterKind
{
    Local,
    Network,
    Shared,
    Loopback,
    Unknown,
}

/// <summary>
/// One printer as the agent sees it. Everything here came from winspool on this
/// machine just now — nothing is inferred from a driver name or vendor string.
/// </summary>
public sealed record PrinterReport
{
    public required string Name { get; init; }
    public string? Server { get; init; }
    public string? Port { get; init; }
    public string? Driver { get; init; }
    public string? Location { get; init; }
    public string? ShareName { get; init; }
    public bool IsDefault { get; init; }
    public bool Shared { get; init; }
    public bool IsHidden { get; init; }

    /// <summary>
    /// Which API said this was the default printer, so a wrong answer can be
    /// traced. Null when no API claimed it.
    /// </summary>
    public string? DefaultSource { get; init; }
    public PrinterKind Kind { get; init; } = PrinterKind.Unknown;
    public PrinterState State { get; init; } = PrinterState.Unknown;
    public uint RawStatus { get; init; }
    public uint RawAttributes { get; init; }
    public int QueueLength { get; init; }

    /// <summary>Human-readable reason for State, decoded from the status bits.</summary>
    public string StateReason { get; init; } = "";

    /// <summary>
    /// The key the server stores. A printer pulled from a share is addressed as
    /// \\server\name and that form is what OpenPrinter wants back.
    /// </summary>
    public string Endpoint => Server is { Length: > 0 } ? $@"{Server}\{Name}" : Name;

    public override string ToString()
    {
        var line = $"{Name,-34} {State,-13}";
        if (QueueLength > 0)
            line += $"queue {QueueLength,-3} ";
        if (Port is { Length: > 0 })
            line += $"port {Port,-18} ";
        if (Driver is { Length: > 0 })
            line += $"driver {Truncate(Driver, 40)}";
        if (StateReason is { Length: > 0 })
            line += $"  ({StateReason})";
        return line.TrimEnd();
    }

    private static string Truncate(string text, int max) =>
        text.Length <= max ? text : text[..max] + "…";
}

/// <summary>
/// Turns a PRINTER_INFO_2 status bitmask into one state plus a reason string.
/// </summary>
public static class PrinterStateDecoder
{
    /// <summary>Walked first to last; the first hit decides the state.</summary>
    private static readonly (PrinterStatus Bit, PrinterState State, string Reason)[] Ordered =
    [
        (PrinterStatus.PaperJam, PrinterState.NeedsAttention, "paper jam"),
        (PrinterStatus.PaperOut, PrinterState.NeedsAttention, "out of paper"),
        (PrinterStatus.PaperProblem, PrinterState.NeedsAttention, "paper problem"),
        (PrinterStatus.ManualFeed, PrinterState.NeedsAttention, "manual feed needed"),
        (PrinterStatus.NoToner, PrinterState.NeedsAttention, "no toner"),
        (PrinterStatus.OutputBinFull, PrinterState.NeedsAttention, "output bin full"),
        (PrinterStatus.OutOfMemory, PrinterState.NeedsAttention, "device out of memory"),
        (PrinterStatus.UserIntervention, PrinterState.NeedsAttention, "user intervention needed"),
        (PrinterStatus.PagePunt, PrinterState.NeedsAttention, "page cannot be printed"),
        (PrinterStatus.DoorOpen, PrinterState.NeedsAttention, "door open"),
        (PrinterStatus.Error, PrinterState.NeedsAttention, "device error"),
        (PrinterStatus.ServerUnknown, PrinterState.Offline, "status unknown to the server"),
        (PrinterStatus.NotAvailable, PrinterState.Offline, "not available"),
        (PrinterStatus.Offline, PrinterState.Offline, "offline"),
        (PrinterStatus.Paused, PrinterState.Paused, "paused"),
        (PrinterStatus.PendingDeletion, PrinterState.Paused, "pending deletion"),
        (PrinterStatus.Printing, PrinterState.Busy, "printing"),
        (PrinterStatus.Processing, PrinterState.Busy, "processing"),
        (PrinterStatus.IoActive, PrinterState.Busy, "sending data"),
        (PrinterStatus.Busy, PrinterState.Busy, "busy"),
        (PrinterStatus.WarmingUp, PrinterState.Busy, "warming up"),
        (PrinterStatus.Initializing, PrinterState.Busy, "initialising"),
        (PrinterStatus.PowerSave, PrinterState.Busy, "power save"),
        (PrinterStatus.TonerLow, PrinterState.Ready, "toner low"),
        (PrinterStatus.Waiting, PrinterState.Ready, "waiting"),
    ];

    public static (PrinterState State, string Reason) Decode(uint statusBits, PrinterAttributes attributes)
    {
        if (attributes.HasFlag(PrinterAttributes.WorkOffline))
            return (PrinterState.Offline, "marked offline in Windows");

        var matched = new List<string>(3);
        PrinterState? state = null;

        foreach (var (bit, candidate, reason) in Ordered)
        {
            if ((statusBits & (uint)bit) == 0)
                continue;

            state ??= candidate;
            if (matched.Count < 3)
                matched.Add(reason);
        }

        if (state == null)
        {
            // Status 0 is what these queues report when healthy and idle — both
            // printers here returned 0x00000000. Anything unrecognised stays
            // Unknown instead of being dressed up as Ready.
            if (statusBits == 0)
                return (PrinterState.Ready, "");

            return (PrinterState.Unknown, $"unrecognised status bits 0x{statusBits:X8}");
        }

        return (state.Value, string.Join(", ", matched));
    }

    public static PrinterKind DecodeKind(PrinterAttributes attributes, string? server, string? port)
    {
        if (!string.IsNullOrEmpty(server))
            return PrinterKind.Shared;

        // Virtual queues that write to a file or a save dialog are not devices.
        if (port is { Length: > 0 })
        {
            if (port.Equals("PORTPROMPT:", StringComparison.OrdinalIgnoreCase) ||
                port.Equals("NUL:", StringComparison.OrdinalIgnoreCase) ||
                port.Equals("FILE:", StringComparison.OrdinalIgnoreCase) ||
                port.Equals("USER:", StringComparison.OrdinalIgnoreCase) ||
                port.Equals("DISP:", StringComparison.OrdinalIgnoreCase) ||
                port.StartsWith("MOTP:", StringComparison.OrdinalIgnoreCase))
            {
                return PrinterKind.Loopback;
            }

            if (port.StartsWith("WSD-", StringComparison.OrdinalIgnoreCase) ||
                port.Contains(":9100", StringComparison.Ordinal) ||
                port.Contains("LPR", StringComparison.OrdinalIgnoreCase) ||
                IsIpv4Port(port))
            {
                return PrinterKind.Network;
            }

            if (port.StartsWith("USB", StringComparison.OrdinalIgnoreCase) ||
                port.StartsWith("LPT", StringComparison.OrdinalIgnoreCase) ||
                port.StartsWith("COM", StringComparison.OrdinalIgnoreCase))
            {
                return PrinterKind.Local;
            }
        }

        if (attributes.HasFlag(PrinterAttributes.Network))
            return PrinterKind.Network;
        if (attributes.HasFlag(PrinterAttributes.Local) || attributes.HasFlag(PrinterAttributes.Direct))
            return PrinterKind.Local;

        return PrinterKind.Unknown;
    }

    /// <summary>Port names shaped like "192.168.1.20" or "192.168.1.20:9100".</summary>
    private static bool IsIpv4Port(string port)
    {
        var host = port.Split(':')[0];
        var parts = host.Split('.');
        if (parts.Length != 4)
            return false;

        foreach (var part in parts)
        {
            if (part.Length == 0 || part.Length > 3 || !part.All(char.IsDigit))
                return false;
        }

        return true;
    }
}

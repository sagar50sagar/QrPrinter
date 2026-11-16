using System.ComponentModel;
using System.Runtime.InteropServices;

namespace QrPrinter.Agent.Hardware;

/// <summary>
/// PRINTER_ATTRIBUTE_* exactly as winspool.h defines them.
///
/// Calibrated against this machine: the two installed virtual queues report
/// 0x240 and 0x244, and the only difference is 0x4 — the one that is the
/// Windows default printer. Every WMI boolean (Queued, Direct, Shared,
/// Network, Hidden, RawOnly, Published, WorkOffline, KeepPrintedJobs) reads
/// False on both, which is what these values predict.
/// </summary>
[Flags]
public enum PrinterAttributes : uint
{
    None = 0,
    Queued = 0x00000001,
    Direct = 0x00000002,
    Default = 0x00000004,
    Shared = 0x00000008,
    Network = 0x00000010,
    Hidden = 0x00000020,
    Local = 0x00000040,
    EnableDevq = 0x00000080,
    KeepPrintedJobs = 0x00000100,
    DoCompleteFirst = 0x00000200,
    WorkOffline = 0x00000400,
    EnableBidi = 0x00000800,
    RawOnly = 0x00001000,
    Published = 0x00002000,
    Fax = 0x00004000,
}

/// <summary>PRINTER_STATUS_* from winspool.h, for PRINTER_INFO_2.Status.</summary>
[Flags]
public enum PrinterStatus : uint
{
    None = 0,
    Paused = 0x00000001,
    Error = 0x00000002,
    PendingDeletion = 0x00000004,
    PaperJam = 0x00000008,
    PaperOut = 0x00000010,
    ManualFeed = 0x00000020,
    PaperProblem = 0x00000040,
    Offline = 0x00000080,
    IoActive = 0x00000100,
    Busy = 0x00000200,
    Printing = 0x00000400,
    OutputBinFull = 0x00000800,
    NotAvailable = 0x00001000,
    Waiting = 0x00002000,
    Processing = 0x00004000,
    Initializing = 0x00008000,
    WarmingUp = 0x00010000,
    TonerLow = 0x00020000,
    NoToner = 0x00040000,
    PagePunt = 0x00080000,
    UserIntervention = 0x00100000,
    OutOfMemory = 0x00200000,
    DoorOpen = 0x00400000,
    ServerUnknown = 0x00800000,
    PowerSave = 0x01000000,
}

/// <summary>JOB_STATUS_* from winspool.h, for JOB_INFO_1.Status.</summary>
[Flags]
public enum JobStatus : uint
{
    None = 0,
    Paused = 0x00000001,
    Error = 0x00000002,
    Deleting = 0x00000004,
    Spooling = 0x00000008,
    Printing = 0x00000010,
    Offline = 0x00000020,
    PaperOut = 0x00000040,
    Printed = 0x00000080,
    Deleted = 0x00000100,
    BlockedDevq = 0x00000200,
    UserIntervention = 0x00000400,
    Restart = 0x00000800,
    Complete = 0x00001000,
}

/// <summary>
/// Raw winspool.drv bindings with no third-party print library in between.
///
/// What the live spooler here taught us, and why the code is shaped this way:
///   * cbNeeded is the array PLUS every string Windows appended after it. For
///     these two printers it was 8016 bytes for a 272-byte array, so
///     cbNeeded/count is not a stride and using it as one reads wild memory.
///     Stride is Marshal.SizeOf of the documented struct, full stop.
///   * Fields are marshalled into real structs, not read at hand-computed
///     offsets. The first version of this file guessed JOB_INFO_1's member list
///     from a doc page and was wrong — the header has pMachineName and
///     pUserName where the page had hUser and pDevMode.
///   * EnumPrinters needs PRINTER_ENUM_LOCAL | PRINTER_ENUM_CONNECTIONS (0x2,
///     0x4). Those numbers are not the ones the old docs page implies.
/// </summary>
public static class WinSpool
{
    private const string Dll = "winspool.drv";

    public const uint Level1 = 1;
    public const uint Level2 = 2;
    public const uint Level4 = 4;

    public const uint EnumLocal = 0x00000002;
    public const uint EnumConnections = 0x00000004;
    public const uint EnumFlags = EnumLocal | EnumConnections;

    public const int ErrorInsufficientBuffer = 122;
    public const int ErrorAccessDenied = 5;
    public const int ErrorInvalidLevel = 404;
    public const int ErrorInvalidParameter = 87;
    public const int ErrorUnknownPrinter = 1168;
    public const int ErrorRpcServerUnavailable = 1722;

    [StructLayout(LayoutKind.Sequential)]
    public struct PrinterInfo2
    {
        public IntPtr ServerName;
        public IntPtr PrinterName;
        public IntPtr ShareName;
        public IntPtr PortName;
        public IntPtr DriverName;
        public IntPtr Comment;
        public IntPtr Location;
        public IntPtr DevMode;
        public IntPtr SepFile;
        public IntPtr PrintProcessor;
        public IntPtr Datatype;
        public IntPtr Parameters;
        public IntPtr SecurityDescriptor;
        public uint Attributes;
        public uint Priority;
        public uint DefaultPriority;
        public uint StartTime;
        public uint UntilTime;
        public uint Status;
        public uint Jobs;
        public uint AveragePpm;

        public PrinterReport ToReport()
        {
            var attributes = (PrinterAttributes)Attributes;
            var server = Text(ServerName);
            var port = Text(PortName);
            var (state, reason) = PrinterStateDecoder.Decode(Status, attributes);

            return new PrinterReport
            {
                Name = Text(PrinterName) ?? "",
                Server = server,
                Port = port,
                Driver = Text(DriverName),
                Location = Text(Location),
                ShareName = Text(ShareName),
                // Not the attribute bit: EnumPrinters leaves it clear even for the real default.
                IsDefault = false,
                Shared = attributes.HasFlag(PrinterAttributes.Shared),
                IsHidden = attributes.HasFlag(PrinterAttributes.Hidden),
                Kind = PrinterStateDecoder.DecodeKind(attributes, server, port),
                State = state,
                StateReason = reason,
                RawStatus = Status,
                RawAttributes = Attributes,
                QueueLength = (int)Jobs,
            };
        }
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct PrinterInfo4
    {
        public IntPtr PrinterName;
        public IntPtr ServerName;
        public uint Attributes;
        public uint Reserved;

        public PrinterReport ToReport()
        {
            var attributes = (PrinterAttributes)Attributes;
            var server = Text(ServerName);

            return new PrinterReport
            {
                Name = Text(PrinterName) ?? "",
                Server = server,
                Kind = PrinterStateDecoder.DecodeKind(attributes, server, null),
                // Not the attribute bit: EnumPrinters leaves it clear even for the real default.
                IsDefault = false,
                Shared = attributes.HasFlag(PrinterAttributes.Shared),
                IsHidden = attributes.HasFlag(PrinterAttributes.Hidden),
                State = PrinterState.Unknown,
                RawAttributes = Attributes,
                StateReason = "status needs printer information level 2, which this account was refused",
            };
        }
    }

    /// <summary>
    /// JOB_INFO_1 as winspool.h really declares it: three identity strings
    /// before pDocument, and it ends at Submitted. A doc page lists a different
    /// member set; the header and the live spooler agree with each other.
    /// </summary>
    [StructLayout(LayoutKind.Sequential)]
    public struct JobInfo1
    {
        public uint JobId;
        private readonly uint _padding;
        public IntPtr PrinterName;
        public IntPtr MachineName;
        public IntPtr UserName;
        public IntPtr Document;
        public IntPtr Datatype;
        public IntPtr StatusText;
        public uint Status;
        public uint Priority;
        public uint Position;
        public uint TotalPages;
        public uint PagesPrinted;
        public SystemTime Submitted;

        public SpoolerJob ToJob() => new()
        {
            JobId = JobId,
            Document = Text(Document) ?? "",
            StatusText = Text(StatusText),
            SubmittedBy = Text(UserName),
            StatusBits = Status,
            Position = Position,
            PagesPrinted = PagesPrinted,
            TotalPages = TotalPages,
        };
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct SystemTime
    {
        public short Year;
        public short Month;
        public short DayOfWeek;
        public short Day;
        public short Hour;
        public short Minute;
        public short Second;
        public short Milliseconds;
    }

    [DllImport(Dll, CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool EnumPrintersW(
        uint flags,
        string? name,
        uint level,
        IntPtr printerEnum,
        uint bufSize,
        out uint bytesNeeded,
        out uint printersReturned);

    [DllImport(Dll, CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool OpenPrinterW(
        string? printerName,
        out IntPtr printerHandle,
        IntPtr defaults);

    [DllImport(Dll, CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool GetPrinterW(
        IntPtr printerHandle,
        uint level,
        IntPtr buffer,
        uint bufSize,
        out uint bytesNeeded);

    [DllImport(Dll, CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool EnumJobsW(
        IntPtr printerHandle,
        uint firstJob,
        uint count,
        uint level,
        IntPtr buffer,
        uint bufSize,
        out uint bytesNeeded,
        out uint jobsReturned);

    [DllImport(Dll, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ClosePrinter(IntPtr printerHandle);

    [DllImport(Dll, CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern bool GetDefaultPrinterW(IntPtr buffer, ref uint size);

    /// <summary>
    /// The printer Windows would pick when nobody says otherwise.
    /// </summary>
    /// <remarks>
    /// This is not the Attributes bit, even though winspool.h defines
    /// PRINTER_ATTRIBUTE_DEFAULT: on this machine EnumPrinters reported 0x240
    /// for both queues while WMI reported 0x244 for the real default, so the
    /// array form does not carry that flag. Asking the API directly is the only
    /// answer that matches what the user sees in Windows.
    /// </remarks>
    public static string? GetDefaultPrinterName()
    {
        uint size = 0;
        GetDefaultPrinterW(IntPtr.Zero, ref size);
        if (Marshal.GetLastWin32Error() != ErrorInsufficientBuffer || size == 0)
            return null;

        var buffer = Marshal.AllocHGlobal((int)size * 2);
        try
        {
            if (!GetDefaultPrinterW(buffer, ref size))
                return null;

            return Text(buffer);
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    /// <summary>
    /// Run a two-call enum: size the answer with a null buffer, allocate that
    /// many bytes, then read it. Nothing is dereferenced before the buffer it
    /// came from exists.
    /// </summary>
    public static bool TryEnumerate(
        Func<uint, IntPtr, (bool Ok, uint Needed, uint Count)> probe,
        Action<IntPtr, uint, uint> consume,
        out int win32Error)
    {
        win32Error = 0;

        var sizing = probe(0, IntPtr.Zero);
        if (!sizing.Ok)
        {
            var code = Marshal.GetLastWin32Error();
            if (code != ErrorInsufficientBuffer)
            {
                win32Error = code;
                return false;
            }
        }

        if (sizing.Needed == 0)
            return true;

        var buffer = Marshal.AllocHGlobal((int)sizing.Needed);
        try
        {
            var filled = probe(sizing.Needed, buffer);
            if (!filled.Ok)
            {
                win32Error = Marshal.GetLastWin32Error();
                return false;
            }

            if (filled.Count > 0)
                consume(buffer, filled.Count, sizing.Needed);
            return true;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    /// <summary>
    /// Read <typeparamref name="T"/> at entry <paramref name="index"/> using the
    /// compiler's own layout size.
    /// </summary>
    /// <remarks>
    /// The bounds test is not paranoia: it is what stops a wrong struct guess
    /// from reading past the buffer Windows filled. Callers use
    /// <see cref="FitsIn"/> first and report the printer as unreadable rather
    /// than crashing or inventing a value.
    /// </remarks>
    public static T ReadEntry<T>(IntPtr buffer, int index) where T : struct =>
        Marshal.PtrToStructure<T>(IntPtr.Add(buffer, index * Marshal.SizeOf<T>()));

    /// <summary>Would entry <paramref name="index"/> of type T fit inside the bytes we hold?</summary>
    public static bool FitsIn<T>(int index, uint bufferBytes) where T : struct
    {
        var stride = Marshal.SizeOf<T>();
        return stride > 0 && (long)(index + 1) * stride <= bufferBytes;
    }

    /// <summary>UTF-16 string behind a pointer field inside our own buffer.</summary>
    public static string? Text(IntPtr pointer)
    {
        if (pointer == IntPtr.Zero)
            return null;

        var chars = 0;
        while (Marshal.ReadInt16(pointer, chars * 2) != 0)
        {
            chars++;
            // Spooler strings are nowhere near this long. The cap stops a
            // corrupted pointer from walking memory looking for a NUL.
            if (chars > 1024)
                return null;
        }

        return chars == 0 ? string.Empty : Marshal.PtrToStringUni(pointer, chars);
    }

    /// <summary>
    /// OpenPrinter / action / ClosePrinter. Also the honest test of whether the
    /// account the agent runs under can reach a printer at all.
    /// </summary>
    public static bool WithPrinterHandle(string printerName, Func<IntPtr, bool> action, out int win32Error)
    {
        win32Error = 0;
        if (!OpenPrinterW(printerName, out var handle, IntPtr.Zero))
        {
            win32Error = Marshal.GetLastWin32Error();
            return false;
        }

        try
        {
            return action(handle);
        }
        finally
        {
            ClosePrinter(handle);
        }
    }

    /// <summary>
    /// PRINTER_INFO_2 for one open printer handle, sizing the buffer first.
    /// Level 2 on a handle needs more bytes than the same struct in an array
    /// because the DevMode blob rides along, so the size always comes from
    /// Windows: 1824 bytes for OneNote and 6192 for Print to PDF here.
    /// </summary>
    public static (PrinterInfo2? Info, int Win32Error) ReadPrinterInfo2(IntPtr printerHandle)
    {
        GetPrinterW(printerHandle, Level2, IntPtr.Zero, 0, out var needed);
        var sizingError = Marshal.GetLastWin32Error();
        if (needed == 0)
            return (null, sizingError == ErrorInsufficientBuffer ? 0 : sizingError);

        var buffer = Marshal.AllocHGlobal((int)needed);
        try
        {
            if (!GetPrinterW(printerHandle, Level2, buffer, needed, out _))
                return (null, Marshal.GetLastWin32Error());

            return (Marshal.PtrToStructure<PrinterInfo2>(buffer), 0);
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    public static string DescribeError(int win32Error) => win32Error switch
    {
        0 => "no error",
        ErrorAccessDenied => "access denied — this account cannot open the printer",
        ErrorInsufficientBuffer => "buffer too small",
        ErrorInvalidLevel => "unsupported information level",
        ErrorInvalidParameter => "invalid parameter",
        ErrorUnknownPrinter => "printer not found",
        ErrorRpcServerUnavailable => "print spooler service is not reachable",
        _ => SafeMessage(win32Error),
    };

    private static string SafeMessage(int code)
    {
        try
        {
            return new Win32Exception(code).Message;
        }
        catch (Exception)
        {
            return $"Win32 error {code}";
        }
    }
}

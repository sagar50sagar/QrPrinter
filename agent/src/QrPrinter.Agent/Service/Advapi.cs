using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;

namespace QrPrinter.Agent.Service;

/// <summary>
/// The Service Control Manager calls the agent needs, declared by hand so the
/// project keeps its no-PackageReference rule.
/// </summary>
internal static class Advapi
{
    private const string Dll = "advapi32.dll";

    public const uint ScManagerConnect = 0x0001;
    public const uint ScManagerCreateService = 0x0002;

    public const uint ServiceQueryConfig = 0x0001;
    public const uint ServiceChangeConfig = 0x0002;
    public const uint ServiceQueryStatus = 0x0004;
    public const uint ServiceStart = 0x0010;
    public const uint ServiceStop = 0x0020;
    public const uint ServiceAllAccess = 0x000F01FF;
    public const uint Delete = 0x00010000;

    public const uint ServiceWin32OwnProcess = 0x00000010;
    public const uint ServiceAutoStart = 0x00000002;
    public const uint ServiceDemandStart = 0x00000003;
    public const uint ServiceDisabled = 0x00000004;
    public const uint ServiceErrorNormal = 0x00000001;

    public const uint Stopped = 1;
    public const uint StartPending = 2;
    public const uint StopPending = 3;
    public const uint Running = 4;

    public const uint ControlStop = 0x00000001;
    public const uint ControlInterrogate = 0x00000004;
    public const uint ControlShutdown = 0x00000005;

    public const uint AcceptStop = 0x00000001;
    public const uint AcceptShutdown = 0x00000004;

    public const uint ConfigDescription = 1;
    public const uint ConfigFailureActions = 2;
    public const uint ConfigFailureActionsFlag = 4;
    public const uint ConfigServiceSidInfo = 5;
    public const uint SidTypeUnrestricted = 1;
    public const int ActionRestart = 1;

    public const int ErrorAccessDenied = 5;
    public const int ErrorInsufficientBuffer = 122;
    public const int ErrorCallNotImplemented = 120;
    public const int ErrorServiceAlreadyRunning = 1056;
    public const int ErrorServiceDoesNotExist = 1060;
    public const int ErrorServiceNotActive = 1062;
    public const int ErrorFailedServiceControllerConnect = 1063;
    public const int ErrorServiceSpecificError = 1066;
    public const int ErrorServiceMarkedForDelete = 1072;
    public const int ErrorServiceExists = 1073;

    [StructLayout(LayoutKind.Sequential)]
    public struct ServiceStatus
    {
        public uint ServiceType;
        public uint CurrentState;
        public uint ControlsAccepted;
        public uint Win32ExitCode;
        public uint ServiceSpecificExitCode;
        public uint CheckPoint;
        public uint WaitHint;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct ServiceStatusProcess
    {
        public uint ServiceType;
        public uint CurrentState;
        public uint ControlsAccepted;
        public uint Win32ExitCode;
        public uint ServiceSpecificExitCode;
        public uint CheckPoint;
        public uint WaitHint;
        public uint ProcessId;
        public uint ServiceFlags;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct QueryServiceConfig
    {
        public uint ServiceType;
        public uint StartType;
        public uint ErrorControl;
        public IntPtr BinaryPathName;
        public IntPtr LoadOrderGroup;
        public uint TagId;
        public IntPtr Dependencies;
        public IntPtr ServiceStartName;
        public IntPtr DisplayName;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct ServiceTableEntry
    {
        public IntPtr ServiceName;
        public IntPtr ServiceProc;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public struct ServiceDescription
    {
        [MarshalAs(UnmanagedType.LPWStr)]
        public string Description;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct ScAction
    {
        public int Type;
        public uint Delay;
    }

    [StructLayout(LayoutKind.Sequential)]
    public struct ServiceFailureActions
    {
        public uint ResetPeriod;
        public IntPtr RebootMessage;
        public IntPtr Command;
        public uint ActionCount;
        public IntPtr Actions;
    }

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    public delegate void ServiceMainProc(int argc, IntPtr argv);

    [UnmanagedFunctionPointer(CallingConvention.Winapi)]
    public delegate uint HandlerExProc(uint control, uint eventType, IntPtr eventData, IntPtr context);

    [DllImport(Dll, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool StartServiceCtrlDispatcherW([In] ServiceTableEntry[] table);

    [DllImport(Dll, CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    public static extern IntPtr RegisterServiceCtrlHandlerExW(string serviceName, HandlerExProc handler, IntPtr context);

    [DllImport(Dll, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool SetServiceStatus(IntPtr statusHandle, ref ServiceStatus status);

    [DllImport(Dll, CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    public static extern ScHandle OpenSCManagerW(string? machineName, string? databaseName, uint access);

    [DllImport(Dll, CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    public static extern ScHandle OpenServiceW(ScHandle manager, string serviceName, uint access);

    [DllImport(Dll, CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    public static extern ScHandle CreateServiceW(
        ScHandle manager,
        string serviceName,
        string displayName,
        uint access,
        uint serviceType,
        uint startType,
        uint errorControl,
        string binaryPathName,
        string? loadOrderGroup,
        IntPtr tagId,
        string? dependencies,
        string? serviceStartName,
        string? password);

    [DllImport(Dll, CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ChangeServiceConfigW(
        ScHandle service,
        uint serviceType,
        uint startType,
        uint errorControl,
        string? binaryPathName,
        string? loadOrderGroup,
        IntPtr tagId,
        string? dependencies,
        string? serviceStartName,
        string? password,
        string? displayName);

    [DllImport(Dll, EntryPoint = "ChangeServiceConfig2W", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ChangeServiceConfig2(ScHandle service, uint infoLevel, ref ServiceDescription info);

    [DllImport(Dll, EntryPoint = "ChangeServiceConfig2W", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ChangeServiceConfig2(ScHandle service, uint infoLevel, ref ServiceFailureActions info);

    /// <summary>Both the failure-actions flag and the SID info are a single DWORD.</summary>
    [DllImport(Dll, EntryPoint = "ChangeServiceConfig2W", ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ChangeServiceConfig2(ScHandle service, uint infoLevel, ref uint info);

    [DllImport(Dll, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool QueryServiceStatusEx(
        ScHandle service,
        int infoLevel,
        out ServiceStatusProcess buffer,
        uint bufferSize,
        out uint bytesNeeded);

    [DllImport(Dll, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool QueryServiceConfigW(ScHandle service, IntPtr buffer, uint bufferSize, out uint bytesNeeded);

    [DllImport(Dll, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool StartServiceW(ScHandle service, uint argc, IntPtr argv);

    [DllImport(Dll, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool ControlService(ScHandle service, uint control, out ServiceStatus status);

    [DllImport(Dll, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool DeleteService(ScHandle service);

    [DllImport(Dll, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    public static extern bool CloseServiceHandle(IntPtr handle);
}

internal sealed class ScHandle : SafeHandleZeroOrMinusOneIsInvalid
{
    public ScHandle()
        : base(ownsHandle: true)
    {
    }

    protected override bool ReleaseHandle() => Advapi.CloseServiceHandle(handle);
}

using System.Runtime.InteropServices;

namespace QrPrinter.Agent.Hardware;

/// <summary>
/// Reads one Windows service state through the service control manager.
///
/// Querying does not need administrator rights, and doing it here keeps the
/// agent from shelling out to `sc.exe` or PowerShell — which is both slower
/// and the kind of child process anti-virus software likes to ask questions
/// about.
/// </summary>
public static class ServiceProbe
{
    private const string Advapi32 = "advapi32.dll";
    private const uint ScManagerConnect = 0x0001;
    private const uint ServiceQueryStatus = 0x0004;
    private const uint ServiceAllAccess = 0x000F003F;

    [StructLayout(LayoutKind.Sequential)]
    private struct ServiceStatus
    {
        public int ServiceType;
        public int CurrentState;
        public int ControlsAccepted;
        public int Win32ExitCode;
        public int ServiceSpecificExitCode;
        public int CheckPoint;
        public int WaitHint;
    }

    [DllImport(Advapi32, CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern IntPtr OpenSCManagerW(string? machineName, string? databaseName, uint access);

    [DllImport(Advapi32, CharSet = CharSet.Unicode, ExactSpelling = true, SetLastError = true)]
    private static extern IntPtr OpenServiceW(IntPtr serviceHandle, string serviceName, uint access);

    [DllImport(Advapi32, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool QueryServiceStatus(IntPtr serviceHandle, out ServiceStatus status);

    [DllImport(Advapi32, ExactSpelling = true, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CloseServiceHandle(IntPtr handle);

    public sealed record Result(bool Found, bool Running, string StateName, int Win32Error)
    {
        public override string ToString() => Found ? StateName : $"not readable ({Win32Error})";
    }

    /// <summary>
    /// Ask the SCM what <paramref name="serviceName"/> is doing right now.
    /// </summary>
    public static Result Query(string serviceName)
    {
        var machine = OpenSCManagerW(null, null, ScManagerConnect);
        if (machine == IntPtr.Zero)
            return new Result(false, false, "unknown", Marshal.GetLastWin32Error());

        try
        {
            var service = OpenServiceW(machine, serviceName, ServiceQueryStatus);
            if (service == IntPtr.Zero)
            {
                var error = Marshal.GetLastWin32Error();
                return new Result(false, false, error == ErrorServiceDoesNotExist ? "not installed" : "unknown", error);
            }

            try
            {
                if (!QueryServiceStatus(service, out var status))
                    return new Result(false, false, "unknown", Marshal.GetLastWin32Error());

                return new Result(true, status.CurrentState == Running, StateName(status.CurrentState), 0);
            }
            finally
            {
                CloseServiceHandle(service);
            }
        }
        finally
        {
            CloseServiceHandle(machine);
        }
    }

    private const int ErrorServiceDoesNotExist = 1060;
    private const int Stopped = 1;
    private const int StartPending = 2;
    private const int StopPending = 3;
    private const int Running = 4;
    private const int ContinuePending = 5;
    private const int PausePending = 6;
    private const int Paused = 7;

    private static string StateName(int state) => state switch
    {
        Stopped => "stopped",
        StartPending => "starting",
        StopPending => "stopping",
        Running => "running",
        ContinuePending => "resuming",
        PausePending => "pausing",
        Paused => "paused",
        _ => $"state {state}",
    };
}

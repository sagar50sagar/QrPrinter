using System.Buffers.Binary;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using QrPrinter.Agent.Config;
using QrPrinter.Agent.Hardware;
using QrPrinter.Agent.Logging;
using QrPrinter.Agent.Net;

namespace QrPrinter.Agent.Service;

/// <summary>
/// `QrPrinterAgent service-run` — the process Windows starts at boot.
///
/// It runs the same <see cref="AgentRuntime"/> as `run`; the only differences
/// are who starts it, that nothing is ever shown on screen, and that every
/// problem goes to agent.log and the service exit code instead of a console.
/// </summary>
internal static class ServiceHost
{
    public const string Name = "QrPrinterAgent";
    public const string DisplayName = "QrPrinter Local Agent";

    /// <summary>
    /// A virtual account, not LocalSystem: SumatraPDF parses customer PDFs
    /// inside this process tree, and a parser bug should land in an account
    /// that owns nothing but the agent's own folder.
    /// </summary>
    public const string Account = @"NT SERVICE\" + Name;

    public static readonly string Sid = VirtualAccountSid(Name);

    public const int ExitNotPaired = 10;
    public const int ExitNoConfig = 11;
    public const int ExitBadConfig = 12;
    public const int ExitCrashed = 13;

    // Held in static fields: native code keeps the function pointers for the
    // life of the process, so the delegates must never be collected.
    private static readonly Advapi.ServiceMainProc MainProc = ServiceMain;
    private static readonly Advapi.HandlerExProc HandlerProc = Handler;

    private static readonly object Gate = new();
    private static readonly CancellationTokenSource StopRequested = new();
    private static IntPtr _statusHandle;
    private static uint _checkPoint;
    private static int _stopping;
    private static TimeSpan? _grace;

    /// <summary>
    /// The SID Windows gives NT SERVICE\&lt;name&gt;: S-1-5-80 followed by the
    /// SHA-1 of the upper-cased name in UTF-16, read as five little-endian
    /// words. Computing it lets the installer set ACLs before the account
    /// exists.
    /// </summary>
    public static string VirtualAccountSid(string serviceName)
    {
        var hash = SHA1.HashData(Encoding.Unicode.GetBytes(serviceName.ToUpperInvariant()));
        var words = new uint[5];
        for (var i = 0; i < words.Length; i++)
            words[i] = BinaryPrimitives.ReadUInt32LittleEndian(hash.AsSpan(i * 4, 4));
        return "S-1-5-80-" + string.Join('-', words);
    }

    public static string DescribeExit(int code) => code switch
    {
        ExitNotPaired => "device.json is missing or the service account cannot read it. Pair again, then `QrPrinterAgent service install` re-grants access.",
        ExitNoConfig => "config.json is missing. Pair with --api and --socket first.",
        ExitBadConfig => "config.json is invalid; the exact reason is in agent.log.",
        ExitCrashed => "the agent hit an unexpected error while starting; the reason is in agent.log.",
        _ => $"service-specific exit code {code}",
    };

    public static int Run()
    {
        var name = Marshal.StringToHGlobalUni(Name);
        try
        {
            var table = new[]
            {
                new Advapi.ServiceTableEntry { ServiceName = name, ServiceProc = Marshal.GetFunctionPointerForDelegate(MainProc) },
                default,
            };

            if (Advapi.StartServiceCtrlDispatcherW(table))
                return Program.ExitOk;

            var error = Marshal.GetLastWin32Error();
            if (error == Advapi.ErrorFailedServiceControllerConnect)
            {
                Console.Error.WriteLine(
                    "service-run is for Windows to start, not for typing. Use `QrPrinterAgent run` to watch the agent " +
                    "in this window, or `QrPrinterAgent service start` to start the installed service.");
                return Program.ExitUsage;
            }

            Console.Error.WriteLine($"the service dispatcher refused to start: {new Win32Exception(error).Message}");
            return Program.ExitFailed;
        }
        finally
        {
            Marshal.FreeHGlobal(name);
        }
    }

    private static void ServiceMain(int argc, IntPtr argv)
    {
        _statusHandle = Advapi.RegisterServiceCtrlHandlerExW(Name, HandlerProc, IntPtr.Zero);
        if (_statusHandle == IntPtr.Zero)
            return;

        Report(Advapi.StartPending, waitHintMs: 30_000);

        int code;
        try
        {
            code = RunAgentAsync().GetAwaiter().GetResult();
        }
        catch (Exception error)
        {
            FileLog.Error("service stopped on an unexpected error", error);
            code = ExitCrashed;
        }

        FileLog.Info(code == 0 ? "service stopped" : $"service stopped: {DescribeExit(code)}");
        FileLog.Close();

        // Nothing may run after this: Windows is free to end the process.
        Report(Advapi.Stopped, exitCode: code);
    }

    private static async Task<int> RunAgentAsync()
    {
        FileLog.Configure(LogLevel.Info, echoToConsole: false);
        AgentPaths.EnsureDirectories();
        FileLog.Open(AgentPaths.LogFile);
        AppDomain.CurrentDomain.UnhandledException += (_, eventArgs) =>
            FileLog.Error("unhandled error in the service", eventArgs.ExceptionObject as Exception);

        FileLog.Info($"service starting: agent {AgentVersion.Value} as {Account}, pid {Environment.ProcessId}");

        DeviceIdentity? identity;
        try
        {
            identity = DeviceIdentity.Load();
        }
        catch (Exception error)
        {
            FileLog.Error($"device.json could not be read by {Account}", error);
            return ExitNotPaired;
        }

        if (identity == null)
        {
            FileLog.Error("this device is not paired. Run `QrPrinterAgent pair <CODE>`, then `QrPrinterAgent service start`.");
            return ExitNotPaired;
        }

        if (!File.Exists(AgentPaths.ConfigFile))
        {
            FileLog.Error($"no config.json at {AgentPaths.ConfigFile}");
            return ExitNoConfig;
        }

        AgentConfig config;
        try
        {
            config = AgentConfig.Load();
        }
        catch (Exception error)
        {
            FileLog.Error("config.json is invalid", error);
            return ExitBadConfig;
        }

        var spooler = ServiceProbe.Query("Spooler");
        if (!spooler.Running)
            FileLog.Warn($"the Windows print spooler is {spooler}; jobs will fail until it runs");

        var runtime = new AgentRuntime(config, identity);
        runtime.Start(StopRequested.Token);
        Report(Advapi.Running);

        try
        {
            await runtime.WaitForShutdownAsync(StopRequested.Token).ConfigureAwait(false);
        }
        catch (OperationCanceledException)
        {
        }

        await runtime.StopAsync(_grace).ConfigureAwait(false);
        return Program.ExitOk;
    }

    /// <summary>
    /// Runs on the dispatcher thread, so it must return at once: the real
    /// shutdown happens on the pool.
    /// </summary>
    private static uint Handler(uint control, uint eventType, IntPtr eventData, IntPtr context)
    {
        switch (control)
        {
            case Advapi.ControlStop:
            case Advapi.ControlShutdown:
                if (Interlocked.Exchange(ref _stopping, 1) == 1)
                    return 0;

                // Windows gives services only a few seconds at power-off, so a job
                // still printing gets a short grace instead of the normal one.
                if (control == Advapi.ControlShutdown)
                    _grace = TimeSpan.FromSeconds(3);

                FileLog.Info(control == Advapi.ControlShutdown ? "Windows is shutting down" : "stop requested by Windows");
                Report(Advapi.StopPending, waitHintMs: 20_000);
                ThreadPool.QueueUserWorkItem(_ => StopRequested.Cancel());
                return 0;

            case Advapi.ControlInterrogate:
                return 0;

            default:
                return Advapi.ErrorCallNotImplemented;
        }
    }

    private static void Report(uint state, int exitCode = 0, uint waitHintMs = 0)
    {
        lock (Gate)
        {
            var pending = state is Advapi.StartPending or Advapi.StopPending;
            var status = new Advapi.ServiceStatus
            {
                ServiceType = Advapi.ServiceWin32OwnProcess,
                CurrentState = state,
                ControlsAccepted = state == Advapi.Running ? Advapi.AcceptStop | Advapi.AcceptShutdown : 0,
                Win32ExitCode = exitCode == 0 ? 0u : Advapi.ErrorServiceSpecificError,
                ServiceSpecificExitCode = (uint)exitCode,
                CheckPoint = pending ? ++_checkPoint : 0,
                WaitHint = waitHintMs,
            };

            if (!Advapi.SetServiceStatus(_statusHandle, ref status))
                FileLog.Warn($"could not report service state {state}: {new Win32Exception(Marshal.GetLastWin32Error()).Message}");
        }
    }
}

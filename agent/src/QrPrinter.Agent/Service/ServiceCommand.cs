using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Principal;
using QrPrinter.Agent.Config;

namespace QrPrinter.Agent.Service;

/// <summary>
/// `QrPrinterAgent service install|uninstall|start|stop|restart|status`.
///
/// Install is the only verb that changes the machine, and it is idempotent:
/// running it again repairs the registration, the recovery policy and the
/// folder permissions instead of failing because the service exists.
/// </summary>
internal static class ServiceCommand
{
    private static readonly uint[] RestartDelaysMs = [5_000, 30_000, 300_000];
    private const uint ResetFailureCountSeconds = 86_400;

    private const string NeedsAdmin =
        "This needs an administrator window: press Start, type PowerShell, right-click it, choose " +
        "\"Run as administrator\", then run the same command there.";

    public static int Run(string[] args)
    {
        var action = args.FirstOrDefault(argument => !argument.StartsWith('-'))?.ToLowerInvariant();
        return action switch
        {
            "install" => Install(),
            "uninstall" => Uninstall(),
            "start" => Start(),
            "stop" => Stop(),
            "restart" => Restart(),
            "status" => Status(),
            _ => Usage(),
        };
    }

    private static int Usage()
    {
        Console.Error.WriteLine("usage: QrPrinterAgent service install|uninstall|start|stop|restart|status");
        return Program.ExitUsage;
    }

    private static int Install()
    {
        using var manager = OpenManager(Advapi.ScManagerConnect | Advapi.ScManagerCreateService);
        if (manager == null)
            return Program.ExitFailed;

        var problem = Preflight(out var exe);
        if (problem != null)
        {
            Console.Error.WriteLine(problem);
            return Program.ExitFailed;
        }

        var binaryPath = $"\"{exe}\" service-run";
        using var service = CreateOrUpdate(manager, binaryPath);
        if (service == null || !Configure(service) || !LockDataFolder(out var installer))
            return Program.ExitFailed;

        if (!StartAndWait(service, out var status))
        {
            Console.Error.WriteLine(
                "\nThe service is installed but not running. Windows retries it on its own after 5 s, 30 s and " +
                "every 5 min; fix the line above and it will come up, or run `QrPrinterAgent service start`.");
            return Program.ExitFailed;
        }

        Console.WriteLine();
        Console.WriteLine($"installed   {ServiceHost.Name} ({ServiceHost.DisplayName})");
        Console.WriteLine($"account     {ServiceHost.Account} — its own account, not SYSTEM");
        Console.WriteLine("starts      with Windows, before anyone signs in");
        Console.WriteLine("recovery    restarts 5 s, 30 s and 5 min after a failure");
        Console.WriteLine($"binary      {binaryPath}");
        Console.WriteLine($"data        {AgentPaths.Root} — SYSTEM, Administrators, {installer} and the service only");
        Console.WriteLine($"state       running · pid {status.ProcessId}");
        Console.WriteLine();
        Console.WriteLine("A service only sees printers installed for the whole PC. A printer added as a network");
        Console.WriteLine(@"connection for one Windows user (\\other-pc\printer) is invisible to it; add it as a");
        Console.WriteLine("local printer instead. The dashboard lists exactly what the service sees.");
        return Program.ExitOk;
    }

    /// <summary>
    /// Everything that would make the service fail or be unsafe, checked before
    /// Windows is touched.
    /// </summary>
    private static string? Preflight(out string exe)
    {
        exe = Environment.ProcessPath ?? "";

        if (!string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("QPRINTER_AGENT_HOME")))
        {
            return "QPRINTER_AGENT_HOME is set in this window, but the service always uses " +
                   $"{Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData), "QrPrinter Agent")}. " +
                   "Open a new administrator window without it and run install again.";
        }

        if (!Path.GetFileName(exe).Equals("QrPrinterAgent.exe", StringComparison.OrdinalIgnoreCase))
            return $"Install from the published QrPrinterAgent.exe (agent\\tools\\build-agent.ps1 builds it), not from {exe}.";

        var folder = Path.GetDirectoryName(exe)!;
        if (!IsProtectedLocation(folder))
            return MoveFirst(folder);

        if (!File.Exists(AgentPaths.IdentityFile))
            return "This PC is not paired yet. Run `QrPrinterAgent pair <CODE>` first, then install.";

        try
        {
            if (DeviceIdentity.Load() == null)
                return "device.json holds no identity. Pair again, then install.";
        }
        catch (Exception error)
        {
            return $"device.json cannot be read from this window ({error.Message}). Run install from the Windows " +
                   "account that paired this PC, or pair again here first.";
        }

        if (!File.Exists(AgentPaths.ConfigFile))
            return $"There is no config.json at {AgentPaths.ConfigFile}. Pair with --api and --socket first.";

        AgentConfig config;
        try
        {
            config = AgentConfig.Load();
        }
        catch (Exception error)
        {
            return $"config.json is invalid: {error.Message}";
        }

        var sumatra = Path.GetFullPath(config.SumatraExe());
        if (!File.Exists(sumatra))
            return $"{sumatra} is missing. Copy SumatraPDF.exe beside QrPrinterAgent.exe; it is what prints.";
        if (!IsProtectedLocation(Path.GetDirectoryName(sumatra)!))
        {
            return $"sumatra_pdf_path in config.json points to {sumatra}, which ordinary users can change. " +
                   "The service runs that file, so it has to live in Program Files too.";
        }

        return null;
    }

    /// <summary>
    /// The service binary and everything it launches must sit where only an
    /// administrator can write. Anywhere else, any user of a shared shop PC
    /// could swap the exe and run code under the service's privileges at the
    /// next boot.
    /// </summary>
    internal static bool IsProtectedLocation(string folder)
    {
        var full = Path.TrimEndingDirectorySeparator(Path.GetFullPath(folder)) + Path.DirectorySeparatorChar;
        foreach (var special in new[] { Environment.SpecialFolder.ProgramFiles, Environment.SpecialFolder.ProgramFilesX86 })
        {
            var root = Environment.GetFolderPath(special);
            if (root.Length == 0)
                continue;

            if (full.StartsWith(Path.TrimEndingDirectorySeparator(root) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase))
                return true;
        }

        return false;
    }

    private static string MoveFirst(string folder)
    {
        var target = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "QrPrinter Agent");
        return $"""
            The service starts with Windows under its own account, so its exe must sit where ordinary
            users cannot replace it, and {folder} is not such a place.

            Copy the agent into Program Files from this administrator PowerShell, then install from there:

              robocopy "{folder}" "{target}" QrPrinterAgent.exe SumatraPDF.exe /R:2 /W:2
              & "{Path.Combine(target, "QrPrinterAgent.exe")}" service install
            """;
    }

    private static ScHandle? CreateOrUpdate(ScHandle manager, string binaryPath)
    {
        var existing = Advapi.OpenServiceW(manager, ServiceHost.Name, Advapi.ServiceAllAccess);
        if (!existing.IsInvalid)
        {
            Console.WriteLine($"updating    the existing {ServiceHost.Name} service");
            if (!StopAndWait(existing))
            {
                existing.Dispose();
                return null;
            }

            // An empty dependency list clears any left by a hand edit: a
            // dependency on the spooler would let `net stop spooler` take the
            // agent down with no restart.
            if (!Advapi.ChangeServiceConfigW(
                    existing,
                    Advapi.ServiceWin32OwnProcess,
                    Advapi.ServiceAutoStart,
                    Advapi.ServiceErrorNormal,
                    binaryPath,
                    null,
                    IntPtr.Zero,
                    "",
                    ServiceHost.Account,
                    null,
                    ServiceHost.DisplayName))
            {
                Fail("could not update the service", Marshal.GetLastWin32Error());
                existing.Dispose();
                return null;
            }

            return existing;
        }

        var openError = Marshal.GetLastWin32Error();
        existing.Dispose();
        if (openError != Advapi.ErrorServiceDoesNotExist)
        {
            Fail("could not open the existing service", openError);
            return null;
        }

        var created = Advapi.CreateServiceW(
            manager,
            ServiceHost.Name,
            ServiceHost.DisplayName,
            Advapi.ServiceAllAccess,
            Advapi.ServiceWin32OwnProcess,
            Advapi.ServiceAutoStart,
            Advapi.ServiceErrorNormal,
            binaryPath,
            null,
            IntPtr.Zero,
            null,
            ServiceHost.Account,
            null);

        if (created.IsInvalid)
        {
            var error = Marshal.GetLastWin32Error();
            created.Dispose();
            Fail(
                error == Advapi.ErrorServiceMarkedForDelete
                    ? "Windows is still removing the previous copy of this service. Close any Services or Event Viewer window, wait a few seconds and run install again"
                    : "could not create the service",
                error);
            return null;
        }

        Console.WriteLine($"created     the {ServiceHost.Name} service");
        return created;
    }

    private static bool Configure(ScHandle service)
    {
        var description = new Advapi.ServiceDescription
        {
            Description = "Prints jobs sent from the QrPrinter dashboard to this PC's printers. Stopping it stops remote printing.",
        };
        if (!Advapi.ChangeServiceConfig2(service, Advapi.ConfigDescription, ref description))
            return Fail("could not set the service description", Marshal.GetLastWin32Error());

        var actions = RestartDelaysMs
            .Select(delay => new Advapi.ScAction { Type = Advapi.ActionRestart, Delay = delay })
            .ToArray();
        var pinned = GCHandle.Alloc(actions, GCHandleType.Pinned);
        try
        {
            var failure = new Advapi.ServiceFailureActions
            {
                ResetPeriod = ResetFailureCountSeconds,
                ActionCount = (uint)actions.Length,
                Actions = pinned.AddrOfPinnedObject(),
            };
            if (!Advapi.ChangeServiceConfig2(service, Advapi.ConfigFailureActions, ref failure))
                return Fail("could not set the restart policy", Marshal.GetLastWin32Error());
        }
        finally
        {
            pinned.Free();
        }

        // Without this flag Windows only restarts a crash. A clean stop with an
        // error code (for example, unreadable config) would stay down for good.
        var onNonCrashFailures = 1u;
        if (!Advapi.ChangeServiceConfig2(service, Advapi.ConfigFailureActionsFlag, ref onNonCrashFailures))
            return Fail("could not set the restart policy for non-crash failures", Marshal.GetLastWin32Error());

        var sidType = Advapi.SidTypeUnrestricted;
        if (!Advapi.ChangeServiceConfig2(service, Advapi.ConfigServiceSidInfo, ref sidType))
            return Fail("could not set the service SID type", Marshal.GetLastWin32Error());

        Console.WriteLine($"configured  auto start as {ServiceHost.Account}, restart on failure");
        return true;
    }

    /// <summary>
    /// ProgramData lets every local user read what is inside it, and the spool
    /// folder holds customer documents while they print. The data folder is
    /// cut down to the accounts that run or administer the agent.
    /// </summary>
    private static bool LockDataFolder(out string installerName)
    {
        installerName = "this account";
        string? installerSid = null;
        if (OperatingSystem.IsWindows())
        {
            using var current = WindowsIdentity.GetCurrent();
            installerSid = current.User?.Value;
            installerName = current.Name;
        }

        var grants = new List<string>
        {
            "*S-1-5-18:(OI)(CI)F",
            "*S-1-5-32-544:(OI)(CI)F",
            $"*{ServiceHost.Sid}:(OI)(CI)M",
        };

        // The person installing keeps working access, so `doctor` and
        // `test-print` still run from their normal, non-administrator window.
        if (installerSid is { Length: > 0 } && installerSid != "S-1-5-18")
            grants.Add($"*{installerSid}:(OI)(CI)M");

        var root = Icacls(AgentPaths.Root, ["/inheritance:r", "/grant:r", .. grants, "/Q"]);
        if (root.ExitCode != 0)
            return Fail($"could not set permissions on {AgentPaths.Root}: {root.Output}");

        // device.json keeps its own narrowed list; the service only needs to read it.
        var identity = Icacls(AgentPaths.IdentityFile, ["/grant", $"*{ServiceHost.Sid}:(R)", "/Q"]);
        if (identity.ExitCode != 0)
            return Fail($"could not let the service read {AgentPaths.IdentityFile}: {identity.Output}");

        Console.WriteLine($"secured     {AgentPaths.Root}");
        return true;
    }

    private static (int ExitCode, string Output) Icacls(string path, IEnumerable<string> arguments)
    {
        // The full System32 path: this runs elevated, and a bare name would
        // also find an icacls.exe sitting in the current folder.
        var startInfo = new ProcessStartInfo(Path.Combine(Environment.SystemDirectory, "icacls.exe"))
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        startInfo.ArgumentList.Add(path);
        foreach (var argument in arguments)
            startInfo.ArgumentList.Add(argument);

        using var process = Process.Start(startInfo)!;
        var stdout = process.StandardOutput.ReadToEndAsync();
        var stderr = process.StandardError.ReadToEndAsync();
        process.WaitForExit();
        return (process.ExitCode, (stdout.Result + " " + stderr.Result).Trim());
    }

    private static int Uninstall()
    {
        using var manager = OpenManager(Advapi.ScManagerConnect);
        if (manager == null)
            return Program.ExitFailed;

        using var service = OpenExisting(manager, Advapi.ServiceStop | Advapi.ServiceQueryStatus | Advapi.Delete, missingIsError: false);
        if (service == null)
            return Program.ExitOk;

        if (!StopAndWait(service))
            return Program.ExitFailed;

        if (!Advapi.DeleteService(service))
        {
            Fail("Windows would not remove the service", Marshal.GetLastWin32Error());
            return Program.ExitFailed;
        }

        Console.WriteLine($"{ServiceHost.Name} is stopped and removed. Nothing prints from the dashboard on this PC now.");
        Console.WriteLine($"The pairing, config and logs stay in {AgentPaths.Root}, so a reinstall needs no new code.");
        return Program.ExitOk;
    }

    private static int Start()
    {
        using var manager = OpenManager(Advapi.ScManagerConnect);
        using var service = manager == null ? null : OpenExisting(manager, Advapi.ServiceStart | Advapi.ServiceQueryStatus);
        if (service == null || !StartAndWait(service, out var status))
            return Program.ExitFailed;

        Console.WriteLine($"{ServiceHost.Name} is running · pid {status.ProcessId}");
        return Program.ExitOk;
    }

    private static int Stop()
    {
        using var manager = OpenManager(Advapi.ScManagerConnect);
        using var service = manager == null ? null : OpenExisting(manager, Advapi.ServiceStop | Advapi.ServiceQueryStatus);
        if (service == null || !StopAndWait(service))
            return Program.ExitFailed;

        Console.WriteLine($"{ServiceHost.Name} is stopped. Nothing prints from the dashboard until it starts again.");
        return Program.ExitOk;
    }

    private static int Restart()
    {
        using var manager = OpenManager(Advapi.ScManagerConnect);
        using var service = manager == null
            ? null
            : OpenExisting(manager, Advapi.ServiceStop | Advapi.ServiceStart | Advapi.ServiceQueryStatus);
        if (service == null || !StopAndWait(service) || !StartAndWait(service, out var status))
            return Program.ExitFailed;

        Console.WriteLine($"{ServiceHost.Name} restarted · pid {status.ProcessId}");
        return Program.ExitOk;
    }

    /// <summary>
    /// Works from a normal window: Windows lets any signed-in user read a
    /// service's state and configuration.
    /// </summary>
    private static int Status()
    {
        using var manager = OpenManager(Advapi.ScManagerConnect);
        if (manager == null)
            return Program.ExitFailed;

        using var service = Advapi.OpenServiceW(manager, ServiceHost.Name, Advapi.ServiceQueryStatus | Advapi.ServiceQueryConfig);
        if (service.IsInvalid)
        {
            var error = Marshal.GetLastWin32Error();
            if (error == Advapi.ErrorServiceDoesNotExist)
            {
                Console.WriteLine($"{ServiceHost.Name}: not installed. The agent only prints while `QrPrinterAgent run` is open.");
                Console.WriteLine("To start it with Windows: QrPrinterAgent service install (administrator).");
            }
            else
            {
                Fail("could not open the service", error);
            }

            return Program.ExitFailed;
        }

        if (!TryQuery(service, out var status))
            return Program.ExitFailed;

        var config = QueryConfig(service);
        Console.WriteLine($"service     {ServiceHost.Name} ({ServiceHost.DisplayName})");
        Console.WriteLine($"state       {StateName(status.CurrentState)}" + (status.ProcessId != 0 ? $" · pid {status.ProcessId}" : ""));
        if (status.CurrentState == Advapi.Stopped && status.Win32ExitCode != 0)
            Console.WriteLine($"last exit   {ExitReason(status)}");
        if (config != null)
        {
            Console.WriteLine($"starts      {StartName(config.Value.StartType)}");
            Console.WriteLine($"account     {config.Value.Account}");
            Console.WriteLine($"binary      {config.Value.BinaryPath}");
        }

        Console.WriteLine($"log         {AgentPaths.LogFile}");
        return status.CurrentState == Advapi.Running ? Program.ExitOk : Program.ExitFailed;
    }

    private static bool StartAndWait(ScHandle service, out Advapi.ServiceStatusProcess status)
    {
        if (!Advapi.StartServiceW(service, 0, IntPtr.Zero))
        {
            var error = Marshal.GetLastWin32Error();
            if (error != Advapi.ErrorServiceAlreadyRunning)
            {
                status = default;
                return Fail("Windows would not start the service", error);
            }
        }

        var deadline = DateTime.UtcNow.AddSeconds(45);
        while (true)
        {
            if (!TryQuery(service, out status))
                return false;
            if (status.CurrentState == Advapi.Running)
                break;
            if (status.CurrentState == Advapi.Stopped)
                return ReportStopped(status);
            if (DateTime.UtcNow > deadline)
            {
                Console.Error.WriteLine("The service is still starting after 45 s. Check `QrPrinterAgent service status` in a minute.");
                return false;
            }

            Thread.Sleep(500);
        }

        // A service that dies a moment after it says "running" is still a failed start.
        Thread.Sleep(2_000);
        if (!TryQuery(service, out status))
            return false;
        return status.CurrentState == Advapi.Running || ReportStopped(status);
    }

    private static bool StopAndWait(ScHandle service)
    {
        var deadline = DateTime.UtcNow.AddSeconds(30);
        var asked = false;
        while (true)
        {
            if (!TryQuery(service, out var status))
                return false;
            if (status.CurrentState == Advapi.Stopped)
                return true;

            // A service still starting cannot take a stop yet, so wait for it.
            if (status.CurrentState == Advapi.Running && !asked)
            {
                if (!Advapi.ControlService(service, Advapi.ControlStop, out _))
                {
                    var error = Marshal.GetLastWin32Error();
                    if (error != Advapi.ErrorServiceNotActive)
                        return Fail("Windows would not stop the service", error);
                }

                asked = true;
            }

            if (DateTime.UtcNow > deadline)
            {
                Console.Error.WriteLine("The service did not stop within 30 s. It may be finishing a print; try again in a minute.");
                return false;
            }

            Thread.Sleep(500);
        }
    }

    private static bool ReportStopped(Advapi.ServiceStatusProcess status)
    {
        Console.Error.WriteLine($"The service started and then stopped: {ExitReason(status)}");
        PrintLogTail();
        return false;
    }

    private static string ExitReason(Advapi.ServiceStatusProcess status) => status.Win32ExitCode switch
    {
        0 => "it stopped without an error code",
        (uint)Advapi.ErrorServiceSpecificError => ServiceHost.DescribeExit((int)status.ServiceSpecificExitCode),
        _ => Describe((int)status.Win32ExitCode),
    };

    /// <summary>
    /// The log never holds document content, so its tail is safe to show and
    /// saves a support call from asking for it.
    /// </summary>
    private static void PrintLogTail(int count = 8)
    {
        try
        {
            using var stream = new FileStream(AgentPaths.LogFile, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete);
            using var reader = new StreamReader(stream);
            var tail = new Queue<string>(count + 1);
            while (reader.ReadLine() is { } line)
            {
                tail.Enqueue(line);
                if (tail.Count > count)
                    tail.Dequeue();
            }

            Console.Error.WriteLine($"\nlast lines of {AgentPaths.LogFile}:");
            foreach (var line in tail)
                Console.Error.WriteLine("  " + line);
        }
        catch (Exception error) when (error is IOException or UnauthorizedAccessException)
        {
        }
    }

    private static ScHandle? OpenManager(uint access)
    {
        var manager = Advapi.OpenSCManagerW(null, null, access);
        if (!manager.IsInvalid)
            return manager;

        var error = Marshal.GetLastWin32Error();
        manager.Dispose();
        Console.Error.WriteLine(error == Advapi.ErrorAccessDenied
            ? NeedsAdmin
            : $"cannot open the Windows service manager: {Describe(error)}");
        return null;
    }

    private static ScHandle? OpenExisting(ScHandle manager, uint access, bool missingIsError = true)
    {
        var service = Advapi.OpenServiceW(manager, ServiceHost.Name, access);
        if (!service.IsInvalid)
            return service;

        var error = Marshal.GetLastWin32Error();
        service.Dispose();
        if (error == Advapi.ErrorServiceDoesNotExist)
        {
            var message = $"{ServiceHost.Name} is not installed. Install it with: QrPrinterAgent service install (administrator).";
            if (missingIsError)
                Console.Error.WriteLine(message);
            else
                Console.WriteLine(message);
        }
        else
        {
            Console.Error.WriteLine(error == Advapi.ErrorAccessDenied ? NeedsAdmin : $"could not open the service: {Describe(error)}");
        }

        return null;
    }

    private static bool TryQuery(ScHandle service, out Advapi.ServiceStatusProcess status)
    {
        if (Advapi.QueryServiceStatusEx(service, 0, out status, (uint)Marshal.SizeOf<Advapi.ServiceStatusProcess>(), out _))
            return true;
        return Fail("could not read the service state", Marshal.GetLastWin32Error());
    }

    private static (uint StartType, string BinaryPath, string Account)? QueryConfig(ScHandle service)
    {
        Advapi.QueryServiceConfigW(service, IntPtr.Zero, 0, out var needed);
        if (needed == 0)
            return null;

        var buffer = Marshal.AllocHGlobal((int)needed);
        try
        {
            if (!Advapi.QueryServiceConfigW(service, buffer, needed, out _))
                return null;

            var raw = Marshal.PtrToStructure<Advapi.QueryServiceConfig>(buffer);
            return (raw.StartType,
                Marshal.PtrToStringUni(raw.BinaryPathName) ?? "",
                Marshal.PtrToStringUni(raw.ServiceStartName) ?? "");
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static string StateName(uint state) => state switch
    {
        Advapi.Stopped => "stopped",
        Advapi.StartPending => "starting",
        Advapi.StopPending => "stopping",
        Advapi.Running => "running",
        _ => $"state {state}",
    };

    private static string StartName(uint startType) => startType switch
    {
        Advapi.ServiceAutoStart => "automatically with Windows",
        Advapi.ServiceDemandStart => "only when started by hand",
        Advapi.ServiceDisabled => "never (disabled)",
        _ => $"start type {startType}",
    };

    private static string Describe(int error) => $"{new Win32Exception(error).Message} ({error})";

    private static bool Fail(string what, int error) => Fail($"{what}: {Describe(error)}");

    private static bool Fail(string message)
    {
        Console.Error.WriteLine(message);
        return false;
    }
}

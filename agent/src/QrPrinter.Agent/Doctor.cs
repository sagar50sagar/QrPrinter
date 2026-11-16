using System.Net.Http;
using System.Net.WebSockets;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Text;
using QrPrinter.Agent.Config;
using QrPrinter.Agent.Hardware;
using QrPrinter.Agent.Logging;

namespace QrPrinter.Agent;

/// <summary>
/// `QrPrinterAgent doctor` — reads everything the agent needs and reports
/// what it actually found, so a shop can be supported over the phone without
/// anyone guessing.
///
/// Exit code is 0 when nothing failed and 1 when something blocks printing.
/// Warnings never change the exit code; they only mean "printing may work,
/// but look at this".
/// </summary>
public static class Doctor
{
    private enum Status
    {
        Pass,
        Warn,
        Fail,
        Skip,
    }

    private sealed record Row(Status Status, string Name, string Detail);

    private static readonly List<Row> Rows = [];

    public static int Run(string[] args)
    {
        var verbose = args.Contains("--verbose") || args.Contains("-v");
        FileLog.Configure(verbose ? LogLevel.Debug : LogLevel.Info, echoToConsole: false);
        AgentPaths.EnsureDirectories();
        FileLog.Open(AgentPaths.LogFile);

        Console.WriteLine($"QrPrinter local agent — doctor{Environment.NewLine}");
        Rows.Clear();

        CheckBuild();
        CheckWritableHome();
        var config = CheckConfig();
        var identity = CheckIdentity();
        CheckSpooler();
        CheckAgentService();
        CheckPrinters(verbose);
        CheckSumatra(config);
        CheckStaleSpoolFiles(config);
        CheckResultQueue();
        if (config != null)
        {
            CheckServerReach(config);
            CheckChannel(config, identity);
        }
        else
            Add(Status.Skip, "server", "no config.json yet — run the agent once it has an api_base_url");

        Print(verbose);
        var failures = Rows.Count(r => r.Status == Status.Fail);
        FileLog.Close();
        return failures == 0 ? 0 : 1;
    }

    private static void CheckBuild()
    {
        var version = Assembly.GetExecutingAssembly().GetName().Version?.ToString(3) ?? "0.0.0";
        Add(
            Status.Pass,
            "build",
            $"v{version} · {RuntimeInformation.FrameworkDescription} · {RuntimeInformation.OSArchitecture} · 64-bit process {Environment.Is64BitProcess}");

        var os = RuntimeInformation.OSDescription;
        var windows = os.Contains("Windows", StringComparison.OrdinalIgnoreCase);
        Add(
            windows ? Status.Pass : Status.Fail,
            "operating system",
            windows ? os : $"{os} — this agent only talks to the Windows print spooler");
    }

    private static void CheckWritableHome()
    {
        try
        {
            var probe = Path.Combine(AgentPaths.Root, ".write-probe");
            File.WriteAllText(probe, "ok");
            File.Delete(probe);
            Add(Status.Pass, "agent data folder", AgentPaths.Root);
        }
        catch (Exception error)
        {
            Add(Status.Fail, "agent data folder", $"{AgentPaths.Root} is not writable: {error.Message}");
        }
    }

    private static AgentConfig? CheckConfig()
    {
        if (!File.Exists(AgentPaths.ConfigFile))
        {
            Add(Status.Warn, "config.json", "missing — the agent will use defaults until it is paired");
            return null;
        }

        try
        {
            var config = AgentConfig.Load();
            Add(
                config.AgentSocketUrl.StartsWith("wss", StringComparison.OrdinalIgnoreCase) ? Status.Pass : Status.Warn,
                "config.json",
                $"api {config.ApiBaseUrl} · socket {config.AgentSocketUrl} · heartbeat {config.HeartbeatSeconds}s · one job at a time={config.MaxConcurrentJobs == 1}");
            return config;
        }
        catch (Exception error)
        {
            Add(Status.Fail, "config.json", $"unreadable: {error.Message}");
            return null;
        }
    }

    private static DeviceIdentity? CheckIdentity()
    {
        if (!File.Exists(AgentPaths.IdentityFile))
        {
            Add(Status.Warn, "pairing", "this device is not paired yet — run `QrPrinterAgent pair <code>`");
            return null;
        }

        try
        {
            var identity = DeviceIdentity.Load();
            if (identity == null)
            {
                Add(Status.Fail, "pairing", "device.json exists but holds no identity — delete it and pair again");
                return null;
            }

            var age = DateTimeOffset.UtcNow - identity.PairedAtUtc;
            Add(Status.Pass, "pairing", $"device {identity.DeviceId} · paired {Math.Max(0, age.TotalDays):F0} days ago");
            return identity;
        }
        catch (Exception error)
        {
            Add(Status.Fail, "pairing", $"device.json is unreadable: {error.Message}");
            return null;
        }
    }

    private static void CheckSpooler()
    {
        var spooler = ServiceProbe.Query("Spooler");
        Add(
            spooler.Running ? Status.Pass : Status.Fail,
            "print spooler service",
            spooler.Running
                ? "running"
                : $"{spooler} — Windows cannot print anything while this is stopped (services.msc → Print Spooler → Start)");
    }

    /// <summary>
    /// A warning, never a failure: `run` in a window prints just as well, it
    /// only stops when the window closes or the PC restarts.
    /// </summary>
    private static void CheckAgentService()
    {
        var service = ServiceProbe.Query(Service.ServiceHost.Name);
        if (service.Running)
        {
            Add(Status.Pass, "agent service", $"{Service.ServiceHost.Name} running as {Service.ServiceHost.Account}");
            return;
        }

        Add(
            Status.Warn,
            "agent service",
            service.Found
                ? $"{Service.ServiceHost.Name} is {service.StateName}, so nothing prints unless `QrPrinterAgent run` is open. " +
                  "`QrPrinterAgent service status` shows why it stopped; `service start` (administrator) starts it"
                : service.Win32Error == 1060
                    ? "not installed, so the agent only prints while `QrPrinterAgent run` is open. " +
                      "`QrPrinterAgent service install` (administrator) starts it with Windows"
                    : $"could not be read: {service}");
    }

    private static void CheckPrinters(bool verbose)
    {
        var scan = PrinterRepository.Scan();
        if (!scan.Ok)
        {
            Add(Status.Fail, "printer list", scan.ErrorDetail ?? WinSpool.DescribeError(scan.Win32Error));
            return;
        }

        var usable = PrinterRepository.Selectable(scan);
        var state = scan.IncludesStatus
            ? $"{scan.Printers.Count} installed · {usable.Count} printable · online {usable.Count(p => p.State is PrinterState.Ready or PrinterState.Busy)}"
            : $"{scan.Printers.Count} names only (status needs level 2, which this account was refused)";

        // No real queue at all is what blocks printing, so it is a FAIL, not a
        // tick — reporting printers installed while every one of them is a
        // virtual queue would send support looking in the wrong place.
        var status = usable.Count == 0
            ? Status.Fail
            : usable.Any(p => p.State is PrinterState.Ready or PrinterState.Busy) ? Status.Pass : Status.Warn;
        var summary = usable.Count == 0
            ? scan.Printers.Count == 0
                ? "Windows has no printers installed on this machine"
                : $"none of the {scan.Printers.Count} queues here is a real device — they are all virtual (Print to PDF, OneNote and the like)"
            : state;

        Add(status, "printers", summary);
        if (scan.ErrorDetail is { Length: > 0 })
            Add(Status.Warn, "printer detail", scan.ErrorDetail);

        if (!verbose)
            return;

        foreach (var printer in scan.Printers)
        {
            // Reading the queue is the real test of whether the agent account can
            // open the printer; a listed printer is not the same as a usable one.
            var read = SpoolerJobs.Read(printer.Endpoint);
            var detail = read.Win32Error != 0
                ? WinSpool.DescribeError(read.Win32Error)
                : $"{printer.State} · {printer.QueueLength} in queue · {printer.Port ?? "port unknown"}" +
                  (printer.StateReason.Length > 0 ? $" · {printer.StateReason}" : "") +
                  (read.Truncated
                      ? " · queue holds more jobs than the read buffer"
                      : read.Jobs.Count > 0 ? $" · spooler shows {read.Jobs.Count} live entries" : "");

            Add(read.Win32Error == 0 && !read.Truncated
                ? Status.Pass
                : read.Win32Error == 0 ? Status.Warn : Status.Fail, printer.Name, detail);
        }
    }

    private static void CheckSumatra(AgentConfig? config)
    {
        var path = config?.SumatraExe() ?? Path.Combine(AgentPaths.AppDirectory, "SumatraPDF.exe");
        if (File.Exists(path))
        {
            var info = new FileInfo(path);
            var version = info.Length > 0 ? $"{info.Length / 1024} KB" : "empty file";
            Add(Status.Pass, "SumatraPDF", $"{path} · {version}");
        }
        else
        {
            Add(
                Status.Fail,
                "SumatraPDF",
                $"{path} is missing. Put SumatraPDF.exe next to the agent — it is the component that hands a PDF to a printer.");
        }
    }

    private static void CheckStaleSpoolFiles(AgentConfig? config)
    {
        var hours = config?.StaleSpoolHours ?? 6;
        try
        {
            var cutoff = DateTime.UtcNow - TimeSpan.FromHours(hours);
            var stale = Directory.EnumerateFiles(AgentPaths.SpoolDir, "QP-*.pdf")
                .Select(File.GetLastWriteTimeUtc)
                .Where(write => write < cutoff)
                .Count();

            Add(
                stale == 0 ? Status.Pass : Status.Warn,
                "leftover documents",
                stale == 0
                    ? $"{AgentPaths.SpoolDir} is clean"
                    : $"{stale} QP-*.pdf file(s) older than {hours}h are still on disk in {AgentPaths.SpoolDir}. They hold customer pages, so delete them before the print path starts writing there.");
        }
        catch (Exception error)
        {
            Add(Status.Warn, "leftover documents", error.Message);
        }
    }

    private static void CheckServerReach(AgentConfig config)
    {
        using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(6) };
        var url = config.ApiBaseUrl.TrimEnd('/') + "/api/agent/health";
        try
        {
            using var response = client.GetAsync(url, HttpCompletionOption.ResponseHeadersRead).GetAwaiter().GetResult();

            // Any HTTP answer at all means the hard part worked: the name resolved,
            // the TCP connection opened and the certificate was accepted. A 404 from
            // a server that has no health route is not a fault, and saying so is
            // more useful to a shop than a warning they cannot act on.
            Add(
                response.IsSuccessStatusCode ? Status.Pass : Status.Warn,
                "server",
                response.IsSuccessStatusCode
                    ? $"GET {url} → {(int)response.StatusCode}"
                    : $"reached {config.ApiBaseUrl} but it answered {(int)response.StatusCode} to the health route");
        }
        catch (Exception error)
        {
            Add(Status.Fail, "server", $"cannot reach {config.ApiBaseUrl}: {error.Message}");
        }
    }

    /// <summary>
    /// Opens the job channel the way the running agent does, reads the server's
    /// first frame and leaves again.
    ///
    /// This is the only check that proves the wss route, the bearer token and the
    /// firewall together. It does take the device's channel slot for a moment: if
    /// the agent is running right now, it falls back to polling for a few seconds,
    /// which is why the line says so.
    /// </summary>
    private static void CheckChannel(AgentConfig config, DeviceIdentity? identity)
    {
        if (identity == null)
        {
            Add(Status.Skip, "job channel", "not paired — the channel needs a device token");
            return;
        }

        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(8));
        using var socket = new ClientWebSocket();
        socket.Options.SetRequestHeader("Authorization", $"Bearer {identity.Token}");
        socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(15);

        try
        {
            socket.ConnectAsync(new Uri(config.AgentSocketUrl), timeout.Token).GetAwaiter().GetResult();

            var buffer = new byte[8192];
            var received = socket.ReceiveAsync(new ArraySegment<byte>(buffer), timeout.Token).GetAwaiter().GetResult();
            var frame = received.MessageType == WebSocketMessageType.Text
                ? Net.Wire.TryDeserialize<Net.ChannelFrame>(Encoding.UTF8.GetString(buffer, 0, received.Count))
                : null;

            var type = frame?.Type ?? "nothing readable";
            Add(
                type == Net.FrameTypes.Welcome ? Status.Pass : Status.Warn,
                "job channel",
                type == Net.FrameTypes.Welcome
                    ? $"{config.AgentSocketUrl} → welcome (a running agent polls for a few seconds after this)"
                    : $"connected to {config.AgentSocketUrl} but the first frame was '{type}'");
        }
        catch (Exception error)
        {
            var reason = error is OperationCanceledException ? "no answer within 8s" : error.Message;
            Add(Status.Warn, "job channel", $"could not open {config.AgentSocketUrl}: {reason}");
            return;
        }

        try
        {
            socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "doctor", CancellationToken.None).GetAwaiter().GetResult();
        }
        catch (WebSocketException)
        {
            // The server already hung up; nothing a shop can do about that.
        }
    }

    /// <summary>
    /// Finished jobs the server has not acknowledged yet. Each one is a customer
    /// page whose story the dashboard does not have, so this is worth saying out
    /// loud — but it is a warning, not a failure: it flushes itself on the next
    /// connection.
    /// </summary>
    private static void CheckResultQueue()
    {
        var directory = Path.Combine(AgentPaths.Root, "outbox");
        try
        {
            if (!System.IO.Directory.Exists(directory))
            {
                Add(Status.Pass, "result queue", "nothing waiting");
                return;
            }

            var files = new DirectoryInfo(directory).GetFiles("*.json");
            if (files.Length == 0)
            {
                Add(Status.Pass, "result queue", "nothing waiting");
                return;
            }

            var oldest = files.Min(file => file.LastWriteTimeUtc);
            Add(
                Status.Warn,
                "result queue",
                $"{files.Length} result(s) unacknowledged, oldest {(DateTime.UtcNow - oldest).TotalMinutes:F0} min ago — they send themselves once the server is reachable");
        }
        catch (Exception error)
        {
            Add(Status.Warn, "result queue", error.Message);
        }
    }

    private static void Add(Status status, string name, string detail) => Rows.Add(new Row(status, name, detail));

    private static void Print(bool verbose)
    {
        foreach (var row in Rows)
        {
            if (!verbose && row.Status == Status.Pass)
                continue;

            Console.WriteLine($"{Icon(row.Status)} {row.Name,-24} {row.Detail}");
        }

        if (!verbose)
        {
            var passed = Rows.Count(r => r.Status == Status.Pass);
            Console.WriteLine($"\n{passed} check(s) passed silently. Re-run with --verbose to see them.");
        }

        Console.WriteLine();
        Console.WriteLine(Rows.Any(r => r.Status == Status.Fail)
            ? "Result: not ready. Fix the FAIL lines above, then run doctor again."
            : Rows.Any(r => r.Status == Status.Warn)
                ? "Result: ready to run, with the warnings above."
                : "Result: ready to run.");
    }

    private static string Icon(Status status) => status switch
    {
        Status.Pass => "[ok]  ",
        Status.Warn => "[warn]",
        Status.Fail => "[FAIL]",
        _ => "[skip]",
    };
}

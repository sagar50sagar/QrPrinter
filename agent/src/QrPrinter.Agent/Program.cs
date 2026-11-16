using System.Runtime.InteropServices;
using System.Text;
using QrPrinter.Agent.Config;
using QrPrinter.Agent.Hardware;
using QrPrinter.Agent.Logging;
using QrPrinter.Agent.Net;
using QrPrinter.Agent.Printing;
using QrPrinter.Agent.Service;

namespace QrPrinter.Agent;

/// <summary>
/// Command line entry point.
///
/// Verbs that need the cloud channel or the print backend answer honestly that
/// the module is not in this build rather than pretending to succeed.
/// </summary>
public static class Program
{
    public const int ExitOk = 0;
    public const int ExitFailed = 1;
    public const int ExitUsage = 2;

    private static int Main(string[] args)
    {
        var verb = args.Length == 0 ? "help" : args[0].ToLowerInvariant();
        var rest = args.Skip(1).ToArray();

        // A service has no console to set an encoding on.
        if (verb != "service-run")
            TryEnableUnicodeConsole();

        try
        {
            return verb switch
            {
                "printers" => Printers(rest),
                "queue" => Queue(rest),
                "doctor" => Doctor.Run(rest),
                "test-print" => TestPrint(rest),
                "pair" => Pairing.RunAsync(rest).GetAwaiter().GetResult(),
                "run" => Runner.RunAsync(rest).GetAwaiter().GetResult(),
                "service" => ServiceCommand.Run(rest),
                "service-run" => ServiceHost.Run(),
                "version" or "--version" => Version(),
                "help" or "--help" or "-h" => Help(),
                _ => Unknown(verb),
            };
        }
        catch (Exception error)
        {
            Console.Error.WriteLine($"the agent stopped unexpectedly: {error.Message}");
            FileLog.Error("unhandled error", error);
            return ExitFailed;
        }
        finally
        {
            FileLog.Close();
        }
    }

    /// <summary>
    /// `printers` — what the agent can see, in the same shape a heartbeat will
    /// later send to the server.
    /// </summary>
    private static int Printers(string[] args)
    {
        var scan = PrinterRepository.Scan();
        if (!scan.Ok)
        {
            Console.Error.WriteLine($"cannot read the printer list: {scan.ErrorDetail}");
            return ExitFailed;
        }

        var printers = args.Contains("--all")
            ? scan.Printers
            : PrinterRepository.Selectable(scan);

        if (args.Contains("--json"))
        {
            // The same shape the heartbeat sends. --all widens it to include the
            // virtual queues, which is the only difference.
            var inventory = new PrinterInventory(
                Environment.MachineName,
                scan.IncludesStatus,
                printers.Select(PrinterWire.From).ToList());
            Console.WriteLine(Wire.Serialize(inventory));

            return ExitOk;
        }

        Console.WriteLine(scan.IncludesStatus
            ? $"Printers on {Environment.MachineName}  ({printers.Count} shown, {scan.Printers.Count} installed)"
            : $"Printers on {Environment.MachineName}  (names only — status needs printer information level 2)");
        Console.WriteLine();

        if (printers.Count == 0)
        {
            // Saying "install a printer" when the machine has queues that are all
            // virtual would send support chasing the wrong thing.
            Console.WriteLine(scan.Printers.Count == 0
                ? "Nothing to print to. Install a printer in Windows first."
                : $"No real device here — all {scan.Printers.Count} queues are virtual (Print to PDF, OneNote and the like). Add --all to list them.");
            return ExitOk;
        }

        foreach (var printer in printers)
            Console.WriteLine("  " + printer);

        Console.WriteLine();
        Console.WriteLine("Ready means the spooler says the device will take a job.");
        Console.WriteLine("Use --all to include virtual queues like Print to PDF, --json for machine output.");
        return ExitOk;
    }

    /// <summary>
    /// `queue &lt;printer&gt;` — what is sitting in a queue right now. Support
    /// uses this to see the job the agent thinks it sent.
    /// </summary>
    private static int Queue(string[] args)
    {
        var positional = args.Where(argument => !argument.StartsWith('-')).ToArray();
        var scan = PrinterRepository.Scan();
        if (!scan.Ok)
        {
            Console.Error.WriteLine($"cannot read the printer list: {scan.ErrorDetail}");
            return ExitFailed;
        }

        var names = positional.Length > 0
            ? new[] { positional[0] }
            : scan.Printers.Select(printer => printer.Endpoint).ToArray();

        if (positional.Length > 0 && scan.Printers.All(printer =>
                !string.Equals(printer.Name, positional[0], StringComparison.OrdinalIgnoreCase)))
        {
            Console.Error.WriteLine($"'{positional[0]}' is not installed here. Run `QrPrinterAgent printers`.");
            return ExitUsage;
        }

        foreach (var name in names)
        {
            var read = SpoolerJobs.Read(name);
            Console.WriteLine($"{name}:");
            if (read.Win32Error != 0)
            {
                Console.WriteLine($"    unreadable — {WinSpool.DescribeError(read.Win32Error)}");
                continue;
            }

            if (read.Truncated)
            {
                Console.WriteLine("    unreadable — Windows reported more jobs than the buffer could hold");
                continue;
            }

            if (read.Jobs.Count == 0)
            {
                Console.WriteLine("    empty");
                continue;
            }

            foreach (var job in read.Jobs)
            {
                var pages = job.TotalPages > 0 ? $"{job.PagesPrinted}/{job.TotalPages} pages" : "page count unknown";
                Console.WriteLine(
                    $"    #{job.JobId,-6} pos {job.Position,-3} {job.Document,-32} {job.Status,-38} {pages}" +
                    (job.SubmittedBy is { Length: > 0 } ? $" by {job.SubmittedBy}" : "") +
                    (job.StatusText is { Length: > 0 } ? $"  [{job.StatusText}]" : ""));
            }
        }

        return ExitOk;
    }

    /// <summary>
    /// `test-print &lt;printer&gt; &lt;file.pdf&gt;` — send one document that is
    /// already on this machine. This is how the print path is checked against
    /// real hardware before any server exists.
    /// </summary>
    private static int TestPrint(string[] args)
    {
        var positional = args.Where(argument => !argument.StartsWith('-')).ToArray();
        if (positional.Length < 2)
        {
            Console.Error.WriteLine(
                "usage: QrPrinterAgent test-print \"<printer name>\" <file.pdf> " +
                "[--copies N] [--duplex] [--color] [--paper A4] [--allow-virtual]");
            return ExitUsage;
        }

        var printer = positional[0];
        var file = Path.GetFullPath(positional[1]);
        if (!File.Exists(file))
        {
            Console.Error.WriteLine($"no file at {file}");
            return ExitUsage;
        }

        // Only a human at this keyboard can set it. A job arriving over the
        // websocket never goes through this verb, so it can never be aimed at a
        // virtual queue.
        var allowVirtual = args.Contains("--allow-virtual");

        var config = LoadConfigForLocalRun();
        var request = new PrintRequest(
            JobId: $"TEST-{DateTime.UtcNow:yyyyMMddHHmmss}",
            Printer: printer,
            Copies: IntFlag(args, "--copies", 1),
            Duplex: args.Contains("--duplex"),
            Colour: args.Contains("--color") || args.Contains("--colour"),
            Paper: StringFlag(args, "--paper", "A4"));

        AgentPaths.EnsureDirectories();
        FileLog.Open(AgentPaths.LogFile);

        try
        {
            Console.WriteLine($"printer  : {printer}");
            Console.WriteLine($"document : {Path.GetFileName(file)} ({new FileInfo(file).Length:N0} bytes)");
            Console.WriteLine($"settings : {PrintSettings.Build(request)}");
            Console.WriteLine($"copies   : {request.Copies} (one queue job each, confirmed one at a time)");
            Console.WriteLine($"backend  : {SumatraPdfBackend.DescribeInvocation(
                config.SumatraExe(),
                SumatraPdfBackend.Arguments(printer, PrintSettings.Build(request), file))}");
            Console.WriteLine();

            // Refuse before announcing that paper is coming out.
            var (target, rejection) = PrintJobExecutor.Inspect(request, allowVirtual);
            if (rejection != null)
            {
                Console.WriteLine();
                Console.WriteLine($"{rejection.Status.ToString().ToUpperInvariant()} · {rejection.Stage}");
                Console.WriteLine(rejection.Detail);
                return ExitFailed;
            }

            Console.WriteLine($"Waiting for {target!.Name} to confirm. A page should come out.");

            var result = PrintJobExecutor
                .ExecuteLocalFileAsync(request, file, config, allowVirtualQueue: allowVirtual)
                .GetAwaiter()
                .GetResult();

            Console.WriteLine();
            Console.WriteLine($"{result.Status.ToString().ToUpperInvariant()} · {result.Stage}");
            Console.WriteLine(result.Detail);
            Console.WriteLine();
            Console.WriteLine($"The staged copy was removed from {AgentPaths.SpoolDir}.");

            return result.Status == PrintResultStatus.Printed ? ExitOk : ExitFailed;
        }
        catch (ArgumentException error)
        {
            Console.Error.WriteLine(error.Message);
            return ExitUsage;
        }
        finally
        {
            FileLog.Close();
        }
    }

    /// <summary>
    /// config.json if it is there, otherwise a loopback-only config so the
    /// hardware path can be tested on a bench with no server to point at.
    /// </summary>
    private static AgentConfig LoadConfigForLocalRun()
    {
        if (File.Exists(AgentPaths.ConfigFile))
        {
            try
            {
                return AgentConfig.Load();
            }
            catch (Exception error)
            {
                Console.Error.WriteLine($"config.json was ignored: {error.Message}");
            }
        }

        return new AgentConfig
        {
            ApiBaseUrl = "http://127.0.0.1",
            AgentSocketUrl = "ws://127.0.0.1",
        };
    }

    private static int IntFlag(string[] args, string name, int fallback)
    {
        var index = Array.IndexOf(args, name);
        if (index < 0 || index + 1 >= args.Length)
            return fallback;

        return int.TryParse(args[index + 1], out var value) ? value : fallback;
    }

    private static string StringFlag(string[] args, string name, string fallback)
    {
        var index = Array.IndexOf(args, name);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : fallback;
    }

    private static int Version()
    {
        var assembly = typeof(Program).Assembly;
        var name = assembly.GetName();
        var informational = assembly
            .GetCustomAttributes(typeof(System.Reflection.AssemblyInformationalVersionAttribute), false)
            .Cast<System.Reflection.AssemblyInformationalVersionAttribute>()
            .FirstOrDefault()?.InformationalVersion ?? name.Version?.ToString() ?? "unknown";

        Console.WriteLine(
            $"QrPrinter local agent {informational} ({RuntimeInformation.OSDescription}, {RuntimeInformation.FrameworkDescription})");
        return ExitOk;
    }

    private static int Help()
    {
        Console.WriteLine("""
            QrPrinter local agent
            Runs on the shop PC and is the only thing that touches the printers.

              QrPrinterAgent printers [--json] [--all]
                  List the printers this machine can see and their live state.

              QrPrinterAgent doctor [--verbose]
                  Check the spooler service, printer access, config, pairing,
                  SumatraPDF and the data folder. Exit code 1 means printing
                  cannot work yet.

              QrPrinterAgent queue [printer]
                  Show the jobs sitting in a print queue right now. Without a
                  printer name it checks every queue on this machine.

              QrPrinterAgent test-print "<printer>" <file.pdf>
                  Print a document that is already on this machine, through the
                  same path a remote job will use. Options:
                    --copies N   --duplex   --color   --paper A4
                    --allow-virtual  also lets a bench with no real device print
                                     to a virtual queue (a human flag only; a
                                     job from the server can never set it)
                  The file is staged, printed, then deleted; nothing about its
                  contents is logged.

              QrPrinterAgent pair <CODE> [--api URL] [--socket URL]
                  Trade a pairing code from the dashboard for a device token,
                  saved as device.json. Needs --api and --socket the first time,
                  when there is no config.json to read them from.

              QrPrinterAgent run [--once]
                  The long-running agent in this window: heartbeat, job
                  channel, poll and result retry. --once does one heartbeat
                  plus one poll and exits, which is what support asks for.
                  Refuses to start while the service is running.

              QrPrinterAgent service install|uninstall|start|stop|restart|status
                  The same agent as a Windows service that starts with the PC,
                  before anyone signs in, and restarts itself after a failure.
                  It runs as NT SERVICE\QrPrinterAgent, not SYSTEM. Install,
                  start and stop need an administrator window, and install
                  only works from a copy in Program Files. status works from
                  any window.

              QrPrinterAgent version
                  Print the version and runtime.

            Data lives in %PROGRAMDATA%\QrPrinter Agent (override with
            QPRINTER_AGENT_HOME). Logs go to agent.log there. Document content
            is never written to the log.
            """);
        return ExitOk;
    }

    private static int Unknown(string verb)
    {
        Console.Error.WriteLine($"unknown command '{verb}'. Run QrPrinterAgent help.");
        return ExitUsage;
    }

    private static void TryEnableUnicodeConsole()
    {
        // Printer names carry shop text; a blocked console encoding would turn
        // them into question marks. Never fatal when stdout is redirected.
        try
        {
            if (OperatingSystem.IsWindows())
                Console.OutputEncoding = Encoding.UTF8;
        }
        catch (IOException)
        {
        }
    }
}

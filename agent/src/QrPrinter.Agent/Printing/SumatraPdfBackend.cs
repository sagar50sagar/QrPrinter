using System.Diagnostics;
using System.Text;
using QrPrinter.Agent.Config;

namespace QrPrinter.Agent.Printing;

/// <summary>
/// What handing a document to the print backend returned.
/// </summary>
public sealed record PrintRun(bool Started, int ExitCode, bool TimedOut, string Detail)
{
    /// <summary>
    /// Only true when the process itself reported success. Whether paper came
    /// out of the device is a separate question answered by the spooler watch.
    /// </summary>
    public bool Succeeded => Started && !TimedOut && ExitCode == 0;

    public static PrintRun NotStarted(string detail) => new(false, -1, false, detail);
}

/// <summary>
/// SumatraPDF used as a sidecar: it is the piece that turns a PDF into a
/// driver call, which is the single hardest part of printing reliably on
/// Windows from a headless process.
///
/// The executable is shipped next to the agent, not downloaded at runtime, so
/// nothing here can pull a different binary onto a shop machine.
/// </summary>
public static class SumatraPdfBackend
{
    /// <summary>
    /// The arguments, one element each. Using ArgumentList instead of one
    /// command-line string means the printer name and the settings value are
    /// quoted by the runtime and cannot become extra flags.
    /// </summary>
    public static IReadOnlyList<string> Arguments(string printer, string settings, string documentPath) =>
    [
        "-print-to",
        printer,
        "-print-settings",
        settings,
        // No window and no dialog: this runs unattended on a counter PC.
        "-silent",
        // Close as soon as the document is handed over, so the wait is bounded.
        "-exit-when-done",
        "-appdata",
        AgentPaths.SumatraDataDir,
        documentPath,
    ];

    public static string DescribeInvocation(string exePath, IReadOnlyList<string> arguments)
    {
        var line = new StringBuilder(Path.GetFileName(exePath));
        foreach (var argument in arguments)
            line.Append(' ').Append(argument.Contains(' ') ? $"\"{argument}\"" : argument);
        return line.ToString();
    }

    public static PrintRun Submit(
        string exePath,
        string printer,
        string settings,
        string documentPath,
        TimeSpan timeout)
    {
        if (!File.Exists(exePath))
            return PrintRun.NotStarted($"{exePath} is missing. Put SumatraPDF.exe next to the agent, then run doctor.");
        if (!File.Exists(documentPath))
            return PrintRun.NotStarted("the spooled document vanished before printing");

        var arguments = Arguments(printer, settings, documentPath);

        var startInfo = new ProcessStartInfo
        {
            FileName = exePath,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardError = true,
            RedirectStandardOutput = true,
            WorkingDirectory = Path.GetDirectoryName(exePath) ?? AppContext.BaseDirectory,
        };

        foreach (var argument in arguments)
            startInfo.ArgumentList.Add(argument);

        Process process;
        try
        {
            process = Process.Start(startInfo)
                ?? throw new InvalidOperationException("the print backend did not start");
        }
        catch (Exception error)
        {
            return PrintRun.NotStarted($"could not start the print backend: {error.Message}");
        }

        using (process)
        {
            var stderr = new StringBuilder();
            process.ErrorDataReceived += (_, eventArgs) =>
            {
                if (eventArgs.Data != null)
                    stderr.Append(eventArgs.Data).Append(' ');
            };
            process.BeginErrorReadLine();
            // stdout is drained so the child can never block on a full pipe.
            // BeginOutputReadLine rather than ReadToEndAsync: the discarded task
            // would leave the drain unobserved if it ever faulted.
            process.OutputDataReceived += Drain;
            process.BeginOutputReadLine();

            var exited = process.WaitForExit((int)Math.Clamp(timeout.TotalMilliseconds, 1000, 600_000));
            if (!exited)
            {
                TryKill(process);
                return new PrintRun(true, -1, true,
                    $"the print backend was still running after {(int)timeout.TotalSeconds}s and was stopped");
            }

            // The timed overload only guarantees the process left; this flushes
            // the async readers so nothing Sumatra printed is lost.
            process.WaitForExit();
            var code = process.ExitCode;
            var detail = stderr.ToString().Trim();
            if (detail.Length > 400)
                detail = detail[..400] + "…";

            return new PrintRun(true, code, false, code == 0
                ? detail.Length == 0 ? "handed to the driver" : detail
                : detail.Length == 0 ? $"the print backend exited with code {code}" : detail);
        }
    }

    private static void Drain(object sender, DataReceivedEventArgs line)
    {
        // Deliberately dropped: document titles and page text must not reach the
        // log. Only stderr is kept, and only when the run failed.
    }

    private static void TryKill(Process process)
    {
        try
        {
            if (!process.HasExited)
                process.Kill(entireProcessTree: true);
        }
        catch (Exception)
        {
            // It already left, or it is not ours to stop.
        }
    }
}

using System.Text;

namespace QrPrinter.Agent.Logging;

/// <summary>
/// Levels the agent emits. Debug only reaches the file when the config asks
/// for it, so a normal install leaves a readable log rather than a flood.
/// </summary>
public enum LogLevel
{
    Debug = 0,
    Info = 1,
    Warn = 2,
    Error = 3,
}

/// <summary>
/// One plain-text log file, mirrored to stdout when the agent has a console.
///
/// The one rule that matters: document content, file paths of customer
/// documents and job payloads never go in here. A job is identified by its
/// id and its printer, nothing more.
/// </summary>
public static class FileLog
{
    private const int MaxBytes = 2 * 1024 * 1024;
    private const int KeepBackups = 2;

    private static readonly object Gate = new();
    private static StreamWriter? _writer;
    private static LogLevel _min = LogLevel.Info;
    private static bool _echoToConsole = true;

    public static void Configure(LogLevel minimum, bool echoToConsole)
    {
        _min = minimum;
        _echoToConsole = echoToConsole;
    }

    public static void Open(string path)
    {
        lock (Gate)
        {
            if (_writer != null)
                return;

            var directory = Path.GetDirectoryName(path);
            if (directory != null)
                Directory.CreateDirectory(directory);

            _writer = new StreamWriter(
                new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite, 4096),
                new UTF8Encoding(false),
                4096)
            {
                AutoFlush = true,
            };
        }
    }

    public static void Close()
    {
        lock (Gate)
        {
            _writer?.Dispose();
            _writer = null;
        }
    }

    public static void Debug(string message) => Write(LogLevel.Debug, message, null);
    public static void Info(string message) => Write(LogLevel.Info, message, null);
    public static void Warn(string message) => Write(LogLevel.Warn, message, null);
    public static void Warn(string message, Exception error) => Write(LogLevel.Warn, message, error);
    public static void Error(string message, Exception? error = null) => Write(LogLevel.Error, message, error);

    public static void Write(LogLevel level, string message, Exception? error)
    {
        if (level < _min)
            return;

        var line = $"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} {LevelTag(level)} {message}";
        if (error != null)
            line += $" [{error.GetType().Name}] {Collapse(error.Message)}";

        if (_echoToConsole)
        {
            try
            {
                // A Windows service has no console; writing to it would throw inside the log call.
                if (Environment.UserInteractive)
                    Console.Error.WriteLine(line);
            }
            catch (IOException)
            {
            }
        }

        lock (Gate)
        {
            if (_writer == null)
                return;
            try
            {
                RotateIfNeeded();
                _writer.WriteLine(line);
            }
            catch (IOException)
            {
                // Never let a full or locked log file take down printing.
            }
        }
    }

    private static string LevelTag(LogLevel level) => level switch
    {
        LogLevel.Debug => "DEBUG",
        LogLevel.Warn => "WARN ",
        LogLevel.Error => "ERROR",
        _ => "INFO ",
    };

    private static string Collapse(string text) => text.Replace('\r', ' ').Replace('\n', ' ');

    private static void RotateIfNeeded()
    {
        var path = _writer!.BaseStream is FileStream fs ? fs.Name : null;
        if (path == null)
            return;

        long size = 0;
        try
        {
            size = new FileInfo(path).Length;
        }
        catch (IOException)
        {
            return;
        }

        if (size < MaxBytes)
            return;

        Close();
        for (var i = KeepBackups - 1; i >= 1; i--)
        {
            var from = BackupName(path, i);
            if (File.Exists(from))
                File.Move(from, BackupName(path, i + 1), overwrite: true);
        }

        File.Move(path, BackupName(path, 1), overwrite: true);
        Open(path);
    }

    private static string BackupName(string path, int index) => $"{path}.{index}";
}

namespace QrPrinter.Agent.Config;

/// <summary>
/// Everything the agent writes lives under %PROGRAMDATA%\QrPrinter Agent so a
/// repair or reinstall never loses the pairing, and a service running as
/// LocalSystem can still reach it.
/// </summary>
public static class AgentPaths
{
    public static string Root
    {
        get
        {
            var overwrite = Environment.GetEnvironmentVariable("QPRINTER_AGENT_HOME");
            if (!string.IsNullOrWhiteSpace(overwrite)) return overwrite;

            var programData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
            return Path.Combine(programData, "QrPrinter Agent");
        }
    }

    public static string ConfigFile => Path.Combine(Root, "config.json");
    public static string IdentityFile => Path.Combine(Root, "device.json");
    public static string LogFile => Path.Combine(Root, "agent.log");
    public static string SpoolDir => Path.Combine(Root, "spool");

    /// <summary>
    /// SumatraPDF's settings file. Left to itself it writes beside its exe,
    /// which under Program Files the service account cannot do.
    /// </summary>
    public static string SumatraDataDir => Path.Combine(Root, "sumatra");

    public static void EnsureDirectories()
    {
        Directory.CreateDirectory(Root);
        Directory.CreateDirectory(SpoolDir);
        Directory.CreateDirectory(SumatraDataDir);
    }

    /// <summary>Directory the agent exe itself lives in — where SumatraPDF is dropped.</summary>
    public static string AppDirectory => AppContext.BaseDirectory;
}

using System.Text.Json;
using System.Text.Json.Serialization;

namespace QrPrinter.Agent.Config;

public sealed record AgentConfig
{
    /// <summary>HTTPS origin the agent pairs and polls against.</summary>
    public required string ApiBaseUrl { get; init; }

    /// <summary>Websocket origin for the always-outbound job channel.</summary>
    public required string AgentSocketUrl { get; init; }

    public int HeartbeatSeconds { get; init; } = 20;
    public int ReconnectMaxSeconds { get; init; } = 60;
    public int PrintTimeoutSeconds { get; init; } = 180;
    public int JobConfirmTimeoutSeconds { get; init; } = 120;
    public long MaxDocumentBytes { get; init; } = 64L * 1024 * 1024;
    public int StaleSpoolHours { get; init; } = 6;

    /// <summary>0 means one job at a time, which is what a single printer deserves.</summary>
    public int MaxConcurrentJobs { get; init; } = 1;

    /// <summary>SumatraPDF.exe beside the agent unless this points somewhere else.</summary>
    public string? SumatraPdfPath { get; init; }

    public string Label { get; init; } = "";

    private static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    public static AgentConfig LoadOrCreate(string apiBase, string socketUrl)
    {
        if (File.Exists(AgentPaths.ConfigFile)) return Load();

        var created = new AgentConfig { ApiBaseUrl = apiBase, AgentSocketUrl = socketUrl };
        created.Save();
        return created;
    }

    public static AgentConfig Load()
    {
        var json = File.ReadAllText(AgentPaths.ConfigFile);
        var config = JsonSerializer.Deserialize<AgentConfig>(json, Json)
            ?? throw new InvalidOperationException("config.json deserialised to null");
        return config.Validate();
    }

    public AgentConfig Validate()
    {
        if (!Uri.TryCreate(ApiBaseUrl, UriKind.Absolute, out var api) || !IsAllowedUnencrypted(api))
            throw new InvalidOperationException($"api_base_url must be https (or http to localhost for tests): {ApiBaseUrl}");
        if (!Uri.TryCreate(AgentSocketUrl, UriKind.Absolute, out var ws) || (ws.Scheme != "wss" && ws.Scheme != "ws"))
            throw new InvalidOperationException($"agent_socket_url must be wss/ws: {AgentSocketUrl}");
        if (ws.Scheme == "ws" && !IsLocalHost(ws))
            throw new InvalidOperationException("refusing an unencrypted websocket to a remote host");
        if (HeartbeatSeconds < 5) throw new InvalidOperationException("heartbeat_seconds must be at least 5");
        if (MaxConcurrentJobs < 1 || MaxConcurrentJobs > 4) throw new InvalidOperationException("max_concurrent_jobs must be 1..4");
        return this;
    }

    /// <summary>
    /// Uri.IsHttps does not exist on this target and Uri.UriSchemeHttps is
    /// deprecated, so compare the scheme directly — Uri lower-cases it.
    /// </summary>
    public static bool IsHttps(Uri uri) => uri.Scheme.Equals("https", StringComparison.OrdinalIgnoreCase);

    /// <summary>
    /// The rule the whole agent uses for "is this address allowed to be
    /// unencrypted". One place, because the config check and the document fetch
    /// check must not be free to disagree — a document endpoint that is stricter
    /// than the API endpoint makes a local bench impossible, and one that is
    /// looser is how customer pages end up travelling in clear text.
    /// </summary>
    public static bool IsAllowedUnencrypted(Uri uri) => IsHttps(uri) || IsLocalHost(uri);

    /// <summary>
    /// Uri.IsLoopback is no use here: it only answers true for http/https/ftp
    /// and only on the default port, which rules out a perfectly ordinary
    /// http://localhost:8787 test server. This is the check we actually want.
    /// </summary>
    public static bool IsLocalHost(Uri uri)
    {
        var host = uri.Host;
        if (host.Length == 0)
            return true;

        return host.Equals("localhost", StringComparison.OrdinalIgnoreCase) ||
               host.Equals("loopback", StringComparison.OrdinalIgnoreCase) ||
               host.Equals("[::1]", StringComparison.OrdinalIgnoreCase) ||
               host.StartsWith("127.", StringComparison.Ordinal);
    }

    public void Save()
    {
        AgentPaths.EnsureDirectories();
        File.WriteAllText(AgentPaths.ConfigFile, JsonSerializer.Serialize(this, Json));
    }

    public string SumatraExe()
    {
        if (!string.IsNullOrWhiteSpace(SumatraPdfPath)) return SumatraPdfPath;
        return Path.Combine(AgentPaths.AppDirectory, "SumatraPDF.exe");
    }
}

using System.Text.Json;
using System.Text.Json.Serialization;
using QrPrinter.Agent.Hardware;

namespace QrPrinter.Agent.Net;

/// <summary>
/// The JSON contract between the agent and the server.
///
/// Snake_case because that is what config.json already uses and what the
/// landing page's sample data already shows. Every type here is a wire shape,
/// not a domain model: nothing on this list is ever persisted by the agent.
///
/// <see cref="Wire.AuthToken"/> is the one value in this file that must never
/// reach a log, a crash dump or a support screenshot.
/// </summary>
internal static class Wire
{
    public static readonly JsonSerializerOptions Json = new()
    {
        WriteIndented = false,
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static string Serialize<T>(T value) => JsonSerializer.Serialize(value, Json);

    /// <summary>
    /// Null on anything unparseable rather than throwing. A server that starts
    /// speaking a slightly different dialect must degrade into "ignored this
    /// message", not into an agent that crashes on a Tuesday afternoon.
    /// </summary>
    public static T? TryDeserialize<T>(string json) where T : class
    {
        try
        {
            return JsonSerializer.Deserialize<T>(json, Json);
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public static T? TryDeserialize<T>(ReadOnlySpan<byte> utf8) where T : class
    {
        try
        {
            return JsonSerializer.Deserialize<T>(utf8, Json);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}

/// <summary>Body of `POST /agent/pair` — the only call made without a device token.</summary>
internal sealed record PairRequest(
    [property: JsonPropertyName("pairing_code")] string PairingCode,
    [property: JsonPropertyName("machine_key")] string MachineKey,
    [property: JsonPropertyName("hostname")] string Hostname,
    [property: JsonPropertyName("agent_version")] string AgentVersion);

/// <summary>What the server hands back once a pairing code has been burned.</summary>
internal sealed record PairResponse(
    [property: JsonPropertyName("device_id")] string? DeviceId,
    [property: JsonPropertyName("token")] string? Token,
    [property: JsonPropertyName("shop_name")] string? ShopName,
    [property: JsonPropertyName("label")] string? Label);

/// <summary>
/// Body of `POST /agent/heartbeat`, and the same shape the agent sends as the
/// `hello` frame on the websocket so one serialisation covers both channels.
/// </summary>
internal sealed record HeartbeatRequest(
    [property: JsonPropertyName("device_id")] string DeviceId,
    [property: JsonPropertyName("machine_key")] string MachineKey,
    [property: JsonPropertyName("agent_version")] string AgentVersion,
    [property: JsonPropertyName("hostname")] string Hostname,
    [property: JsonPropertyName("os")] string Os,
    [property: JsonPropertyName("spooler_running")] bool SpoolerRunning,
    [property: JsonPropertyName("printers")] IReadOnlyList<PrinterWire> Printers,
    [property: JsonPropertyName("includes_status")] bool IncludesStatus,
    [property: JsonPropertyName("sent_at")] DateTimeOffset SentAt,
    [property: JsonPropertyName("queue_depth")] int QueueDepth);

/// <summary>
/// The server's answer to a heartbeat. <see cref="PollIntervalSeconds"/> lets
/// the dashboard retune a device without an update being shipped to it.
/// </summary>
internal sealed record HeartbeatResponse(
    [property: JsonPropertyName("ok")] bool Ok = true,
    [property: JsonPropertyName("poll_interval_seconds")] int? PollIntervalSeconds = null,
    [property: JsonPropertyName("server_time")] DateTimeOffset? ServerTime = null);

/// <summary>
/// One job the server wants printed. Everything needed to print is here, so a
/// job offer never has to be re-fetched; the document itself still comes over
/// HTTPS from the configured origin only.
/// </summary>
internal sealed record JobOffer(
    [property: JsonPropertyName("job_id")] string? JobId,
    [property: JsonPropertyName("document_url")] string? DocumentUrl,
    [property: JsonPropertyName("printer")] string? Printer,
    [property: JsonPropertyName("copies")] int? Copies = 1,
    [property: JsonPropertyName("duplex")] bool? Duplex = false,
    [property: JsonPropertyName("colour")] bool? Colour = false,
    [property: JsonPropertyName("paper")] string? Paper = "A4",
    [property: JsonPropertyName("page_range")] string? PageRange = null,
    /// <summary>
    /// Expected SHA-256 of the document. Optional because a shop that uploads a
    /// file from a browser cannot always be trusted to have computed one; when
    /// present it is mandatory to honour, because it is the only proof the
    /// bytes that print are the bytes the customer uploaded.
    /// </summary>
    [property: JsonPropertyName("sha256")] string? Sha256 = null)
{
    /// <summary>
    /// True when this carries enough to attempt a print. Anything else is
    /// refused before a byte is downloaded.
    /// </summary>
    public bool IsUsable =>
        !string.IsNullOrWhiteSpace(JobId) &&
        !string.IsNullOrWhiteSpace(DocumentUrl) &&
        !string.IsNullOrWhiteSpace(Printer);
}

/// <summary>The list a `GET /agent/jobs/pending` returns.</summary>
internal sealed record PendingJobsResponse(
    [property: JsonPropertyName("jobs")] IReadOnlyList<JobOffer> Jobs);

/// <summary>
/// The agent's verdict on one job. <see cref="Status"/> is the lowercase form of
/// <see cref="Printing.PrintResultStatus"/> so the dashboard and the CLI show
/// the same word for the same event. <see cref="CopiesPrinted"/> is what the
/// spooler confirmed, which on a job that stopped part way is fewer than asked.
/// </summary>
internal sealed record JobResult(
    [property: JsonPropertyName("job_id")] string JobId,
    [property: JsonPropertyName("device_id")] string DeviceId,
    [property: JsonPropertyName("status")] string Status,
    [property: JsonPropertyName("stage")] string Stage,
    [property: JsonPropertyName("detail")] string Detail,
    [property: JsonPropertyName("finished_at")] DateTimeOffset FinishedAt,
    [property: JsonPropertyName("copies_printed")] int? CopiesPrinted = null);

/// <summary>Ack the server returns for a result, used to drop it from the retry queue.</summary>
internal sealed record ResultAck(
    [property: JsonPropertyName("ok")] bool Ok = true,
    [property: JsonPropertyName("job_id")] string? JobId = null);

/// <summary>
/// Frames on the websocket. <c>type</c> is the discriminator; every frame is
/// one JSON object, no length prefix, no batching.
/// </summary>
internal sealed record ChannelFrame(
    [property: JsonPropertyName("type")] string Type,
    [property: JsonPropertyName("device_id")] string? DeviceId = null,
    [property: JsonPropertyName("reason")] string? Reason = null,
    [property: JsonPropertyName("job")] JobOffer? Job = null);

internal static class FrameTypes
{
    public const string Hello = "hello";
    public const string Welcome = "welcome";
    public const string Ping = "ping";
    public const string Pong = "pong";
    public const string JobNew = "job_new";
    public const string JobTaken = "job_taken";
    public const string Result = "result";
    public const string Refused = "refused";
    public const string Heartbeat = "heartbeat";
}

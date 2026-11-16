using System.Text.Json.Serialization;

namespace QrPrinter.Agent.Hardware;

/// <summary>
/// The printer list exactly as the heartbeat sends it, so `printers --json` is a
/// real preview of the wire format and not a separate invention.
/// </summary>
public sealed record PrinterInventory(
    [property: JsonPropertyName("machine_name")] string MachineName,
    [property: JsonPropertyName("includes_status")] bool IncludesStatus,
    [property: JsonPropertyName("printers")] IReadOnlyList<PrinterWire> Printers);

/// <summary>
/// One printer on the wire. <see cref="Endpoint"/> is what the agent needs back
/// to reopen the queue, which for a shared printer is not the same string as
/// <see cref="Name"/>.
/// </summary>
public sealed record PrinterWire(
    [property: JsonPropertyName("name")] string Name,
    [property: JsonPropertyName("endpoint")] string Endpoint,
    [property: JsonPropertyName("port")] string? Port,
    [property: JsonPropertyName("driver")] string? Driver,
    [property: JsonPropertyName("location")] string? Location,
    [property: JsonPropertyName("kind")] string Kind,
    [property: JsonPropertyName("state")] string State,
    [property: JsonPropertyName("queue_length")] int QueueLength,
    [property: JsonPropertyName("is_default")] bool IsDefault,
    [property: JsonPropertyName("is_shared")] bool IsShared,
    [property: JsonPropertyName("status_reason")] string StatusReason,
    [property: JsonPropertyName("raw_status")] uint RawStatus,
    [property: JsonPropertyName("raw_attributes")] uint RawAttributes)
{
    public static PrinterWire From(PrinterReport report) => new(
        report.Name,
        report.Endpoint,
        report.Port,
        report.Driver,
        // A shop with three printers on one counter is distinguished by nothing
        // else, so the location the owner typed in Windows has to reach the dashboard.
        report.Location,
        report.Kind.ToString().ToLowerInvariant(),
        report.State.ToString().ToLowerInvariant(),
        report.QueueLength,
        report.IsDefault,
        report.Shared,
        report.StateReason,
        report.RawStatus,
        report.RawAttributes);
}

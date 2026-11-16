using System.Net.WebSockets;
using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace QrPrinter.MockServer;

/// <summary>
/// A test double for the cloud side of the agent.
///
/// It exists so the print path can be exercised end to end on one machine:
/// pair, heartbeat, receive a job, print it, report the result. It is NOT the
/// product server — no accounts, no billing, no persistence. Anything written
/// here disappears when the process stops, which is the point: a developer
/// should not be able to mistake this for something that keeps customer jobs.
///
/// The wire format is deliberately a copy of
/// agent/src/QrPrinter.Agent/Net/Wire.cs. When one side changes, the other has
/// to change with it, and that agreement is what the bench test proves.
/// </summary>
public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        var port = Flag(args, "--port") ?? Environment.GetEnvironmentVariable("QPRINTER_MOCK_PORT") ?? "8000";
        var pairingCode = (Flag(args, "--code") ?? "BENCH1").ToUpperInvariant();
        var documents = Path.GetFullPath(Flag(args, "--documents") ?? Path.Combine(AppContext.BaseDirectory, "documents"));
        Directory.CreateDirectory(documents);

        var state = new ServerState(pairingCode);

        var builder = WebApplication.CreateBuilder(args);
        builder.WebHost.UseUrls($"http://127.0.0.1:{port}");
        // The default console logger would echo request bodies into a terminal
        // someone might screenshot; the mock prints what it needs itself.
        builder.Logging.ClearProviders();

        // ASP.NET's own JSON settings are camelCase, so a body binding typed
        // `pairing_code` would silently arrive as null and the pairing would
        // fail in a way that looks like the agent's fault. One dialect, set here.
        builder.Services.Configure<Microsoft.AspNetCore.Http.Json.JsonOptions>(options =>
        {
            options.SerializerOptions.PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower;
            options.SerializerOptions.DictionaryKeyPolicy = JsonNamingPolicy.SnakeCaseLower;
            options.SerializerOptions.PropertyNameCaseInsensitive = true;
            options.SerializerOptions.DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull;
        });

        var app = builder.Build();
        app.UseWebSockets();
        Routes.Map(app, state, documents);

        Console.WriteLine("QrPrinter mock server — a bench stand-in for the cloud, not the product");
        Console.WriteLine($"  listening    http://127.0.0.1:{port}  (loopback only)");
        Console.WriteLine($"  pairing code {pairingCode}");
        Console.WriteLine($"  documents    {documents}");
        Console.WriteLine();
        Console.WriteLine("  pair the agent with:");
        Console.WriteLine($"    QrPrinterAgent pair {pairingCode} " +
                          $"--api http://127.0.0.1:{port} --socket ws://127.0.0.1:{port}/agent/channel");
        Console.WriteLine();
        Console.WriteLine("  then hand it a job with:");
        Console.WriteLine($"    curl -X POST http://127.0.0.1:{port}/test/job -H \"content-type: application/json\" " +
                          $"-d \"{{\\\"printer\\\":\\\"Bench 9100\\\",\\\"file\\\":\\\"sample.pdf\\\"}}\"");
        Console.WriteLine();
        Console.WriteLine("Ctrl+C to stop.");

        await app.RunAsync().ConfigureAwait(false);
        return 0;
    }

    private static string? Flag(string[] args, string name)
    {
        var index = Array.IndexOf(args, name);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }
}

/// <summary>
/// Everything the mock remembers. In-memory on purpose, and every collection is
/// concurrent because ASP.NET runs handlers on pool threads.
/// </summary>
public sealed class ServerState
{
    public ServerState(string pairingCode) => UnusedCodes.Enqueue(pairingCode);

    public const string JsonContentType = "application/json";

    /// <summary>Codes still waiting to be burned.</summary>
    public ConcurrentQueue<string> UnusedCodes { get; } = new();

    /// <summary>device id → the token that authenticates it.</summary>
    public ConcurrentDictionary<string, Device> Devices { get; } = new();

    /// <summary>token → device id, the lookup the auth filter actually needs.</summary>
    public ConcurrentDictionary<string, string> Tokens { get; } = new();

    /// <summary>Jobs handed out and not yet reported.</summary>
    public ConcurrentDictionary<string, JobRecord> Jobs { get; } = new();

    /// <summary>device id → its live socket, if it has one.</summary>
    public ConcurrentDictionary<string, WebSocket> Channels { get; } = new();

    /// <summary>Every result the agent has reported, newest last, for the CLI to read.</summary>
    public List<JobResult> Results { get; } = [];

    public readonly object ResultsGate = new();

    public sealed record Device(string DeviceId, string Token, string Hostname, string MachineKey);

    public sealed class JobRecord
    {
        public required string JobId { get; init; }
        public required string DeviceId { get; init; }
        public required string Printer { get; init; }
        public required string File { get; init; }
        public int Copies { get; init; } = 1;
        public bool Duplex { get; init; }
        public bool Colour { get; init; }
        public string Paper { get; init; } = "A4";
        public string? Sha256 { get; init; }
        public DateTimeOffset CreatedAt { get; init; } = DateTimeOffset.UtcNow;
        public bool Delivered { get; set; }
    }

    public sealed record JobResult(
        string JobId,
        string DeviceId,
        string Status,
        string Stage,
        string Detail,
        DateTimeOffset FinishedAt,
        int? CopiesPrinted);
}

/// <summary>
/// The HTTP and websocket surface. Snake_case JSON throughout, matching the
/// agent's own naming policy.
/// </summary>
public static class Routes
{
    private static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.SnakeCaseLower,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static void Map(WebApplication app, ServerState state, string documentsDirectory)
    {
        var log = new Action<string>(message =>
            Console.WriteLine($"{DateTime.Now:HH:mm:ss} {message}"));

        app.MapGet("/", () => Results.Json(new
        {
            name = "QrPrinter mock server",
            role = "bench stand-in, not the product",
            devices = state.Devices.Count,
            open_jobs = state.Jobs.Count(job => !job.Value.Delivered),
            results = state.Results.Count,
        }, Json));

        // ── pairing ────────────────────────────────────────────────────────
        app.MapGet("/api/agent/health", () => Results.Json(
            new { ok = true, name = "QrPrinter mock server", devices = state.Devices.Count }, Json));

        app.MapPost("/agent/pair", (PairRequest request) =>
        {
            // A wrong code is refused without burning the real one: on a bench the
            // code is retyped by hand, and losing it to a typo means restarting the
            // server. The product server does the opposite, and that is deliberate.
            var code = state.UnusedCodes.FirstOrDefault(found =>
                string.Equals(found, request.PairingCode, StringComparison.OrdinalIgnoreCase));
            if (code == null)
            {
                log($"pair REJECTED  unknown or already-used code '{request.PairingCode}'");
                return Unauthorized("that pairing code is not valid here");
            }

            state.UnusedCodes.Clear();

            var deviceId = $"dev-{Guid.NewGuid().ToString("N")[..12]}";
            var token = Convert.ToHexStringLower(System.Security.Cryptography.RandomNumberGenerator.GetBytes(32));

            state.Devices[deviceId] = new ServerState.Device(deviceId, token, request.Hostname, request.MachineKey);
            state.Tokens[token] = deviceId;

            log($"pair OK        {deviceId} from {request.Hostname} (agent {request.AgentVersion})");
            return Results.Json(new
            {
                device_id = deviceId,
                token,
                shop_name = "Bench Shop",
                label = "Bench",
            }, Json);
        });

        // ── heartbeat ──────────────────────────────────────────────────────
        app.MapPost("/agent/heartbeat", (HeartbeatRequest heartbeat, HttpContext context) =>
        {
            if (!Authorised(context, state, out var deviceId))
                return Unauthorised();

            var printers = heartbeat.Printers?.Count ?? 0;
            var names = string.Join(", ", (heartbeat.Printers ?? []).Select(printer => printer.Name));
            log($"heartbeat      {deviceId} · {printers} printer(s) [{names}] · spooler {(heartbeat.SpoolerRunning ? "up" : "DOWN")}");

            return Results.Json(new
            {
                ok = true,
                poll_interval_seconds = 5,
                server_time = DateTimeOffset.UtcNow,
            }, Json);
        });

        // ── job poll ───────────────────────────────────────────────────────
        app.MapGet("/agent/jobs/pending", (HttpContext context) =>
        {
            if (!Authorised(context, state, out var deviceId))
                return Unauthorised();

            var pending = state.Jobs.Values
                .Where(job => job.DeviceId == deviceId && !job.Delivered)
                .Select(ToOffer(documentsDirectory, context))
                .ToList();

            foreach (var job in state.Jobs.Values.Where(job => job.DeviceId == deviceId && !job.Delivered))
                job.Delivered = true;

            if (pending.Count > 0)
                log($"poll           {deviceId} · handed {pending.Count} job(s)");

            return Results.Json(new { jobs = pending }, Json);
        });

        // ── result ─────────────────────────────────────────────────────────
        app.MapPost("/agent/jobs/{jobId}/result", async (string jobId, HttpContext context) =>
        {
            if (!Authorised(context, state, out var deviceId))
                return Unauthorised();

            var result = await JsonSerializer.DeserializeAsync<JobResultBody>(context.Request.Body, Json)
                .ConfigureAwait(false);
            if (result == null)
                return BadRequest("the result body was not JSON this server could read");

            lock (state.ResultsGate)
                state.Results.Add(new ServerState.JobResult(
                    jobId, deviceId, result.Status, result.Stage, result.Detail, result.FinishedAt, result.CopiesPrinted));

            state.Jobs.TryRemove(jobId, out _);
            log($"result         {jobId} · {result.Status.ToUpperInvariant()} at {result.Stage} · " +
                $"{result.CopiesPrinted?.ToString() ?? "?"} copies confirmed — {Shorten(result.Detail)}");

            return Results.Json(new { ok = true, job_id = jobId }, Json);
        });

        // ── the document itself ────────────────────────────────────────────
        app.MapGet("/documents/{fileName}", (string fileName) =>
        {
            // A job names a file that came from the network, so it is resolved
            // inside the documents folder only, and a name that escapes it is
            // refused rather than normalised.
            var candidate = Path.GetFullPath(Path.Combine(documentsDirectory, fileName));
            if (!candidate.StartsWith(PathEndsWithSeparator(documentsDirectory), StringComparison.OrdinalIgnoreCase)
                || !File.Exists(candidate))
                return Results.NotFound();

            return Results.File(candidate, "application/pdf", fileName);
        });

        // ── the websocket job channel ──────────────────────────────────────
        app.Map("/agent/channel", async (HttpContext context) =>
        {
            if (!Authorised(context, state, out var deviceId))
            {
                context.Response.StatusCode = StatusCodes.Status401Unauthorized;
                return;
            }

            if (!context.WebSockets.IsWebSocketRequest)
            {
                context.Response.StatusCode = StatusCodes.Status400BadRequest;
                await context.Response.WriteAsync("this endpoint is a websocket").ConfigureAwait(false);
                return;
            }

            using var socket = await context.WebSockets.AcceptWebSocketAsync().ConfigureAwait(false);
            state.Channels[deviceId] = socket;
            log($"channel        {deviceId} connected");

            await SendAsync(socket, new { type = "welcome", device_id = deviceId }, Json).ConfigureAwait(false);

            var buffer = new byte[64 * 1024];
            try
            {
                while (socket.State == WebSocketState.Open)
                {
                    var received = await ReceiveAsync(socket, buffer).ConfigureAwait(false);
                    if (received == null)
                        break;

                    using var document = JsonDocument.Parse(received);
                    var type = document.RootElement.TryGetProperty("type", out var found) ? found.GetString() : null;

                    if (type == "ping")
                        await SendAsync(socket, new { type = "pong", device_id = deviceId }, Json).ConfigureAwait(false);
                    else if (type == "hello")
                        log($"channel        {deviceId} says hello (agent {Version(document)})");
                }
            }
            catch (WebSocketException error)
            {
                log($"channel        {deviceId} dropped: {error.Message}");
            }
            finally
            {
                state.Channels.TryRemove(deviceId, out _);
            }
        });

        // ── test hooks, not part of the real API ───────────────────────────
        app.MapPost("/test/job", async (TestJob request, HttpContext context) =>
        {
            var device = state.Devices.Values.FirstOrDefault();
            if (device == null)
                return BadRequest("no agent is paired yet — run `QrPrinterAgent pair` first");

            var file = request.File ?? "sample.pdf";
            if (!File.Exists(Path.Combine(documentsDirectory, file)))
                return BadRequest($"no document named '{file}' in {documentsDirectory}");

            var jobId = request.JobId ?? $"MOCK-{DateTime.Now:yyyyMMddHHmmss}";
            var record = new ServerState.JobRecord
            {
                JobId = jobId,
                DeviceId = device.DeviceId,
                Printer = request.Printer ?? "Bench 9100",
                File = file,
                Copies = request.Copies ?? 1,
                Duplex = request.Duplex ?? false,
                Colour = request.Colour ?? false,
                Paper = request.Paper ?? "A4",
            };

            // Pushed now if the socket is live; still left pending so a poll
            // picks it up if the push races a reconnect.
            state.Jobs[jobId] = record;
            log($"enqueue        {jobId} → {record.Printer} ({file})");

            if (state.Channels.TryGetValue(device.DeviceId, out var channel) &&
                channel.State == WebSocketState.Open)
            {
                try
                {
                    await SendAsync(
                        channel,
                        new { type = "job_new", job = ToOffer(documentsDirectory, context)(record) },
                        Json).ConfigureAwait(false);
                    record.Delivered = true;
                    log($"push           {jobId} sent over the channel");
                }
                catch (WebSocketException)
                {
                    // The socket died between the state check and the write. The
                    // job stays undelivered so the agent's next poll finds it.
                    log($"push           {jobId} could not be pushed; left pending for poll");
                }
            }

            return Results.Json(new { ok = true, job_id = jobId, pushed = record.Delivered }, Json);
        });

        app.MapGet("/test/results", () =>
        {
            lock (state.ResultsGate)
                return Results.Json(state.Results, Json);
        });

        app.MapPost("/test/pairing-code", () =>
        {
            var code = Guid.NewGuid().ToString("N")[..6].ToUpperInvariant();
            state.UnusedCodes.Enqueue(code);
            return Results.Json(new { pairing_code = code }, Json);
        });

        app.MapGet("/test/devices", () => Results.Json(
            state.Devices.Values.Select(device => new { device.DeviceId, device.Hostname, device.MachineKey }),
            Json));
    }

    private static Func<ServerState.JobRecord, object> ToOffer(string documentsDirectory, HttpContext context) =>
        record => new
        {
            job_id = record.JobId,
            // Absolute, and built from the host the caller actually used: the
            // agent refuses a relative address and refuses a document host that
            // is not the one it was configured with.
            document_url = $"{context.Request.Scheme}://{context.Request.Host}/documents/{Uri.EscapeDataString(record.File)}",
            printer = record.Printer,
            copies = record.Copies,
            duplex = record.Duplex,
            colour = record.Colour,
            paper = record.Paper,
            sha256 = record.Sha256 ?? Sha256Of(Path.Combine(documentsDirectory, record.File)),
        };

    /// <summary>
    /// The hash the agent is asked to verify. Computing it here rather than
    /// trusting a caller means the bench always exercises the checksum path.
    /// </summary>
    private static string? Sha256Of(string path)
    {
        try
        {
            using var sha = System.Security.Cryptography.SHA256.Create();
            return Convert.ToHexStringLower(sha.ComputeHash(File.ReadAllBytes(path)));
        }
        catch (IOException)
        {
            return null;
        }
    }

    private static bool Authorised(HttpContext context, ServerState state, out string deviceId)
    {
        deviceId = "";
        var header = context.Request.Headers.Authorization.ToString();
        if (!header.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
            return false;

        var token = header["Bearer ".Length..].Trim();
        if (!state.Tokens.TryGetValue(token, out var found))
            return false;

        deviceId = found;
        return true;
    }

    private static IResult Unauthorised() => Unauthorized("this device is not paired here");

    private static IResult Unauthorized(string reason) => Results.Json(
        new { ok = false, error = reason }, Json, statusCode: StatusCodes.Status401Unauthorized);

    private static IResult BadRequest(string reason) => Results.Json(
        new { ok = false, error = reason }, Json, statusCode: StatusCodes.Status400BadRequest);

    private static async Task SendAsync(WebSocket socket, object frame, JsonSerializerOptions options)
    {
        var bytes = JsonSerializer.SerializeToUtf8Bytes(frame, options);
        await socket.SendAsync(bytes, WebSocketMessageType.Text, endOfMessage: true, CancellationToken.None)
            .ConfigureAwait(false);
    }

    private static async Task<string?> ReceiveAsync(WebSocket socket, byte[] buffer)
    {
        var pending = new StringBuilder();
        while (true)
        {
            var result = await socket.ReceiveAsync(buffer, CancellationToken.None).ConfigureAwait(false);
            if (result.MessageType == WebSocketMessageType.Close)
                return null;

            pending.Append(System.Text.Encoding.UTF8.GetString(buffer, 0, result.Count));
            if (result.EndOfMessage)
                return pending.ToString();
        }
    }

    private static string? Version(JsonDocument document) =>
        document.RootElement.TryGetProperty("reason", out var found) ? found.GetString() : null;

    private static string PathEndsWithSeparator(string path) =>
        path.EndsWith(Path.DirectorySeparatorChar) ? path : path + Path.DirectorySeparatorChar;

    private static string Shorten(string? text) =>
        text is { Length: <= 120 } ? text ?? "" : text![..117] + "…";

    // Wire shapes, mirrored from the agent.
    public sealed record PairRequest(
        string PairingCode, string MachineKey, string Hostname, string AgentVersion);

    public sealed record HeartbeatRequest(
        string DeviceId,
        string MachineKey,
        string AgentVersion,
        string Hostname,
        string Os,
        bool SpoolerRunning,
        List<PrinterWire>? Printers,
        bool IncludesStatus,
        DateTimeOffset SentAt,
        int QueueDepth);

    /// <summary>Mirrors agent Hardware/PrinterInventory.cs PrinterWire.</summary>
    public sealed record PrinterWire(
        string Name, string Endpoint, string? Port, string? Driver, string? Location,
        string Kind, string State, int QueueLength, bool IsDefault, bool IsShared,
        string StatusReason, uint RawStatus, uint RawAttributes);

    public sealed record JobResultBody(
        string JobId, string DeviceId, string Status, string Stage, string Detail, DateTimeOffset FinishedAt,
        int? CopiesPrinted);

    public sealed record TestJob(
        string? Printer, string? File, string? JobId, int? Copies, bool? Duplex, bool? Colour, string? Paper);
}

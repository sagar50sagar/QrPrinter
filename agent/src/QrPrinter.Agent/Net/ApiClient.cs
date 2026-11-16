using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using QrPrinter.Agent.Config;
using QrPrinter.Agent.Hardware;
using QrPrinter.Agent.Logging;

namespace QrPrinter.Agent.Net;

/// <summary>
/// The REST half of the cloud channel: pairing, heartbeat, job poll, result.
///
/// Everything here is outbound. The agent never listens on a port, which is
/// what lets it sit behind a shop router with no port forwarding and no VPN.
///
/// A device token is only ever put in an Authorization header — never a query
/// string, because query strings end up in access logs and proxy logs, and that
/// token grants printing on the shop's printers.
/// </summary>
internal sealed class ApiClient : IDisposable
{
    private readonly HttpClient _http;
    private readonly AgentConfig _config;
    private readonly DeviceIdentity _identity;

    /// <summary>
    /// One minute is longer than any sane server takes to answer a poll, and
    /// shorter than the point at which a stuck request stops the job loop.
    /// </summary>
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromMinutes(1);

    public ApiClient(AgentConfig config, DeviceIdentity identity)
        : this(config, identity, httpClient: null)
    {
    }

    /// <summary>
    /// <paramref name="httpClient"/> exists for the test harness only. Nothing
    /// the agent itself does passes one.
    /// </summary>
    public ApiClient(AgentConfig config, DeviceIdentity identity, HttpClient? httpClient)
    {
        _config = config;
        _identity = identity;
        _http = httpClient ?? NewClient(config);
    }

    private static HttpClient NewClient(AgentConfig config) =>
        new(new HttpClientHandler { AllowAutoRedirect = false })
        {
            BaseAddress = new Uri(config.ApiBaseUrl.TrimEnd('/') + "/"),
            Timeout = RequestTimeout,
        };

    /// <summary>
    /// Burns a pairing code for this machine. Sends no Authorization header
    /// because there is no identity yet, and is the only call that may be made
    /// before <see cref="DeviceIdentity"/> exists.
    /// </summary>
    public async Task<ApiOutcome<PairResponse>> PairAsync(
        string pairingCode,
        string machineKey,
        string agentVersion,
        CancellationToken cancel)
    {
        var body = new PairRequest(
            pairingCode.Trim().ToUpperInvariant(),
            machineKey,
            Environment.MachineName,
            agentVersion);

        return await Send<PairResponse>(
            HttpMethod.Post, "agent/pair", body, authenticated: false, cancel).ConfigureAwait(false);
    }

    /// <summary>
    /// Reports who is installed here and which printers exist right now. The
    /// server uses this both as liveness and as the source of truth for the
    /// printer list, so it must be a fresh scan rather than a cached one.
    /// </summary>
    public async Task<ApiOutcome<HeartbeatResponse>> HeartbeatAsync(
        HeartbeatRequest heartbeat,
        CancellationToken cancel)
    {
        return await Send<HeartbeatResponse>(
            HttpMethod.Post, "agent/heartbeat", heartbeat, authenticated: true, cancel).ConfigureAwait(false);
    }

    /// <summary>
    /// Asks for work. This is the fallback path: the websocket is how jobs
    /// normally arrive, but a poll means a shop whose router kills long-lived
    /// connections still prints, just a few seconds later.
    /// </summary>
    public async Task<ApiOutcome<IReadOnlyList<JobOffer>>> PollJobsAsync(CancellationToken cancel)
    {
        var outcome = await Send<PendingJobsResponse>(
            HttpMethod.Get, "agent/jobs/pending", body: null, authenticated: true, cancel).ConfigureAwait(false);

        return outcome.WithValue(outcome.Value?.Jobs ?? []);
    }

    /// <summary>
    /// Tells the server what happened to one job. Failures are logged but not
    /// retried forever by the caller, because a job whose result never lands is
    /// answered by the dashboard's own timeout rather than by an agent stuck in
    /// a send loop.
    /// </summary>
    public async Task<ApiOutcome<ResultAck>> ReportAsync(JobResult result, CancellationToken cancel)
    {
        return await Send<ResultAck>(
            HttpMethod.Post, $"agent/jobs/{Uri.EscapeDataString(result.JobId)}/result",
            result, authenticated: true, cancel).ConfigureAwait(false);
    }

    private async Task<ApiOutcome<T>> Send<T>(
        HttpMethod method,
        string path,
        object? body,
        bool authenticated,
        CancellationToken cancel) where T : class
    {
        using var request = new HttpRequestMessage(method, path);
        if (authenticated)
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", _identity.Token);

        // The server must not guess which agent build is talking to it; this is
        // how a fleet is inventoried when a bad behaviour appears in one version.
        request.Headers.UserAgent.ParseAdd($"QrPrinterAgent/{AgentVersion.Value}");

        if (body != null)
            request.Content = new StringContent(Wire.Serialize(body), Encoding.UTF8, "application/json");

        HttpResponseMessage? response = null;
        try
        {
            response = await _http.SendAsync(request, cancel).ConfigureAwait(false);
        }
        catch (OperationCanceledException) when (cancel.IsCancellationRequested)
        {
            return ApiOutcome<T>.Cancelled();
        }
        catch (Exception error)
        {
            // A refused connection is ordinary for an agent installed before the
            // shop has network, so it is a warning with the reason, not a stack.
            FileLog.Warn($"{method.Method} {path} failed: {error.GetType().Name} {error.Message}");
            return ApiOutcome<T>.TransportFailed(error);
        }

        using (response)
        {
            if (response.StatusCode == HttpStatusCode.NotFound)
                return ApiOutcome<T>.Rejected(404, "the server has no such endpoint for this agent");

            if (response.StatusCode is HttpStatusCode.Unauthorized or HttpStatusCode.Forbidden)
            {
                // Almost always a revoked or re-paired device. Retrying a 401
                // forever is how an agent hammers a server that already said no.
                return ApiOutcome<T>.Rejected(
                    (int)response.StatusCode,
                    "the server does not accept this device token — pair again from the dashboard");
            }

            if (!response.IsSuccessStatusCode)
                return ApiOutcome<T>.Rejected(
                    (int)response.StatusCode,
                    $"the server answered {(int)response.StatusCode}");

            var stream = await response.Content.ReadAsStreamAsync(cancel).ConfigureAwait(false);
            T? value;
            try
            {
                value = await JsonSerializer.DeserializeAsync<T>(stream, Wire.Json, cancel).ConfigureAwait(false);
            }
            catch (JsonException error)
            {
                return ApiOutcome<T>.Rejected(0, $"the server sent JSON this build cannot read: {error.Message}");
            }

            return value == null
                ? ApiOutcome<T>.Rejected(0, "the server sent an empty body where an object was expected")
                : ApiOutcome<T>.Succeeded(value);
        }
    }

    public void Dispose() => _http.Dispose();
}

/// <summary>
/// The three answers a call can have, kept apart because the agent must react
/// differently to each: transport trouble means retry, 401 means stop and
/// re-pair, and success means carry on.
/// </summary>
internal sealed record ApiOutcome<T>
{
    public bool IsSuccess { get; init; }
    public T? Value { get; init; }
    public int StatusCode { get; init; }
    public string? Error { get; init; }
    public bool WasCancelled { get; init; }

    /// <summary>
    /// True when no answer came back at all — DNS, refused connection, timeout.
    /// Named apart from the factory method below because a property and a method
    /// cannot share a name here.
    /// </summary>
    public bool ConnectionFailed { get; init; }

    /// <summary>True when the server refused on purpose — retrying will not help.</summary>
    public bool IsTerminal => StatusCode is 401 or 403 or 404;

    public static ApiOutcome<T> Succeeded(T value) => new() { IsSuccess = true, Value = value };
    public static ApiOutcome<T> Rejected(int status, string error) => new() { StatusCode = status, Error = error };
    public static ApiOutcome<T> Cancelled() => new() { WasCancelled = true, Error = "cancelled" };
    public static ApiOutcome<T> TransportFailed(Exception error) =>
        new() { ConnectionFailed = true, Error = error.Message };

    /// <summary>Keeps the outcome's reasons while swapping the payload type.</summary>
    public ApiOutcome<TNew> WithValue<TNew>(TNew value) => new()
    {
        IsSuccess = IsSuccess,
        Value = value,
        StatusCode = StatusCode,
        Error = Error,
        WasCancelled = WasCancelled,
        ConnectionFailed = ConnectionFailed,
    };
}

/// <summary>
/// The assembly version, read once. Sent in the User-Agent and every heartbeat
/// so a server-side bug report can be tied to a build.
/// </summary>
internal static class AgentVersion
{
    public static string Value { get; } =
        typeof(AgentVersion).Assembly.GetName().Version?.ToString(3) ?? "0.0.0";
}

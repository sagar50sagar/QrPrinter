using System.Net.WebSockets;
using System.Text;
using QrPrinter.Agent.Config;
using QrPrinter.Agent.Logging;

namespace QrPrinter.Agent.Net;

/// <summary>
/// The always-outbound websocket the server uses to push work.
///
/// Why a socket at all, when there is also a poll: a shop owner watching a
/// customer wait wants the job to move the second it is queued, not up to a
/// heartbeat later. Why a poll at all, when there is a socket: some shop routers
/// silently kill long-idle connections, and an agent that only listened would
/// stop printing without ever reporting that it had.
///
/// The token is sent in the Authorization header of the handshake, never in the
/// query string — handshake URLs land in access logs.
/// </summary>
internal sealed class AgentChannel : IAsyncDisposable
{
    private readonly AgentConfig _config;
    private readonly DeviceIdentity _identity;
    private readonly Func<JobOffer, Task> _onJob;

    /// <summary>
    /// A frame is small JSON. Sixty-four kilobytes is far more than a job offer
    /// needs and stops a confused server from inflating a buffer.
    /// </summary>
    private const int ReceiveBufferSize = 64 * 1024;

    private ClientWebSocket? _socket;
    private TimeSpan _backoff = TimeSpan.FromSeconds(1);

    public AgentChannel(AgentConfig config, DeviceIdentity identity, Func<JobOffer, Task> onJob)
    {
        _config = config;
        _identity = identity;
        _onJob = onJob;
    }

    public bool IsConnected => _socket?.State == WebSocketState.Open;

    /// <summary>
    /// Connect, then read until told to stop. Returns only on cancellation;
    /// every other failure is reported and retried with backoff, because a
    /// five-second dropout at a counter is not a reason to stop printing.
    /// </summary>
    public async Task RunAsync(CancellationToken cancel)
    {
        var buffer = new byte[ReceiveBufferSize];

        while (!cancel.IsCancellationRequested)
        {
            try
            {
                await ConnectAsync(cancel).ConfigureAwait(false);
                _backoff = TimeSpan.FromSeconds(1);

                await ReceiveLoopAsync(buffer, cancel).ConfigureAwait(false);
            }
            catch (OperationCanceledException) when (cancel.IsCancellationRequested)
            {
                break;
            }
            catch (WebSocketException error)
            {
                FileLog.Warn($"job channel dropped: {error.Message}");
            }
            catch (Exception error)
            {
                FileLog.Warn($"job channel trouble ({error.GetType().Name}): {error.Message}");
            }
            finally
            {
                await CloseSocketAsync().ConfigureAwait(false);
            }

            if (cancel.IsCancellationRequested)
                break;

            var wait = NextBackoff();
            FileLog.Info($"job channel offline, retrying in {(int)wait.TotalSeconds}s");
            try
            {
                await Task.Delay(wait, cancel).ConfigureAwait(false);
            }
            catch (OperationCanceledException)
            {
                break;
            }
        }
    }

    /// <summary>
    /// Exponential with a cap, plus jitter. The jitter is the point: a shop
    /// whose agents all reconnect after the same outage should not arrive at the
    /// server in one synchronized burst.
    /// </summary>
    private TimeSpan NextBackoff()
    {
        var capped = Math.Min(_backoff.TotalSeconds, _config.ReconnectMaxSeconds);
        _backoff = TimeSpan.FromSeconds(Math.Min(capped * 2, _config.ReconnectMaxSeconds));
        return TimeSpan.FromSeconds(capped + Random.Shared.Next(0, 3));
    }

    private async Task ConnectAsync(CancellationToken cancel)
    {
        _socket = new ClientWebSocket();
        _socket.Options.SetRequestHeader("Authorization", $"Bearer {_identity.Token}");
        _socket.Options.SetRequestHeader("User-Agent", $"QrPrinterAgent/{AgentVersion.Value}");
        // A printer agent on a shop LAN over a flaky router: keepalive so a dead
        // peer is noticed rather than waited on forever.
        _socket.Options.KeepAliveInterval = TimeSpan.FromSeconds(_config.HeartbeatSeconds);

        FileLog.Debug($"job channel dialling {_config.AgentSocketUrl}");
        await _socket.ConnectAsync(new Uri(_config.AgentSocketUrl), cancel).ConfigureAwait(false);

        await SendAsync(new ChannelFrame(FrameTypes.Hello, _identity.DeviceId, AgentVersion.Value), cancel)
            .ConfigureAwait(false);
    }

    private async Task ReceiveLoopAsync(byte[] buffer, CancellationToken cancel)
    {
        var pending = new StringBuilder();

        while (_socket is { State: WebSocketState.Open } && !cancel.IsCancellationRequested)
        {
            var result = await _socket.ReceiveAsync(buffer, cancel).ConfigureAwait(false);

            if (result.MessageType == WebSocketMessageType.Close)
            {
                FileLog.Info($"job channel closed by server: {_socket.CloseStatus} {_socket.CloseStatusDescription}");
                await _socket.CloseOutputAsync(
                    WebSocketCloseStatus.NormalClosure, "agent acknowledged", cancel).ConfigureAwait(false);
                return;
            }

            pending.Append(Encoding.UTF8.GetString(buffer, 0, result.Count));

            // A frame may be split across receives; only act on the whole thing.
            if (!result.EndOfMessage)
                continue;

            var text = pending.ToString();
            pending.Clear();

            if (text.Length > 0)
                await HandleFrameAsync(text, cancel).ConfigureAwait(false);
        }
    }

    private async Task HandleFrameAsync(string text, CancellationToken cancel)
    {
        var frame = Wire.TryDeserialize<ChannelFrame>(text);
        if (frame == null)
        {
            FileLog.Warn("job channel sent a frame this build cannot read; ignored");
            return;
        }

        switch (frame.Type)
        {
            case FrameTypes.Welcome:
                FileLog.Info("job channel authenticated");
                break;

            case FrameTypes.Ping:
                await SendAsync(new ChannelFrame(FrameTypes.Pong, _identity.DeviceId), cancel).ConfigureAwait(false);
                break;

            case FrameTypes.JobNew:
                if (frame.Job is { IsUsable: true } job)
                    await _onJob(job).ConfigureAwait(false);
                else
                    FileLog.Warn("job channel pushed a frame with no printable job in it; ignored");
                break;

            case FrameTypes.Refused:
                // The server naming its own reason beats the agent guessing one.
                FileLog.Warn($"server refused this device: {frame.Reason ?? "no reason given"}");
                break;

            default:
                FileLog.Debug($"ignoring unknown channel frame type '{frame.Type}'");
                break;
        }
    }

    public async Task SendAsync(ChannelFrame frame, CancellationToken cancel)
    {
        var socket = _socket;
        if (socket is not { State: WebSocketState.Open })
        {
            FileLog.Debug($"channel not open, dropping outgoing '{frame.Type}'");
            return;
        }

        var bytes = Encoding.UTF8.GetBytes(Wire.Serialize(frame));
        try
        {
            await socket.SendAsync(bytes, WebSocketMessageType.Text, endOfMessage: true, cancel)
                .ConfigureAwait(false);
        }
        catch (Exception error)
        {
            FileLog.Warn($"could not send '{frame.Type}': {error.Message}");
        }
    }

    private async Task CloseSocketAsync()
    {
        var socket = _socket;
        _socket = null;
        if (socket == null)
            return;

        try
        {
            if (socket.State is WebSocketState.Open or WebSocketState.CloseReceived)
                await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "agent stopping", CancellationToken.None)
                    .ConfigureAwait(false);
        }
        catch (Exception)
        {
            // A socket that will not close politely is still disposed below.
        }
        finally
        {
            socket.Dispose();
        }
    }

    public async ValueTask DisposeAsync() => await CloseSocketAsync().ConfigureAwait(false);
}

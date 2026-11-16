using System.Net;
using System.Net.Sockets;

namespace QrFakePrinter;

/// <summary>
/// A raw TCP 9100 listener that behaves like the network port on a receipt or
/// laser printer, so this machine can be the whole bench.
///
/// Windows sends the spooled bytes to 127.0.0.1:9100 exactly as it would send
/// them to a printer on the shop LAN. That makes it possible to watch a real
/// spooler job reach a real socket and land in a file, with no hardware and no
/// cable — see README.md for the two PowerShell commands that point a printer
/// queue at this listener.
///
/// What it proves: the job entered the spooler, was rendered, was handed to the
/// port monitor, and left this machine as bytes.
///
/// What it does NOT prove: that a real device would put ink on paper, or put it
/// in the right place. What arrives here is whatever the installed driver decided
/// to send — a valid PDF with the in-box PDF driver, a text stream with a text
/// driver, and nothing at all if the driver cannot reach the "device". Treat a
/// non-empty capture as "the plumbing works", not as "the page is right".
/// </summary>
public static class Program
{
    public static async Task<int> Main(string[] args)
    {
        var port = int.Parse(Flag(args, "--port") ?? "9100");
        var capture = Path.GetFullPath(Flag(args, "--capture") ?? Path.Combine(AppContext.BaseDirectory, "capture"));
        Directory.CreateDirectory(capture);

        // Loopback only, deliberately not configurable. A listener on 0.0.0.0
        // would put an unauthenticated port on whatever network the shop PC is
        // joined to, and every customer machine could feed it jobs.
        var listener = new TcpListener(IPAddress.Loopback, port);
        listener.Start();

        Console.WriteLine("QrFakePrinter — a bench stand-in for a network printer, not a printer");
        Console.WriteLine($"  listening  tcp://127.0.0.1:{port}  (loopback only)");
        Console.WriteLine($"  capturing  {capture}");
        Console.WriteLine();
        Console.WriteLine("Waiting for the first connection. Ctrl+C to stop.");

        using var shutdown = new CancellationTokenSource();
        Console.CancelKeyPress += (_, eventArgs) =>
        {
            eventArgs.Cancel = true;
            shutdown.Cancel();
            try { listener.Stop(); } catch (SocketException) { }
        };

        var jobs = 0;
        try
        {
            while (!shutdown.IsCancellationRequested)
            {
                using var client = await listener
                    .AcceptTcpClientAsync(shutdown.Token).ConfigureAwait(false);
                jobs++;
                await ServeAsync(client, capture, jobs, shutdown.Token).ConfigureAwait(false);
            }
        }
        catch (OperationCanceledException)
        {
            // The normal way out.
        }
        catch (SocketException error)
        {
            Console.Error.WriteLine($"listener stopped: {error.Message}");
            return 1;
        }

        Console.WriteLine($"stopped after {jobs} job(s).");
        return 0;
    }

    private static async Task ServeAsync(TcpClient client, string capture, int number, CancellationToken cancel)
    {
        var started = DateTime.Now;
        var fileName = $"job-{number:000}-{started:HHmmss}.prn";
        var path = Path.Combine(capture, fileName);

        long bytes = 0;
        int pages = 0;

        await using var stream = client.GetStream();
        await using var file = new FileStream(path, FileMode.Create, FileAccess.Write, FileShare.None);

        var buffer = new byte[64 * 1024];
        client.ReceiveTimeout = 30_000;

        try
        {
            while (true)
            {
                var read = await stream.ReadAsync(buffer, cancel).ConfigureAwait(false);
                if (read == 0)
                    break;

                bytes += read;
                pages += Count(buffer.AsSpan(0, read));
                await file.WriteAsync(buffer.AsMemory(0, read), cancel).ConfigureAwait(false);
            }
        }
        catch (IOException error)
        {
            Console.Error.WriteLine($"  connection ended early: {error.Message}");
        }

        await file.FlushAsync(cancel).ConfigureAwait(false);

        Console.WriteLine(
            $"{started:HH:mm:ss} job {number:000}  {Format(bytes).PadLeft(9)} · {PageCount(pages, bytes)} · {fileName}" +
            (bytes == 0 ? "  ← the spooler connected but sent nothing" : ""));
    }

    /// <summary>
    /// Form feeds are the page marks a raw stream uses. A stream with bytes and
    /// no form feed is one page as far as the device is concerned, so report 1
    /// rather than 0 — but only when there is something to have printed.
    /// </summary>
    private static int Count(ReadOnlySpan<byte> chunk)
    {
        var pages = 0;
        foreach (var byteValue in chunk)
            if (byteValue == 0x0C)
                pages++;

        return pages;
    }

    private static string PageCount(int pages, long bytes) =>
        bytes == 0 ? "no data" : $"{Math.Max(1, pages)} page(s)";

    private static string Format(long bytes) => bytes switch
    {
        < 1024 => $"{bytes} B",
        < 1024 * 1024 => $"{bytes / 1024.0:0.#} KB",
        _ => $"{bytes / (1024.0 * 1024.0):0.#} MB",
    };

    private static string? Flag(string[] args, string name)
    {
        var index = Array.IndexOf(args, name);
        return index >= 0 && index + 1 < args.Length ? args[index + 1] : null;
    }
}

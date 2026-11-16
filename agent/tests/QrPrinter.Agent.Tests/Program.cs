using System.Net;
using System.Text;
using QrPrinter.Agent.Config;
using QrPrinter.Agent.Hardware;
using QrPrinter.Agent.Logging;
using QrPrinter.Agent.Net;
using QrPrinter.Agent.Printing;

namespace QrPrinter.Agent.Tests;

/// <summary>
/// The test suite, run as `dotnet run --project agent/tests/QrPrinter.Agent.Tests`.
///
/// It is a console program with no framework on purpose: this project downloads
/// nothing, and a person supporting a shop should be able to read every line of
/// the runner without knowing a test library's attributes.
///
/// Exit code is the number of failed checks, so CI and a human get the same
/// answer.
/// </summary>
public static class Program
{
    public static int Main()
    {
        Console.OutputEncoding = Encoding.UTF8;
        FileLog.Configure(LogLevel.Error, echoToConsole: false);

        PrintSettingsChecks();
        EncryptionRules();
        StatusDecoder();
        WireContract();
        PathSafety();
        ApiClientChannel();
        BackendArguments();
        WindowsService();

        Console.WriteLine();
        Console.WriteLine(Runner.Failed == 0
            ? $"{Runner.Passed} checks passed."
            : $"{Runner.Passed} passed, {Runner.Failed} FAILED.");
        return Runner.Failed;
    }

    // ── what may reach a printer command line ───────────────────────────────
    private static void PrintSettingsChecks()
    {
        Section("print settings");

        Runner.Case("defaults are one copy, A4, mono", () =>
            Runner.Equal("copies=1,paper=A4,mono", PrintSettings.Build(Request()), "the settings string"));

        Runner.Case("duplex and colour are the only extra tokens", () =>
            Runner.Equal(
                "copies=1,duplex=long,paper=Legal,color",
                PrintSettings.Build(Request() with { Copies = 2, Duplex = true, Paper = "Legal", Colour = true }),
                "the settings string"));

        // A driver may ignore the copy count and the spooler still says done, so
        // the agent repeats the submission instead and confirms each one.
        Runner.Case("the driver is always asked for exactly one copy", () =>
        {
            foreach (var copies in new[] { 1, 2, 7, 99 })
                Runner.True(
                    PrintSettings.Build(Request() with { Copies = copies }).StartsWith("copies=1,", StringComparison.Ordinal),
                    $"{copies} requested");
        });

        // Page range is deliberately absent until the pinned Sumatra build is
        // verified; an ignored token looks exactly like a successful print.
        Runner.Case("page range does not become a print setting", () =>
            Runner.Equal("copies=1,paper=A4,mono", PrintSettings.Build(Request() with { PageRange = "1-4" }), "still no range"));

        Runner.Case("paper is a whitelist, not a string", () =>
            Runner.Throws<ArgumentException>(() => PrintSettings.Build(Request() with { Paper = "A6" })));

        Runner.Case("paper cannot carry a shell metacharacter", () =>
            Runner.Throws<ArgumentException>(() => PrintSettings.Build(Request() with { Paper = "A4&calc.exe" })));

        Runner.Case("printer names cannot carry quotes or control characters", () =>
        {
            Runner.Throws<ArgumentException>(() => PrintSettings.Build(Request() with { Printer = "Honey\" -print-to \"evil" }), "a quote");
            Runner.Throws<ArgumentException>(() => PrintSettings.Build(Request() with { Printer = "Floor\nPrinter" }), "a newline");
        });

        Runner.Case("a job id is a file name, so traversal is refused", () =>
            Runner.Throws<ArgumentException>(() => PrintSettings.Build(Request() with { JobId = "../../windows/win.ini" })));

        Runner.Case("copies outside 1..99 are refused", () =>
        {
            Runner.Throws<ArgumentException>(() => PrintSettings.Build(Request() with { Copies = 0 }), "zero");
            Runner.Throws<ArgumentException>(() => PrintSettings.Build(Request() with { Copies = 100 }), "a hundred");
        });

        Runner.Case("page ranges are numbers and dashes only", () =>
        {
            foreach (var good in new[] { "1", "1-4", "1,3,5-7" })
                PrintSettings.Validate(Request() with { PageRange = good });

            foreach (var bad in new[] { "1;net user", "pages=1", "1-4)", "-1" })
                Runner.Throws<ArgumentException>(() => PrintSettings.Validate(Request() with { PageRange = bad }), bad);
        });

        Runner.Case("job id shape is letters, digits, dash, underscore, 1..64", () =>
        {
            Runner.True(PrintSettings.IsSafeJobId("JOB-2026_11"), "a normal id");
            Runner.True(PrintSettings.IsSafeJobId(new string('a', 64)), "64 characters");
            Runner.True(!PrintSettings.IsSafeJobId(new string('a', 65)), "65 characters");
            Runner.True(!PrintSettings.IsSafeJobId("has space"), "a space");
            Runner.True(!PrintSettings.IsSafeJobId(""), "the empty id");
        });
    }

    // ── the one rule about clear text ───────────────────────────────────────
    private static void EncryptionRules()
    {
        Section("encryption rules");

        Runner.Case("localhost is recognised whatever the port", () =>
        {
            foreach (var address in new[] { "http://localhost:8000", "http://127.0.0.1:8787", "http://LOOPBACK/", "http://[::1]:80", "http://127.5.5.5" })
                Runner.True(AgentConfig.IsLocalHost(new Uri(address)), address);
        });

        Runner.Case("a shop LAN address is not localhost", () =>
        {
            foreach (var address in new[] { "http://192.168.1.20", "http://printer.local", "http://example.com" })
                Runner.True(!AgentConfig.IsLocalHost(new Uri(address)), address);
        });

        Runner.Case("http is allowed to loopback and nowhere else", () =>
        {
            Runner.True(AgentConfig.IsAllowedUnencrypted(new Uri("http://127.0.0.1:8000")), "loopback http");
            Runner.True(AgentConfig.IsAllowedUnencrypted(new Uri("https://example.com")), "https anywhere");
            Runner.True(!AgentConfig.IsAllowedUnencrypted(new Uri("http://10.0.0.5")), "private http");
        });

        Runner.Case("config refuses a clear text server", () =>
            Runner.Throws<InvalidOperationException>(() => Build(api: "http://shop.example.com")));

        Runner.Case("config refuses an unencrypted websocket to a remote host", () =>
            Runner.Throws<InvalidOperationException>(() => Build(socket: "ws://shop.example.com/agent/channel")));

        Runner.Case("a localhost bench is allowed on both halves", () =>
            Runner.Equal(
                "http://127.0.0.1:8000",
                Build(api: "http://127.0.0.1:8000", socket: "ws://127.0.0.1:8000/agent/channel").ApiBaseUrl,
                "api kept as written"));

        Runner.Case("tuning values that would break the shop are refused", () =>
        {
            Runner.Throws<InvalidOperationException>(() => Build(heartbeatSeconds: 1), "a 1s heartbeat");
            Runner.Throws<InvalidOperationException>(() => Build(maxConcurrentJobs: 0), "no job slots");
            Runner.Throws<InvalidOperationException>(() => Build(maxConcurrentJobs: 5), "five jobs at once");
        });
    }

    // ── what the spooler's bits mean ───────────────────────────────────────
    private static void StatusDecoder()
    {
        Section("status decoder");

        Runner.Case("no bits at all means idle, which is what these queues report", () =>
        {
            var (state, reason) = PrinterStateDecoder.Decode(0, PrinterAttributes.None);
            Runner.Equal(PrinterState.Ready, state, "state");
            Runner.Equal("", reason, "nothing to show");
        });

        Runner.Case("a paper-out wins over a printing bit", () =>
        {
            var (state, reason) = PrinterStateDecoder.Decode(
                (uint)(PrinterStatus.PaperOut | PrinterStatus.Printing), PrinterAttributes.None);
            Runner.Equal(PrinterState.NeedsAttention, state, "state");
            Runner.True(reason.StartsWith("out of paper", StringComparison.Ordinal), $"the first match leads: {reason}");
        });

        Runner.Case("work-offline in Windows beats every status bit", () =>
        {
            var (state, reason) = PrinterStateDecoder.Decode((uint)PrinterStatus.Waiting, PrinterAttributes.WorkOffline);
            Runner.Equal(PrinterState.Offline, state, "state");
            Runner.Equal("marked offline in Windows", reason, "reason");
        });

        Runner.Case("toner low is still ready, and says so", () =>
        {
            var (state, reason) = PrinterStateDecoder.Decode((uint)PrinterStatus.TonerLow, PrinterAttributes.None);
            Runner.Equal(PrinterState.Ready, state, "state");
            Runner.Equal("toner low", reason, "reason");
        });

        Runner.Case("an unrecognised bit stays unknown instead of looking healthy", () =>
        {
            var (state, reason) = PrinterStateDecoder.Decode(0x8000_0000, PrinterAttributes.None);
            Runner.Equal(PrinterState.Unknown, state, "state");
            Runner.Equal("unrecognised status bits 0x80000000", reason, "reason");
        });

        Runner.Case("a save-to-file queue is never a device", () =>
        {
            foreach (var port in new[] { "PORTPROMPT:", "NUL:", "FILE:", "USER:", "MOTP:1" })
                Runner.Equal(PrinterKind.Loopback, PrinterStateDecoder.DecodeKind(PrinterAttributes.Local, null, port), port);
        });

        Runner.Case("a 9100 port is a network device, including the bench one", () =>
        {
            foreach (var port in new[] { "127.0.0.1:9100", "192.168.1.20:9100", "WSD-abc", "10.0.0.9" })
                Runner.Equal(PrinterKind.Network, PrinterStateDecoder.DecodeKind(PrinterAttributes.Local, null, port), port);
        });

        Runner.Case("cables are local and shares are shared", () =>
        {
            Runner.Equal(PrinterKind.Local, PrinterStateDecoder.DecodeKind(PrinterAttributes.Local, null, "USB002"), "USB002");
            Runner.Equal(PrinterKind.Local, PrinterStateDecoder.DecodeKind(PrinterAttributes.Local, null, "LPT1:"), "LPT1:");
            Runner.Equal(PrinterKind.Shared, PrinterStateDecoder.DecodeKind(PrinterAttributes.Shared, @"\\shop-server", "TCP"), "a share");
            Runner.Equal(PrinterKind.Unknown, PrinterStateDecoder.DecodeKind(PrinterAttributes.None, null, null), "no hints at all");
        });

        Runner.Case("a shared printer is addressed by its server path", () =>
            Runner.Equal(
                @"\\shop-server\Downstairs",
                new PrinterReport { Name = "Downstairs", Server = @"\\shop-server" }.Endpoint,
                "endpoint"));
    }

    // ── the contract with the server ────────────────────────────────────────
    private static void WireContract()
    {
        Section("wire contract");

        Runner.Case("requests are snake_case", () =>
        {
            var json = Wire.Serialize(new PairRequest("BENCH1", "key", "HOST", "0.1.0"));
            foreach (var key in new[] { "pairing_code", "machine_key", "hostname", "agent_version" })
                Runner.True(json.Contains($"\"{key}\""), key);
        });

        Runner.Case("a job offer written by a server is read by the agent", () =>
        {
            const string json = """
                {"job_id":"MOCK-1","document_url":"http://127.0.0.1:8000/documents/sample.pdf",
                 "printer":"Bench 9100","copies":2,"duplex":true,"colour":false,
                 "paper":"A4","sha256":"aa"}
                """;
            var offer = Wire.TryDeserialize<JobOffer>(json);
            Runner.True(offer != null, "it parsed");
            Runner.Equal("MOCK-1", offer!.JobId, "job id");
            Runner.Equal(2, offer.Copies, "copies");
            Runner.True(offer.Duplex == true, "duplex");
            Runner.True(offer.IsUsable, "an offer with an id, a url and a printer is usable");
        });

        Runner.Case("an offer is unusable when any of the three is missing", () =>
        {
            Runner.True(!new JobOffer(null, "http://h/documents/a.pdf", "P").IsUsable, "no id");
            Runner.True(!new JobOffer("J", " ", "P").IsUsable, "no document");
            Runner.True(!new JobOffer("J", "http://h/documents/a.pdf", null).IsUsable, "no printer");
        });

        Runner.Case("a half-spoken dialect is ignored, not fatal", () =>
        {
            Runner.True(Wire.TryDeserialize<JobOffer>("this is not json") == null, "a plain non-JSON frame");
            Runner.True(Wire.TryDeserialize<JobOffer>("") == null, "an empty frame");
            Runner.True(Wire.TryDeserialize<ChannelFrame>("{not: [valid") == null, "a broken object");
        });

        Runner.Case("a heartbeat serialises the printer list the way `printers --json` does", () =>
        {
            var report = new PrinterReport
            {
                Name = "Bench 9100",
                Port = "127.0.0.1:9100",
                Driver = "Microsoft Print To PDF",
                Location = "Counter",
                Kind = PrinterKind.Network,
                State = PrinterState.Ready,
                RawStatus = 0,
                RawAttributes = (uint)PrinterAttributes.Local,
            };

            var json = Wire.Serialize(new HeartbeatRequest(
                "dev-1", "key", "0.1.0", "HOST", "Windows", true, [PrinterWire.From(report)], true,
                DateTimeOffset.UnixEpoch, 0));

            foreach (var key in new[] { "device_id", "spooler_running", "machine_key", "queue_depth", "status_reason", "raw_attributes" })
                Runner.True(json.Contains($"\"{key}\""), key);

            Runner.True(json.Contains("\"kind\":\"network\""), "kind is a lowercase word, not a number");
            Runner.True(json.Contains("\"location\":\"Counter\""), "the counter's location reaches the dashboard");
        });

        Runner.Case("nulls are left out, and no token is ever on this wire", () =>
        {
            var json = Wire.Serialize(new JobOffer("J", "http://h/a.pdf", "P"));
            Runner.True(!json.Contains("page_range"), "an absent page range is not written as null");
            Runner.True(!json.Contains("token"), "nothing a job carries is a credential");
        });

        Runner.Case("a result says how many copies the spooler confirmed", () =>
        {
            var json = Wire.Serialize(new JobResult("J", "dev-1", "failed", "P", "copy 3 of 3", DateTimeOffset.UnixEpoch, 2));
            Runner.True(json.Contains("\"copies_printed\":2"), json);

            // An outbox file written before the field existed must still be sent.
            var old = Wire.TryDeserialize<JobResult>(
                """{"job_id":"J","device_id":"d","status":"printed","stage":"P","detail":"x","finished_at":"2026-01-01T00:00:00Z"}""");
            Runner.True(old is { CopiesPrinted: null }, "an older result reads with no count");
        });
    }

    // ── file names built from network input ─────────────────────────────────
    private static void PathSafety()
    {
        Section("path safety");

        Runner.Case("a safe id is used as it is", () =>
            Runner.Equal("JOB-42_a", Directories.Safe("JOB-42_a"), "unchanged"));

        Runner.Case("anything else is reduced to harmless characters", () =>
        {
            foreach (var hostile in new[]
                     {
                         "../../windows/win.ini",
                         "..\\..\\Windows\\System32\\cmd.exe",
                         "job/with/slashes",
                         "C:\\Windows\\temp\\x",
                         "job:name",
                         "job*?",
                         "%2e%2e%2f",
                     })
            {
                var safe = Directories.Safe(hostile);
                Runner.True(!safe.Contains('/') && !safe.Contains('\\') && !safe.Contains(':'), $"{hostile} → {safe}");
                Runner.True(safe.Length <= 64, $"{hostile} stays short");
            }
        });

        Runner.Case("a long id is truncated, not kept", () =>
            Runner.Equal(64, Directories.Safe(new string('x', 200)).Length, "64 characters"));

        Runner.Case("spooled documents are always named QP-<id>.pdf", () =>
            Runner.Equal("QP-JOB-42.pdf", PrintSettings.SpoolFileName("JOB-42"), "the name the spooler shows"));
    }

    // ── how the agent talks to the server ───────────────────────────────────
    private static void ApiClientChannel()
    {
        Section("api client");

        Runner.Case("the token is a header and never a query string", async () =>
        {
            var config = Build();
            var http = new StubHttp();
            using var client = new ApiClient(config, Identity, http.Client(config));

            var outcome = await client.ReportAsync(
                new JobResult("JOB-1", "dev-1", "printed", "Bench 9100", "done", DateTimeOffset.UnixEpoch),
                CancellationToken.None);

            Runner.True(outcome.IsSuccess, $"the ack was read ({outcome.Error})");
            var sent = http.LastRequest!;
            Runner.True(sent.RequestUri!.Query.Length == 0, $"no query string at all ({sent.RequestUri.Query})");
            Runner.Equal("Bearer super-secret-token", sent.Headers.Authorization?.ToString(), "the bearer header");
            Runner.True(sent.Headers.UserAgent.ToString().Contains("QrPrinterAgent/"), "the build is identified");

            var leaked = sent.Headers
                .Where(header => header.Key != "Authorization")
                .SelectMany(header => header.Value)
                .Any(value => value.Contains("super-secret-token", StringComparison.Ordinal));
            Runner.True(!leaked, "the token appears in Authorization and nowhere else");
        });

        Runner.Case("pairing sends no token, because there is none yet", async () =>
        {
            var config = Build();
            var http = new StubHttp();
            using var client = new ApiClient(config, Identity, http.Client(config));

            await client.PairAsync("bench1", "key", "0.1.0", CancellationToken.None);

            var sent = http.LastRequest!;
            Runner.True(sent.Headers.Authorization == null, "no Authorization header");
            Runner.Equal("/agent/pair", sent.RequestUri!.AbsolutePath.ToLowerInvariant(), "the pair route");

            var body = http.LastBody;
            Runner.True(body != null, "the body was caught before the agent disposed the request");
            Runner.True(body!.Contains("BENCH1"), $"the code is upper-cased before it leaves: {body}");
            Runner.True(!body.Contains("bench1"), "and the lowercase form is gone");
        });

        Runner.Case("401 and 404 are terminal, 500 is not", () =>
        {
            Runner.True(ApiOutcome<JobOffer>.Rejected(401, "no").IsTerminal, "401 means re-pair, not retry");
            Runner.True(ApiOutcome<JobOffer>.Rejected(403, "no").IsTerminal, "403");
            Runner.True(ApiOutcome<JobOffer>.Rejected(404, "no").IsTerminal, "404");
            Runner.True(!ApiOutcome<JobOffer>.Rejected(500, "no").IsTerminal, "500 is worth another try");
            Runner.True(!ApiOutcome<JobOffer>.TransportFailed(new IOException("down")).IsTerminal, "no answer is not a refusal");
        });

        Runner.Case("a server that answers rubbish is a refusal, not a crash", async () =>
        {
            var config = Build();
            var http = new StubHttp(HttpStatusCode.OK, "application/json", "I am not JSON");
            using var client = new ApiClient(config, Identity, http.Client(config));

            var outcome = await client.HeartbeatAsync(
                new HeartbeatRequest("dev-1", "key", "0.1.0", "HOST", "Windows", true, [], true, DateTimeOffset.UnixEpoch, 0),
                CancellationToken.None);

            Runner.True(!outcome.IsSuccess, "not a success");
            Runner.True(outcome.Error!.Contains("cannot read"), $"said so plainly: {outcome.Error}");
        });

        Runner.Case("a redirect is not followed", async () =>
        {
            var config = Build();
            var http = new StubHttp(HttpStatusCode.Redirect, "application/json", "{}", ("Location", "http://elsewhere.example/"));
            using var client = new ApiClient(config, Identity, http.Client(config));

            var outcome = await client.PollJobsAsync(CancellationToken.None);
            Runner.True(!outcome.IsSuccess, "302 is not treated as an answer");
            Runner.Equal(1, http.Requests.Count, "and no second request was made");
        });
    }

    // ── how the document is handed over ─────────────────────────────────────
    private static void BackendArguments()
    {
        Section("print backend");

        Runner.Case("every value is its own argument", () =>
        {
            var arguments = SumatraPdfBackend.Arguments(
                "Bench 9100",
                "copies=1,paper=A4,mono",
                @"C:\spool\QP-JOB-1.pdf");

            Runner.Equal(9, arguments.Count, "the flag pairs plus the document");
            Runner.Equal("Bench 9100", arguments[1], "a printer name with a space is one element, not two");
            Runner.Equal(@"C:\spool\QP-JOB-1.pdf", arguments[^1], "the document is last");
            Runner.True(!arguments.Any(argument => argument.Contains(" -print-to ", StringComparison.Ordinal)), "no argument is a whole command line");
        });

        // Under Program Files the service account cannot write beside the exe,
        // and a settings file there would also leak into the shipped folder.
        Runner.Case("Sumatra keeps its settings in the agent's data folder", () =>
        {
            var arguments = SumatraPdfBackend.Arguments("Bench 9100", "copies=1,paper=A4,mono", "doc.pdf").ToList();
            var index = arguments.IndexOf("-appdata");
            Runner.True(index >= 0, "-appdata is passed");
            Runner.Equal(AgentPaths.SumatraDataDir, arguments[index + 1], "and points under the agent home");
        });

        Runner.Case("a printer name cannot smuggle extra flags", () =>
        {
            // ArgumentList is what protects this, so the check is that nothing is
            // assembled into one string before it gets there.
            var arguments = SumatraPdfBackend.Arguments("Fake\" -print-to evil", "copies=1,paper=A4,mono", "doc.pdf");
            Runner.Equal("Fake\" -print-to evil", arguments[1], "kept as one literal name");
        });

        Runner.Case("a missing backend is reported before the job is lost", () =>
        {
            var run = SumatraPdfBackend.Submit(
                @"C:\definitely\not\here\SumatraPDF.exe", "Bench 9100", "copies=1,paper=A4,mono", "doc.pdf", TimeSpan.FromSeconds(5));
            Runner.True(!run.Started, "it never started");
            Runner.True(!run.Succeeded, "so it did not succeed");
            Runner.True(run.Detail.Contains("missing", StringComparison.Ordinal), $"and said why: {run.Detail}");
        });
    }

    // ── the Windows service ─────────────────────────────────────────────────
    private static void WindowsService()
    {
        Section("windows service");

        // The reference value is what `sc showsid QrPrinterAgent` prints. If the
        // computation drifts, the installer would grant folder access to a SID
        // the service never runs as.
        Runner.Case("the virtual account SID matches what Windows assigns", () =>
            Runner.Equal(
                "S-1-5-80-3412084898-3806661600-2081082625-788283368-3836866",
                QrPrinter.Agent.Service.ServiceHost.Sid,
                "NT SERVICE\\QrPrinterAgent"));

        Runner.Case("the SID ignores the case of the service name", () =>
            Runner.Equal(
                QrPrinter.Agent.Service.ServiceHost.VirtualAccountSid("qrprinteragent"),
                QrPrinter.Agent.Service.ServiceHost.Sid,
                "lower-case name"));

        Runner.Case("the service may only be installed from Program Files", () =>
        {
            var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
            Runner.True(
                QrPrinter.Agent.Service.ServiceCommand.IsProtectedLocation(Path.Combine(programFiles, "QrPrinter Agent")),
                "Program Files\\QrPrinter Agent");
            Runner.True(
                !QrPrinter.Agent.Service.ServiceCommand.IsProtectedLocation(@"C:\Users\Shop\Downloads\QrPrinterAgent"),
                "a Downloads folder");
            Runner.True(
                !QrPrinter.Agent.Service.ServiceCommand.IsProtectedLocation(programFiles + " Evil\\Agent"),
                "a sibling folder whose name only starts with Program Files");
        });
    }

    // ── fixtures ────────────────────────────────────────────────────────────
    private static PrintRequest Request() => new("JOB-1", "Bench 9100");

    private static AgentConfig Build(
        string api = "https://shop.example.com",
        string socket = "wss://shop.example.com/agent/channel",
        int heartbeatSeconds = 20,
        int maxConcurrentJobs = 1) =>
        new AgentConfig
        {
            ApiBaseUrl = api,
            AgentSocketUrl = socket,
            HeartbeatSeconds = heartbeatSeconds,
            MaxConcurrentJobs = maxConcurrentJobs,
        }.Validate();

    private static DeviceIdentity Identity =>
        new("dev-1", "super-secret-token", "machine-key", DateTimeOffset.UnixEpoch);

    private static void Section(string name) => Console.WriteLine($"\n{name}");
}

/// <summary>
/// An <see cref="HttpMessageHandler"/> that answers whatever it is told to and
/// remembers what it was asked, so the agent's HTTP behaviour can be checked
/// without a server.
/// </summary>
file sealed class StubHttp
{
    private readonly HttpStatusCode _answer;
    private readonly string _mime;
    private readonly string _payload;
    private readonly (string Name, string Value)? _extraHeader;

    public StubHttp(
        HttpStatusCode answer = HttpStatusCode.OK,
        string mime = "application/json",
        string payload = """{"ok":true,"job_id":"JOB-1"}""",
        (string Name, string Value)? extraHeader = null)
    {
        _answer = answer;
        _mime = mime;
        _payload = payload;
        _extraHeader = extraHeader;
    }

    public List<HttpRequestMessage> Requests { get; } = [];

    public HttpRequestMessage? LastRequest => Requests.Count == 0 ? null : Requests[^1];

    /// <summary>
    /// What each request carried, read at send time. The agent disposes the
    /// request as soon as it has the answer, so a body cannot be caught later.
    /// </summary>
    public List<string?> Bodies { get; } = [];

    public string? LastBody => Bodies.Count == 0 ? null : Bodies[^1];

    /// <summary>The agent's client is built with a BaseAddress, so this one needs it too.</summary>
    public HttpClient Client(AgentConfig config) =>
        new(new Handler(this)) { BaseAddress = new Uri(config.ApiBaseUrl.TrimEnd('/') + "/") };

    private sealed class Handler(StubHttp owner) : HttpMessageHandler
    {
        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancel)
        {
            owner.Requests.Add(request);
            owner.Bodies.Add(request.Content == null ? null : await request.Content.ReadAsStringAsync(cancel));

            var response = new HttpResponseMessage(owner._answer)
            {
                Content = new StringContent(owner._payload, Encoding.UTF8, owner._mime),
                RequestMessage = request,
            };

            if (owner._extraHeader is { } header)
                response.Headers.TryAddWithoutValidation(header.Name, header.Value);

            return response;
        }
    }
}

/// <summary>
/// The runner. One line per check, a non-zero exit when any of them fails.
/// </summary>
internal static class Runner
{
    public static int Passed { get; private set; }
    public static int Failed { get; private set; }

    public static void Case(string name, Action body)
    {
        try
        {
            body();
            Passed++;
            Console.WriteLine($"  ok    {name}");
        }
        catch (Exception error)
        {
            Failed++;
            Console.WriteLine($"  FAIL  {name}");
            Console.WriteLine($"          {error.Message.Split('\n')[0]}");
        }
    }

    /// <summary>For checks that need to await; the case blocks, because these tests race nothing.</summary>
    public static void Case(string name, Func<Task> body) =>
        Case(name, () => body().GetAwaiter().GetResult());

    public static void Equal<T>(T expected, T actual, string what)
    {
        if (!EqualityComparer<T>.Default.Equals(expected, actual))
            throw new Exception($"{what}: expected [{expected}], got [{actual}]");
    }

    public static void True(bool condition, string what)
    {
        if (!condition)
            throw new Exception(what);
    }

    public static void Throws<TException>(Action body, string? what = null) where TException : Exception
    {
        try
        {
            body();
        }
        catch (TException)
        {
            return;
        }
        catch (Exception error)
        {
            throw new Exception($"{what ?? "the call"}: threw {error.GetType().Name}, expected {typeof(TException).Name}");
        }

        throw new Exception($"{what ?? "the call"}: expected {typeof(TException).Name}, nothing was thrown");
    }
}

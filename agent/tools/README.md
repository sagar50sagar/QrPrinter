# The bench: testing the agent with no printer attached

This folder holds three dev-only tools. None of them ships to a shop.

| Tool | What it is |
| --- | --- |
| `QrPrinter.MockServer/` | A stand-in for the cloud: pairing, heartbeat, job push, results. |
| `QrFakePrinter/` | A raw TCP listener on `127.0.0.1:9100`, the port a network printer uses. |
| `setup-bench-printer.ps1` | Points a Windows printer queue at that listener, and removes it again. |
| `get-sumatra.ps1` | Downloads and verifies the SumatraPDF sidecar into `../vendor/sumatra`. |

Together they let one machine run the whole path — pair, receive a job, download
it, hand it to the spooler, watch the bytes leave, report the result — without
hardware.

## Why a fake network printer instead of "Microsoft Print to PDF"

`Print to PDF` and `OneNote` are queues that open a save dialog. The agent
refuses to print a customer job into one, on purpose: it is not a device and it
does not produce paper. A Standard TCP/IP port aimed at `127.0.0.1:9100` goes
through the same spooler, port monitor and bytes-on-the-wire path a real printer
does, so it exercises the thing that actually matters.

## Set up (once, needs an elevated window)

```powershell
powershell -ExecutionPolicy Bypass -File agent/tools/setup-bench-printer.ps1
```

That runs the equivalent of:

```powershell
Add-PrinterPort -Name '127.0.0.1:9100' -PrinterHostAddress '127.0.0.1'
Add-Printer -Name 'Bench 9100' -DriverName 'Microsoft Print To PDF' -Port '127.0.0.1:9100'
```

The script tries `Generic / Text Only` first and falls back, because that driver
is not present on every Windows 11 build and the in-box PDF driver is. Both give
the same port path; only the rendered bytes differ.

Undo it with:

```powershell
powershell -ExecutionPolicy Bypass -File agent/tools/setup-bench-printer.ps1 -Remove
```

## Run

Three windows, in this order.

```bash
# 1. the listener — captures what the spooler sends
"C:/Program Files/dotnet/dotnet.exe" run --project agent/tools/QrFakePrinter

# 2. the fake cloud (prints the exact pair command on startup)
#    --documents must be absolute: `dotnet run` resolves a relative one
#    against the project folder, not this one
"C:/Program Files/dotnet/dotnet.exe" run --project agent/tools/QrPrinter.MockServer -- --documents "$(pwd -W)/agent/bench-docs"

# 3. the agent (build it first with agent/tools/build-agent.ps1)
agent/dist/QrPrinterAgent/QrPrinterAgent.exe pair BENCH1 --api http://127.0.0.1:8000 --socket ws://127.0.0.1:8000/agent/channel
agent/dist/QrPrinterAgent/QrPrinterAgent.exe run
```

The mock keeps paired devices in memory, so pair again every time it restarts.

Then hand it a job from a fourth window:

```bash
curl -X POST http://127.0.0.1:8000/test/job \
  -H "content-type: application/json" \
  -d "{\"printer\":\"Bench 9100\",\"file\":\"sample.pdf\",\"copies\":2}"

curl -s http://127.0.0.1:8000/test/results
```

Put any PDF at `agent/bench-docs/sample.pdf` first. Without `--documents` the
mock serves from a `documents` folder beside its own build output instead. The
listener writes each job it receives to `capture/job-NNN-HHMMSS.prn` beside its
build output (pass `--capture` somewhere else if you prefer). A two-copy job
leaves two capture files, because the agent sends each copy as its own queue job
and the driver is always told `copies=1`.

## What this proves, and what it does not

Proved by a bench run — and this machine has run it:

* pairing burns a code, stores a device token and narrows its ACL to one user;
* the heartbeat carries a live printer list and the spooler's state;
* a job arrives over the websocket, downloads, and its SHA-256 is checked;
* a job aimed at a virtual queue is refused before a byte is downloaded;
* SumatraPDF hands the document to the named queue;
* the spooler accepts the job, and the queue clears it;
* bytes leave this machine and land in the capture file;
* each copy is its own queue job, and the server is told how many the queue
  actually cleared (`copies_printed`), not how many were asked for;
* the result reaches the server, and the agent's outbox entry is deleted only
  after the server acknowledges it.

Not proved:

* **that paper comes out, or that the page looks right**. The listener receives
  what a driver renders for a device it has never met. With the PDF driver the
  capture is a valid PDF, which means a PDF-capable printer would print it; a
  GDI printer receives EMF→PCL or raster from its own driver, and this bench
  never exercises that translation.
* duplex, colour and paper sizing against real hardware, for the same reason.
* anything about the shop's actual devices. A driver that fails on a real
  printer will pass here.

So a green bench is a necessary check, not an acceptance test. The last mile is
still one real printer in front of you.

## Running it as a Windows service

`run` is for watching the agent work. In a shop it runs as a service, which starts
with Windows, needs nobody logged in, and restarts itself after a crash.

From an **administrator** PowerShell, after `pair`:

```powershell
robocopy "C:\Users\HP\Desktop\QrPrinter\agent\dist\QrPrinterAgent" "C:\Program Files\QrPrinter Agent" QrPrinterAgent.exe SumatraPDF.exe /R:2 /W:2
& "C:\Program Files\QrPrinter Agent\QrPrinterAgent.exe" service install
```

`service install` refuses to run from anywhere but Program Files. The service
runs the exe it points at with service rights, so a copy in Downloads or on the
Desktop is one any user could swap out. It then:

* registers `QrPrinterAgent` as an automatic service under its own virtual
  account, `NT SERVICE\QrPrinterAgent`, not SYSTEM, because SumatraPDF reads
  customer PDFs;
* restarts it 5 s, 30 s and then 5 min after a failure;
* locks `C:\ProgramData\QrPrinter Agent` to SYSTEM, Administrators, the service
  and the account that installed it, so other Windows users cannot read
  documents waiting in `spool`;
* starts it and waits until it is really running.

Day to day (`status` works without admin, the rest need it):

```powershell
& "C:\Program Files\QrPrinter Agent\QrPrinterAgent.exe" service status
& "C:\Program Files\QrPrinter Agent\QrPrinterAgent.exe" service restart
& "C:\Program Files\QrPrinter Agent\QrPrinterAgent.exe" service uninstall
```

`uninstall` keeps the pairing and the logs. `run` refuses while the service is
running, so two agents never share one device token. `run --once` still works as
a probe.

To upgrade, stop first: Windows will not let robocopy overwrite a running exe.

```powershell
& "C:\Program Files\QrPrinter Agent\QrPrinterAgent.exe" service stop
robocopy "C:\Users\HP\Desktop\QrPrinter\agent\dist\QrPrinterAgent" "C:\Program Files\QrPrinter Agent" QrPrinterAgent.exe SumatraPDF.exe /R:2 /W:2
& "C:\Program Files\QrPrinter Agent\QrPrinterAgent.exe" service install
```

**A service only sees printers installed for the whole machine.** A printer
someone added as `\\other-pc\printer` from their own login belongs to that login.
The service cannot see it, and it will not appear in the dashboard. Add a shared
printer as a local printer on a Standard TCP/IP port aimed at the printer's own
address instead. The printer list the dashboard shows comes from the service's
heartbeat, so that list is what the service can print to; `QrPrinterAgent
printers` run in your own window can show more.

## Rules that keep the bench honest

* The mock server and the fake printer bind to `127.0.0.1` only, and refuse to
  be pointed at a network interface.
* The mock's pairing code is single-use, and no document path escapes the
  `--documents` folder.
* Neither tool stores document content anywhere except the capture folder, and
  the capture folder is yours to delete.

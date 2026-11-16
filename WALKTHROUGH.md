# QrPrinter — the plain-language walkthrough

This guide takes you from an empty folder to a working print shop: a customer scans a
QR code, uploads a document from their phone, pays at your counter, and you print it
from your dashboard. No programming knowledge is needed. Every command below can be
copied and pasted. Where a step produces something you should see, it says so.

> **The one-sentence version:** the **server** is the brain, the **panel** is your
> counter screen, the **customer page** is what a phone opens after scanning your QR,
> and the **agent** is a small program on your shop PC that is the only thing that
> actually touches the printers.

---

## 0. Who does what

| Role | Where they go | Do they need an account? |
| --- | --- | --- |
| **Customer** | Scans your QR → `/s/your-shop` | **No.** They type a name and upload. That is the whole sign-up. |
| **Shop owner / counter** | `/panel/` | Yes — you create the shop once (email + password). |
| **Shop PC (the agent)** | A program, not a web page | Paired once with a code from your panel. |
| **Platform operator (you, the product owner)** | `/admin/` | Yes — seeded once from the command line. Above every shop. |

The journey, end to end:

```
Customer phone                 Your counter (panel)              Shop PC (agent)
─────────────                  ────────────────────              ───────────────
Scan QR
Type name, pick files
Upload  ───────────────────►   Order appears (Unpaid)
                               Customer pays cash or online
                               Paid (cash: mark; online: auto) ─►  Job arrives
                                                                 Prints on the
                                                                 right printer
                               Queue shows "Printing"  ◄──────   Reports result
See "2 of 2 printed —          Dashboard totals update
 ready to collect"             Document auto-deletes after 10 min
Collect paper
```

---

## 1. What you need first

Install these once on the machine that will run the **server** (your shop PC can be
the same machine while you test):

1. **Node.js 22 or newer** — <https://nodejs.org> (this project was built on Node 24).
   Check: `node --version`.
2. **PostgreSQL 18**, running as a normal Windows service on port **5432**.
   You need its superuser password (the one you set when installing PostgreSQL).
   Check: `"D:\psql\bin\pg_isready.exe" -h 127.0.0.1 -p 5432` should say *accepting connections*.
   *(If your PostgreSQL lives elsewhere, substitute that `bin` folder.)*
3. **.NET 10 SDK** — only needed to **build** the agent. A shop PC that receives the
   finished agent folder needs nothing. Check: `dotnet --version`.

You do **not** need Docker, and you do not need a printer to follow this guide —
section 11 explains how to test printing without one, and what that does and does not prove.

> **Folder used in this guide:** `C:\Users\HP\Desktop\QrPrinter`. If yours is elsewhere,
> replace that path in the commands. In Git Bash, `cd "C:/Users/HP/Desktop/QrPrinter"`.

---

## 2. Part A — Start the server (the brain)

The server stores shops, orders and documents, serves the screens, and talks to the agent.

```bash
cd "C:/Users/HP/Desktop/QrPrinter/server"
npm install
npm run bootstrap
```

`bootstrap` will ask for your **PostgreSQL superuser password**. It then:
- creates a least-privilege database role `qrprinter` and a database `qrprinter` (it does **not** use the superuser for day-to-day work),
- writes `server/.env` with the connection string,
- applies the database migrations (`001_init`, `002_admin`, `003_order_completion`).

**You should see:** `created role qrprinter`, `created database qrprinter`, `wrote server/.env`, `[db] applied migration …`, `Done.`

Now create the **platform operator** login (there is no public sign-up for admins):

```bash
ADMIN_EMAIL=you@example.com ADMIN_PASSWORD='choose-a-long-password' npm run seed:admin
```

**You should see:** `created superadmin you@example.com`.

Start the server:

```bash
npm start
```

**You should see:**
```
QrPrinter server listening on http://127.0.0.1:8787
  public base   http://127.0.0.1:8787
  documents     …\server\var\documents
  agent channel ws://127.0.0.1:8787/agent/channel
```

Leave this window open. Quick health check from a second window:

```bash
curl http://127.0.0.1:8787/api/agent/health
```
**Expected:** `{"ok":true,"name":"QrPrinter","devices":0}`

> **Local vs. real shop.** `http://127.0.0.1:8787` is for testing on one machine. The
> agent only accepts cleartext HTTP for loopback. For a shop PC on another machine, or
> customers on the internet, set `PUBLIC_BASE_URL` to an **https://** address in
> `server/.env` and put the server behind TLS (see Part J). The QR codes and document
> links are built from `PUBLIC_BASE_URL`, so it must match how people actually reach you.

---

## 3. Part B — Build the screens

The panel, customer page, admin console and marketing page are one project with four
entries. Build them once; the server serves the result.

```bash
cd "C:/Users/HP/Desktop/QrPrinter"
npm install
npm run build
```

**You should see** four HTML files emitted: `dist/index.html`, `dist/panel/index.html`,
`dist/customer.html`, `dist/admin/index.html`, plus `dist/assets/…`, and `✓ built in …`.

Because `dist/` now exists, the running server (Part A) serves everything:

| Screen | Address (local) |
| --- | --- |
| Marketing page | <http://127.0.0.1:8787/> |
| **Counter panel** | <http://127.0.0.1:8787/panel/> |
| **Platform admin** | <http://127.0.0.1:8787/admin/> |
| Customer upload | `http://127.0.0.1:8787/s/<your-shop>` |

> **Editing screens live (optional).** `npm run dev` serves them at
> <http://localhost:5173> with instant reload, and forwards `/api`, `/documents` and
> `/agent` to the server on 8787. Use it while changing text; use `npm run build` for
> the real thing. Never edit anything inside `dist/` — the next build overwrites it.

---

## 4. Part C — Create your shop

1. Open <http://127.0.0.1:8787/panel/>.
2. Choose **Create a shop**. Fill in:
   - **Cyber cafe name** — e.g. `Sharma Cyber Cafe` (shown to you and to customers).
   - **Email** and **Password** (at least 8 characters) — this is the counter login.
   - **Shop link** — e.g. `sharma-cyber`. This becomes your permanent customer address
     `/s/sharma-cyber`. Letters, numbers and hyphens only. If you leave it out, one is
     made from the cafe name.
3. Submit. You land on the **Dashboard**.

**You should see:** four stat cards (Today prints, Today payment, Waiting for payment,
Total billed today) all at zero, an empty Printers list, and an empty queue. The left
nav has **Dashboard · Printing · Settings**.

> The marketing page's "Login / Get Started" buttons point at this panel, so a shop
> owner can also arrive from the landing page.

---

## 5. Part D — Set up the shop (Settings)

Open **Settings**. Work top to bottom:

1. **Printer configuration** — assign which physical printer handles **B&W** and which
   handles **Colour**. These names must match printers the agent reports (Part E).
   A print type with no printer assigned is reported back, never guessed.
2. **Reported printers** — empty until an agent pairs and sends its heartbeat. This is
   the live list from the shop PC, including each printer's state (ready / busy / offline).
3. **Counter header** — cafe name and a one-line **welcome message** (also shown on the
   customer page). Saves as you type.
4. **Rates** — rupees **per page** for B&W and Colour. A job costs
   `pages × copies × rate`. The panel shows a worked example so you can sanity-check.
5. **Shop status** — the **Open / Closed** switch. While closed, the customer page
   refuses new uploads; existing orders are unaffected.
6. **Customer link & QR** — your permanent link with a **Copy** button, and **PNG** /
   **SVG** downloads of the QR. Print the QR once and stick it on the counter; it keeps
   working forever. Customers scan it, upload, and pay at the counter — **no account**.
7. **Pair the local agent** — press **Generate pairing code**. A 6-character code
   appears (e.g. `K7M2QX`) with an expiry time. You will use it in Part E. The code is
   single-use: once an agent pairs with it, it cannot be reused.
8. **Online payments (optional)** — lets customers pay for their prints by UPI or card
   straight into **your own** Razorpay account. Leave it off and customers simply pay
   cash at the counter; nothing else changes. To switch it on:
   - Create a Razorpay account **for your shop** and complete its KYC (Razorpay's own
     onboarding; the platform is not involved in your print money).
   - In Razorpay → **Settings → API Keys**, copy the **Key ID** and **Key Secret** into
     the two fields here. The secret is stored **encrypted** and is never shown again —
     the field reads "saved" once set; leave it blank to keep the saved one.
   - In Razorpay → **Settings → Webhooks**, add a webhook using the **Payment webhook
     URL** shown here (it is unique to your shop), choose a **secret**, and paste that
     same secret into the **Webhook secret** field. Subscribe it to the
     **`payment.captured`** and **`order.paid`** events.
   - Press **Save online payment keys**. The badge flips to **On** and the customer page
     grows a **Pay online** button.
   - **Disconnect online payments** removes your saved keys and turns the button off
     again (customers fall back to cash). It asks once, with a warning, before doing it.

   A print is only ever marked **paid online** after Razorpay confirms the money through
   that webhook — never because the customer's browser said so. Online-paid orders land
   in **Printing → Prepaid printing**, ready to print (Part G).

---

## 6. Part E — Install the agent on the shop PC

The agent is the only thing that touches printers. It runs on the shop PC, pairs with
your shop, and receives jobs.

### E1. Get the agent folder

If you already have `agent/dist/QrPrinterAgent/` (it contains `QrPrinterAgent.exe` and
`SumatraPDF.exe`), skip to E2. To build it yourself from source — recommended, so you
control the binary:

```bash
powershell -ExecutionPolicy Bypass -File "C:/Users/HP/Desktop/QrPrinter/agent/tools/build-agent.ps1"
```

This publishes a self-contained `QrPrinterAgent.exe` (no .NET needed on the shop PC) and
copies the **SumatraPDF** print backend beside it, because the agent looks for
`SumatraPDF.exe` in its own folder. The backend is vendored in `agent/vendor/sumatra/`;
it is never downloaded at runtime.

**You should see:** `folder …\agent\dist\QrPrinterAgent (… MB)` and a file listing.

Sanity-check the build:

```bash
"C:/Users/HP/Desktop/QrPrinter/agent/dist/QrPrinterAgent/QrPrinterAgent.exe" version
"C:/Users/HP/Desktop/QrPrinter/agent/dist/QrPrinterAgent/QrPrinterAgent.exe" doctor
```

`doctor` checks the spooler service, printer access, config, pairing, SumatraPDF and the
data folder. **Exit code 1 means printing cannot work yet** — read its output before going on.

### E2. See the printers

```bash
"C:/Users/HP/Desktop/QrPrinter/agent/dist/QrPrinterAgent/QrPrinterAgent.exe" printers
```

Note the exact printer names. Go back to **Settings → Printer configuration** and assign
those names to B&W and Colour.

> A Windows **service** only sees printers installed for the whole machine. A printer
> someone added as `\\other-pc\printer` from their own login is invisible to the service.
> Add shared printers as a local printer on a Standard TCP/IP port aimed at the printer's
> own address instead.

### E3. Pair (first time needs the server addresses)

Use the code from **Settings → Pair the local agent**:

```bash
"C:/Users/HP/Desktop/QrPrinter/agent/dist/QrPrinterAgent/QrPrinterAgent.exe" pair K7M2QX --api http://127.0.0.1:8787 --socket ws://127.0.0.1:8787/agent/channel
```

Replace `K7M2QX` with your code. `--api` and `--socket` are needed only the first time
(afterwards they are read from `config.json`). For a real deployment use your **https**
address and the matching **wss** socket.

**You should see** the shop name and a confirmation that the device is paired. The agent
stores a device token in `device.json` under `%PROGRAMDATA%\QrPrinter Agent`, locked to
the installing account. The token only ever travels in an `Authorization: Bearer` header
— never in a web address. Back in the panel, **Reported printers** now fills in and the
device shows **online**.

### E4. Run it — watch it work, or install as a service

**To watch (foreground, good for testing):**
```bash
"C:/Users/HP/Desktop/QrPrinter/agent/dist/QrPrinterAgent/QrPrinterAgent.exe" run
```
`run --once` does a single heartbeat + poll and exits — handy for support.

**For a real shop (Windows service, starts with the PC, nobody logged in):**
From an **administrator** PowerShell:
```powershell
robocopy "C:\Users\HP\Desktop\QrPrinter\agent\dist\QrPrinterAgent" "C:\Program Files\QrPrinter Agent" QrPrinterAgent.exe SumatraPDF.exe /R:2 /W:2
& "C:\Program Files\QrPrinter Agent\QrPrinterAgent.exe" service install
```
`service install` only works from a copy in **Program Files** (a copy on the Desktop is
one any user could swap out). It registers `QrPrinterAgent` as an automatic service under
its own virtual account `NT SERVICE\QrPrinterAgent` (not SYSTEM, because SumatraPDF reads
customer PDFs), restarts it after failures, and locks `%PROGRAMDATA%\QrPrinter Agent` so
other Windows users cannot read documents waiting in `spool`.

Day to day (`status` needs no admin; the rest do):
```powershell
& "C:\Program Files\QrPrinter Agent\QrPrinterAgent.exe" service status
& "C:\Program Files\QrPrinter Agent\QrPrinterAgent.exe" service restart
& "C:\Program Files\QrPrinter Agent\QrPrinterAgent.exe" service stop
& "C:\Program Files\QrPrinter Agent\QrPrinterAgent.exe" service uninstall
```
`run` refuses to start while the service is running, so two agents never share one token.
To upgrade: `service stop`, robocopy again, `service install`.

> **Unsigned binary / SmartScreen.** The agent is not code-signed yet. Windows may warn
> when you run an exe you downloaded. Building it yourself from source (E1) is the clean
> path because you control the binary. Code signing and a proper installer are on the
> roadmap. Do not disable antivirus or strip a file's "downloaded from the internet"
> mark to silence a warning — fix the trust chain by signing instead.

---

## 7. Part F — The customer journey (no account)

This is what a person at your counter does on their phone. You can try it yourself in a
browser at `http://127.0.0.1:8787/s/<your-shop>`.

1. **Scan the QR** (or open the link). The page shows your cafe name, **Open — accepting
   uploads**, your welcome message, and your per-page rates.
2. **Type a name** (required). Phone and a note for the counter are optional.
3. **Add documents** — PDF, PNG, JPG or WEBP, up to 20 files. Each file gets its own
   **copies**, **print type** (B&W / Colour) and **double-sided** setting.
4. **Upload.** The page counts pages automatically and shows:
   - an **order number** like `J-1000` (show this at the counter),
   - the **amount** (`pages × copies × rate`, summed over files),
   - a **Pay at the counter** badge,
   - one row per document with its own id (`J-1000-1`, `J-1000-2`, …) and a print status.
5. **Pay — your choice.** If the shop has online payments switched on (Part D), a
   **Pay online ₹…** button appears under the order. Tap it to open Razorpay's secure
   checkout (UPI or card); the money goes straight to the shop. Once Razorpay confirms
   the payment the badge changes to **Paid online** by itself — the page refreshes every
   few seconds, so you can simply wait. Prefer cash? Ignore the button and pay at the
   counter as usual; the badge stays **Pay at the counter** until the counter marks it paid.
6. The page keeps itself fresh. As you print, each document's status moves
   **Waiting → In queue → Printing → Printed**, and a line reads
   **"2 of 2 printed — ready to collect."**
7. **Collect the paper.** Done. No login, ever.

If the shop is **Closed** or **deactivated**, the page says so and refuses the upload
before any file is sent.

> **One order, many documents.** Uploading several files at once creates **one order**
> (one payment, one order number) with a **separate id per document** (separate print
> status). That is deliberate: the customer pays once, but each sheet's progress is tracked.

---

## 8. Part G — The counter journey (panel)

### Cash printing (the working payment path)

Open **Printing → Cash printing**. You see every job with id, customer name, file,
pages/copies, print type and payment status.

1. Filter by **Unpaid / Paid / All** and by **Colour / B&W / All**.
2. The customer hands over cash. Tick their job(s) — or **Select all** — and set the
   payment dropdown to **Paid**. (Cash is **Paid / Unpaid** only; there is no method
   switching.)
3. Press **Print**. **Nothing prints before payment** — this is enforced by the server,
   not just the screen. An unpaid job is never offered to the agent.
4. Each print type goes to the printer you assigned in Settings. If a type has no
   printer, the panel tells you instead of guessing.
5. Watch the **Dashboard** queue move Pending → Printing → Success. A failed job shows
   the reason and a **Retry**; retrying re-queues just that document.
6. **Select all** skips jobs already printed, so you never double-print by accident.

### Prepaid printing

**Printing → Prepaid printing** lists documents already paid, with no payment controls —
just select and print. This is where **online-paid** orders arrive: when a customer pays
by UPI / card on their phone (Part F) and Razorpay's webhook confirms it, the job appears
here automatically, already **Paid**, ready for you to press **Print**. Cash jobs you mark
paid stay in **Cash printing**; the two tabs never mix. As with cash, nothing prints until
you press Print — paying online does not auto-print.

### Dashboard

The four cards update from **orders**, so the day's totals stay correct even after
printed documents are auto-deleted (Part I): Today prints (jobs · sheets), Today payment
(cash · online), Waiting for payment, Total billed today. Below them: printer states and
the live queue.

### Billing (your subscription)

**Billing** shows your plan (₹299/month), your current state and what to do next:

- **Free trial** — every new shop gets 14 days, no card. The tab shows the days left.
- **Active** — a paid subscription; shows the date you are paid through.
- **Grace period** — a payment lapsed; 3 more days before printing pauses. A yellow banner
  appears on every tab with a **Renew in Billing** shortcut.
- **Lapsed / no plan** — printing and customer uploads are paused. A red banner appears
  with **Open Billing**. The panel itself stays reachable so you can fix it.
- **Comped** — the platform granted free access; no subscription needed.

**Subscribe** opens Razorpay's hosted checkout in a new tab. Access switches on by itself
once Razorpay confirms payment — a webhook tells the server; the browser is never
trusted. **Cancel** stops renewal at the period end; you keep access until then.

If Subscribe is greyed out with "online payments aren't set up", the server has no
Razorpay keys yet — see Part J.

---

## 9. Part H — The platform operator (admin)

This is you, the product owner, above every shop. Open <http://127.0.0.1:8787/admin/> and
sign in with the credentials from `seed:admin` (Part A). The admin login uses a separate
cookie from the shop login, so one browser can hold both.

- **Overview** — platform totals (shops, open, deactivated, orders, documents, collected,
  prints today, agents online) and a row per shop with its owner email, link and counts.
- **Subscription price** — set what every shop pays for the platform plan (default
  **₹299/month**). Type a new rupee amount, optionally rename the plan, and press **Save**.
  This is the **platform subscription**, *not* the shop's per-page print rates — those stay
  the shop owner's own setting in the panel. The new price applies to **new subscriptions
  only**; shops already subscribed keep their current price until they re-subscribe. When
  Razorpay is switched on (Part J), the next checkout automatically creates a fresh plan at
  the new amount, so a price change never disturbs an existing subscriber.
- **Shop detail** — owner, connected agents (online/offline), recent orders, and counts
  (orders, documents, printed, failed, collected). The device token is never shown.
- **Deactivate / activate account** — the platform's off-switch for a whole shop. A
  **deactivated** shop's admin is **locked out of the app entirely**: any active session is
  cut off and signing in is refused with an "Account deactivated" screen, *and* customers
  cannot upload — **regardless of the shop's own Open/Closed switch or its subscription**.
  The shop **cannot reactivate itself**; only you can. Deactivating asks once with the
  consequence stated; **Activate** restores access immediately. Reversible, never deletes
  data. (This is different from a subscription **lapsing**, which is automatic — see Billing.)
- **Subscriptions** — a second totals row (MRR, paying, trialing, comped, lapsed) and a
  billing badge on every shop. **Comp / remove comp** grants or withdraws free access;
  removing asks once with the consequence stated, since it can pause a shop. Shop detail
  shows the plan, trial / paid-through / grace dates and the recent **billing events**
  (webhooks) — never keys or payloads.

Use this to set the platform price, oversee every shop, and cut off a shop that misuses
the service.

---

## 10. Part I — Privacy & document retention

This is a deliberate design point, not an accident:

- **Customers never sign in.** A name is all that is collected; phone and note are optional.
- **Uploaded files live outside any web root** (`server/var/documents`), under random
  names. They are served to the agent only through an unguessable, single-document
  capability link — never listed, never served statically.
- **After a print is confirmed, the document is kept for 10 minutes, then deleted** —
  both the database row and the file on disk. The grace window lets the counter and the
  customer see "Printed" before it disappears. Change it with `PRINTED_RETENTION_MINUTES`
  in `server/.env` (default 10).
- **An upload nobody pays for is kept for a day, then deleted** (documents and files).
  The order row stays so the counter's owed totals remain honest. Change it with
  `UNPAID_RETENTION_HOURS` (default 24).
- **An upload that dies mid-request leaves no litter.** If any step refuses the order the
  staged files are removed immediately, and a hourly sweep deletes any staged file older
  than `ORPHAN_FILE_MINUTES` (default 60) that no document row claims.
- **Accounting survives the deletion.** Each order keeps `document_count`,
  `printed_documents`, `printed_sheets` and `completed_at`, so daily totals and the
  customer's "x of y printed" stay correct after the files are gone.
- **A late or repeated result is harmless.** Confirming the same print twice (or after
  the file was purged) never double-counts.
- **The agent never logs document content**, stages prints under random names, and
  deletes its temp copies. The device token is stored hashed at rest and under a locked
  `%PROGRAMDATA%` folder.

---

## 11. Testing without a printer

This machine has no physical printer, and that is fine for proving the plumbing.

- **The agent's own checks (no hardware):**
  ```bash
  cd "C:/Users/HP/Desktop/QrPrinter/agent"
  dotnet run --project tests/QrPrinter.Agent.Tests
  ```
  This is a custom console runner (no external test framework). It prints one line per
  check and exits non-zero on any failure. **50 checks** cover printer-name safety, job
  id/path traversal, the encryption rules (loopback-only cleartext), the status decoder,
  the snake_case wire contract, token-in-header-only, the SumatraPDF argument safety, and
  the service virtual-account SID.

- **A full bench print (bytes on the wire, still no paper):** `agent/tools/README.md`
  walks through a fake network printer on `127.0.0.1:9100`, a mock cloud, and the agent.
  It proves pairing, heartbeat, job push, download + SHA-256 check, refusal of virtual
  queues, SumatraPDF handing the job to the spooler, bytes leaving the machine, per-copy
  queue jobs, and the result reaching the server. **It does not prove paper comes out or
  that the page looks right** — the last mile is always one real printer in front of you.

- **The whole product, live, no hardware:** the server was exercised end to end against
  a throwaway database with a script that speaks the agent's exact wire protocol. See
  Part L for what passed.

- **The server's own repeatable suite:** `cd server && npm test` — 25 integration checks
  in a throwaway schema and temp upload directory, safe to run against the live database
  because it never touches it. See Part L.

---

## 12. Part J — Before you go live

The product works locally today. These are the honest gaps to close before a real shop
depends on it:

- **HTTPS.** Set `PUBLIC_BASE_URL=https://your-domain` and terminate TLS in front of the
  server. Remote agents refuse cleartext, and customers' phones should never send
  documents over plain HTTP. Re-print the QR after the address changes (the link is built
  from `PUBLIC_BASE_URL`).
- **Code signing + installer.** The agent exe is unsigned; SmartScreen will warn. Sign it
  and ship a proper installer. Signing is the critical path for trust. Never silence
  warnings by disabling AV or stripping the download mark.
- **Online payments (shop subscriptions).** Subscriptions are **built** — ₹299/month,
  14-day no-card trial, 3-day grace then lock — but stay switched off until you add
  Razorpay keys. In `server/.env` set `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and
  `RAZORPAY_WEBHOOK_SECRET`, then in the Razorpay dashboard point a webhook at
  `https://your-domain/api/billing/webhook` using that same secret. Entitlements come only
  from verified webhooks, never from the browser. These are the **platform's** keys (your
  subscription revenue), separate from each shop's print-payment keys below.
- **Online payments (customer prints).** Also **built**, and optional per shop. Each shop
  connects its **own** Razorpay account in **Settings → Online payments** (Part D); the
  customer's print money settles straight to that shop, never through the platform. The
  shop's Key Secret and webhook secret are stored **encrypted at rest**. The encryption
  key comes from `PAYMENTS_ENC_KEY` in `server/.env` (32 bytes: 64 hex chars or base64); if
  you do not set it, the server generates one once and keeps it in `server/var/payments.key`
  — **back that file up alongside the database**, or saved shop keys cannot be decrypted
  after a restore. Each shop adds a webhook at its own URL
  `https://your-domain/api/shop/<slug>/pay/webhook`, subscribed to `payment.captured` and
  `order.paid`. A print is marked paid only by that verified webhook. Until a shop connects
  its keys, its customers pay cash at the counter as before. In production
  (`NODE_ENV=production`) the server **refuses to boot** without `PAYMENTS_ENC_KEY` or an
  existing `server/var/payments.key`, because on an ephemeral host a generated key would
  be lost on the next deploy and every saved shop key with it. Subscribe the shop webhook
  to the refund and dispute events too (`refund.processed`, `payment.dispute.created`,
  `payment.dispute.lost`, `payment.dispute.won`): a refunded or disputed print is reversed
  and will not print, a won dispute restores it.
- **Backups.** Back up the PostgreSQL database and `server/var/documents` (the latter
  holds printed files inside their 10-minute window and unpaid uploads inside their
  24-hour one). Test a restore.
- **Hardening now in place:** rate limits on signup, both logins, pairing, uploads and
  payment starts; the public order status/pay endpoints take an unguessable token instead
  of the sequential `J-…` id (the id stays the counter reference); the health probe and
  every async route are wrapped, and an unhandled rejection shuts the server down cleanly
  instead of dying mid-request; refunds and disputes reverse a print; every payment
  transition is appended to `payment_log` with who did it.
  **Still open:** the live agent channel is single-process (fine for one server, needs a
  shared bus to scale out); real terms/privacy text and a code-signing certificate are
  owner actions, not code.
- **Production switches.** `NODE_ENV=production` binds `0.0.0.0`, requires an https
  `PUBLIC_BASE_URL` and a durable payments key, and warns if platform Razorpay keys are
  missing. Set `TRUST_PROXY=1` behind Railway's edge so rate limits see real customer IPs
  instead of the proxy's. `server/.env.example` lists every variable with its default.
- **Process supervision.** Run the server under a service manager (NSSM, systemd, a
  container orchestrator) so it restarts on failure, and keep PostgreSQL as a service.

---

## 13. Troubleshooting

| Symptom | Likely cause / fix |
| --- | --- |
| `bootstrap` fails to connect | PostgreSQL not running, or wrong superuser password. Check `pg_isready -p 5432`. |
| Server starts but pages 404 | You have not run `npm run build`, so `dist/` does not exist. Build, then reload. |
| Panel says "sign in" in a loop | The `qp_session` cookie is blocked. Use the same host you signed up on; check the browser allows cookies for it. |
| **Reported printers** empty | No agent paired, or its heartbeat has not arrived. Run `pair`, then `run`/service. Check `doctor`. |
| Device shows offline | The agent's websocket dropped. `service status`, then `service restart`. A job stuck "Printing" returns to the queue automatically after ~5 min if the agent stays offline. |
| Print button sends 0 | The order is **Unpaid** (mark Paid first), or that print type has **no printer assigned** in Settings. |
| Customer upload refused | Shop is **Closed** (Settings switch) or **deactivated** (admin). Open/reopen it, or ask the platform to activate it. |
| Panel shows "Account deactivated" | The platform deactivated this shop, so the admin is locked out. Only the platform can press **Activate** in `/admin/`; the shop cannot lift it itself. |
| Printing paused, red banner | The subscription lapsed (trial + grace over). Open **Billing** and subscribe, or ask the platform to comp the shop. |
| Subscribe button greyed out | No Razorpay keys on the server (`RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET`). See Part J. |
| No **Pay online** button on the customer page | The shop has not connected its Razorpay account (Settings → Online payments reads "Not set up"), or it was disconnected. Connect keys, or pay cash at the counter. |
| Customer paid online but badge stays "Pay at the counter" | Razorpay's webhook is not reaching the server. Check the shop's webhook URL, that the **Webhook secret** in Settings matches the one in Razorpay, and that `payment.captured` / `order.paid` are subscribed. Only the verified webhook marks an order paid. |
| Online-paid job missing from Prepaid | It is not paid yet (webhook not confirmed), or you are on **Cash printing** — online-paid jobs appear only under **Prepaid printing**. |
| Agent refuses the server address | It is cleartext HTTP to a non-loopback host. Use HTTPS, or test on `127.0.0.1`. |
| A print failed | The queue shows the reason (e.g. "out of paper"). Fix the printer, press **Retry**. |
| `service install` refuses | It must run from a copy in **Program Files**, in an **administrator** window. |
| Document vanished from the queue | Expected: printed documents are purged after 10 minutes. The order's totals remain. |

---

## 14. Part L — What was verified (and what was not)

Run against an **isolated throwaway PostgreSQL cluster** on port 55432 — the real
database on 5432 was never touched. The real server, real migrations, real HTTP and a
real agent websocket were driven end to end.

**Live product test — 97 / 97 assertions passed**, covering:
health probe · shop signup + session + duplicate/weak-password rejection · settings,
rates and printer assignment · pairing-code mint and **single-use burn** · agent
heartbeat · **token rejected in a query string** · websocket welcome · customer upload
**with no sign-in** · automatic page count and pricing (B&W and Colour) · **payment
gating server-side** · print dispatch over the websocket · **capability document fetch
with no auth header** + SHA-256 match · wrong-key 404 · printed results · order counters
and `completed_at` · **idempotent retry** · **10-minute grace, then purge of row + file**
· **totals survive the purge** · a late result after purge is harmless · failed print +
counter retry · **poll fallback when the agent is offline** · open/close enforcement
(closed upload creates no order) · superadmin login, **separate cookie**, overview and
shop-detail counts · **deactivate/reactivate** (uploads blocked), shop cannot lift it itself ·
**multi-tenant isolation** (no cross-shop jobs, pay, print or order lookup) · QR PNG/SVG
download · logout destroys both sessions.

**Subscription billing — 59 / 59 assertions passed** on an isolated cluster: trial →
active → grace → lapsed → reactivate → cancel, comp override, webhook signature
forgery / tamper / replay rejection, idempotency, period-never-backward, tenant isolation,
and upload / print gates returning 403 when lapsed while the panel stays reachable. The
Billing tab and the admin billing oversight were then driven in a real browser in **both
themes** across every state (trial, grace, lapsed, active, comped), including the lapse
banners, comp / un-comp and the webhook-populated event log.

**Superadmin controls — 22 / 22 assertions passed** on a separate isolated cluster: set the
subscription price (₹299 → ₹399) and have the overview reflect it · reject negative and
non-numeric prices · a price change clears the cached Razorpay plan id (so the next checkout
bills the new amount) while an unchanged price keeps it · **deactivate** cuts off an active
session (403 `account_deactivated`) and refuses login · the customer page shows unavailable
and uploads are blocked · a shop cookie is rejected on the admin endpoints · **activate**
restores login and the panel. The price editor, the deactivate/activate confirm, and the
panel's "Account deactivated" lock-out screen were then driven in a real browser in **both
themes**, including reactivation returning the shop to a normal dashboard.

**Customer online payments — 39 / 39 assertions passed** on a separate isolated cluster:
a shop saves its own Razorpay keys (secrets encrypted at rest, never echoed back) · the
customer page offers **Pay online** only when the shop is configured · paying creates (and
on repeat click reuses) a Razorpay order · a correctly-signed `payment.captured` webhook
marks the order **paid + online** · a replayed webhook is idempotent (`paid_at` never
re-stamped) · forged signatures and tampered bodies are rejected · `order.paid` after
capture is harmless · unknown orders are ignored · the dashboard online bucket and the
Prepaid tab pick the job up while cash stays in its own bucket · an unconfigured shop
cannot take online payment and its webhook fails closed · disconnect clears the keys and
hides the button. The Settings card (save, write-only secrets, shop webhook URL,
single-press disconnect confirm), the customer **Pay online** button, the live flip to
**Paid online**, and the Prepaid tab were then driven in a real browser in **both themes**.

**Agent unit checks — 50 / 50 passed.** **Frontend build — green** (all four entries).
**Server syntax — 29 files, 0 errors.**

**Server integration suite — 25 / 25 checks, repeatable any time.** `cd server && npm test`
provisions a throwaway schema (`qp_test_…`) in the same database plus a temp upload
directory, runs the real migrations and the real HTTP app against them, and drops both at
the end. The app role may create schemas but not databases, so no superuser password is
needed and live shops, orders and files are never read or written. It covers: the opaque
order token (sequential id refused, another shop's token refused) · payment gating ·
the counter payment log with its actor · two agents racing for one job getting exactly
one offer · the delivery-attempt cap, gave-up state and Retry · webhook amount-mismatch
rejection · signed webhook paid, replay, refund reversal and dispute restore · refused
uploads leaving no staged file · the capability document link · all three retention
sweeps (printed, abandoned, orphan) · the per-email login rate limit · the health probe.
The customer upload → status poll → counter reference flow was also driven in a real
browser against a rebuilt frontend, and graceful shutdown was proven with a live agent
websocket receiving close code 1001.

**Not proven here:** that physical paper comes out or that a page renders correctly on a
real device (no printer on this machine), duplex/colour/paper sizing against real
hardware, the Windows **service install** on a live shop PC (needs an elevated window),
and a **live Razorpay checkout** — neither the subscription checkout nor the customer's
print-payment popup was completed against real Razorpay (no real keys were used; payment
confirmations were simulated with correctly-signed test webhooks, exactly as Razorpay
would send them). The bench in `agent/tools/README.md` proves bytes-on-the-wire; a real
printer and a real Razorpay account are still the acceptance tests.

---

## 15. Quick reference

**Addresses (local):** panel `/panel/` · admin `/admin/` · customer `/s/<shop>` ·
health `/api/agent/health` · server `http://127.0.0.1:8787` · dev screens `http://localhost:5173`.

**Server** (`cd server`):
```bash
npm install
npm run bootstrap                 # role + db + .env + migrations (asks for PG password)
ADMIN_EMAIL=… ADMIN_PASSWORD=… npm run seed:admin
npm start                         # http://127.0.0.1:8787
npm run migrate                   # re-apply migrations after an update
```

**Screens** (repo root):
```bash
npm install && npm run build      # produces dist/, served by the server
npm run dev                       # optional live-reload on :5173
```

**Agent** (`agent/dist/QrPrinterAgent/QrPrinterAgent.exe`):
```bash
QrPrinterAgent version
QrPrinterAgent doctor
QrPrinterAgent printers
QrPrinterAgent pair <CODE> --api http://127.0.0.1:8787 --socket ws://127.0.0.1:8787/agent/channel
QrPrinterAgent run                # or: service install | status | restart | stop | uninstall
```

**Key settings** (`server/.env`): `DATABASE_URL`, `PORT` (8787), `HOST` (127.0.0.1),
`PUBLIC_BASE_URL` (https in production), `UPLOAD_DIR`, `SESSION_DAYS` (14),
`PAIRING_CODE_MINUTES` (30), `PRINTED_RETENTION_MINUTES` (10).
Payments: `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` / `RAZORPAY_WEBHOOK_SECRET` (the
platform's subscription keys, Part J) · `PAYMENTS_ENC_KEY` (optional; encrypts each shop's
saved print-payment keys — if unset, a key is auto-generated in `server/var/payments.key`).

**Data locations:** documents `server/var/documents` (purged 10 min after print) ·
payments key `server/var/payments.key` (back up with the database) ·
agent data + logs `%PROGRAMDATA%\QrPrinter Agent` · database `qrprinter` on PostgreSQL 5432.
import { useEffect, useState } from 'react'
import { Check, Copy, Download, KeyRound, Link2 } from 'lucide-react'
import { ActionButton } from '../components/PanelUi.jsx'
import OnlinePayments from '../components/OnlinePayments.jsx'
import PrinterConfig from '../components/PrinterConfig.jsx'
import PrintersView from './PrintersView.jsx'
import { money } from '../state/store.js'

/**
 * The shop's own words, rates, printers and its customer-facing link. Header and
 * rates save to the server as they are typed; the shop section controls whether
 * customers can upload, the permanent QR link, and pairing codes for the agent.
 */
export default function SettingsView({ panel }) {
  return (
    <div className="space-y-4">
      <PrinterConfig panel={panel} />

      <section aria-labelledby="reported-printers" className="space-y-3">
        <h2 id="reported-printers" className="text-sm font-bold tracking-wide text-muted uppercase">
          Reported printers
        </h2>
        <PrintersView panel={panel} />
      </section>

      <form className="max-w-2xl space-y-4" onSubmit={(event) => event.preventDefault()}
        onChange={(event) => {
          if (event.target.name === 'rateBw' || event.target.name === 'rateColor') {
            const parsed = Number(event.target.value)
            panel.patchSettings({ [event.target.name]: Number.isFinite(parsed) && parsed >= 0 ? parsed : 0 })
          }
        }}
      >
        <div className="rounded-card border border-line bg-surface p-5 shadow-card">
          <h2 className="text-sm font-bold tracking-wide text-muted uppercase">Counter header</h2>
          <div className="mt-4 space-y-4">
            <Field id="cafe-name" label="Cyber cafe name"
              hint="Shown at the top of every screen, to the person at the counter and to the customer.">
              <input id="cafe-name" name="cafeName" type="text" value={panel.settings.cafeName}
                onChange={(event) => panel.patchSettings({ cafeName: event.target.value })}
                maxLength={80} className={fieldClass} />
            </Field>
            <Field id="welcome" label="Welcome message"
              hint="One line under the name, also shown on the customer upload page.">
              <textarea id="welcome" name="welcomeMessage" rows={2} value={panel.settings.welcomeMessage}
                onChange={(event) => panel.patchSettings({ welcomeMessage: event.target.value })}
                maxLength={300} className={`${fieldClass} resize-y`} />
              <p className="mt-1 text-right text-xs text-muted">{panel.settings.welcomeMessage.length}/300</p>
            </Field>
          </div>
        </div>

        <div className="rounded-card border border-line bg-surface p-5 shadow-card">
          <h2 className="text-sm font-bold tracking-wide text-muted uppercase">Rates</h2>
          <p className="mt-1 text-sm text-muted">
            Rupees per page. A job costs pages × copies × the rate for its print type, and that is what
            every amount in the panel shows.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field id="rate-bw" label="B&W, per page"><RateInput name="rateBw" value={panel.settings.rateBw} /></Field>
            <Field id="rate-color" label="Colour, per page"><RateInput name="rateColor" value={panel.settings.rateColor} /></Field>
          </div>
          <p className="panel-numeric mt-4 text-sm text-body">
            So a 14-page colour job on one copy bills {money(14 * panel.settings.rateColor)}, and a 38-page
            B&amp;W job on two copies bills {money(38 * 2 * panel.settings.rateBw)}.
          </p>
        </div>
      </form>

      <ShopSection panel={panel} />

      <OnlinePayments panel={panel} />
    </div>
  )
}

/** Open/close, the permanent customer link + QR, and agent pairing codes. */
function ShopSection({ panel }) {
  const { shop } = panel
  const [copied, setCopied] = useState(false)
  const [pairing, setPairing] = useState(null)
  const [pairBusy, setPairBusy] = useState(false)
  const [pairError, setPairError] = useState('')

  const link = shop?.link || ''

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopied(false)
    }
  }

  const generate = async () => {
    setPairBusy(true)
    setPairError('')
    try {
      setPairing(await panel.createPairingCode())
    } catch (err) {
      setPairError(err.message)
    } finally {
      setPairBusy(false)
    }
  }

  return (
    <section aria-labelledby="shop-heading" className="max-w-2xl space-y-4">
      <div className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 id="shop-heading" className="text-sm font-bold tracking-wide text-muted uppercase">Shop status</h2>
        <div className="mt-3 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold text-ink">{shop?.is_open ? 'Open for uploads' : 'Closed'}</p>
            <p className="mt-0.5 text-xs text-muted">
              While closed, the customer page refuses new uploads. Existing orders are unaffected.
            </p>
          </div>
          <button
            type="button" role="switch" aria-checked={Boolean(shop?.is_open)}
            aria-label="Open or close the shop for customer uploads"
            onClick={() => panel.setOpen(!shop?.is_open)}
            className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors ${
              shop?.is_open ? 'bg-success' : 'bg-line-strong'
            }`}
          >
            <span className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
              shop?.is_open ? 'translate-x-6' : 'translate-x-1'
            }`} />
          </button>
        </div>
      </div>

      <div className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="text-sm font-bold tracking-wide text-muted uppercase">Customer link &amp; QR</h2>
        <p className="mt-1 text-sm text-muted">
          This link is permanent — print the QR once and it keeps working. Customers scan it, upload
          documents and pay at the counter. No account needed.
        </p>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-start">
          <img src={panel.qrPngUrl} alt="QR code linking to the customer upload page"
            width={140} height={140} className="rounded-field border border-line bg-white p-1" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Link2 size={15} className="shrink-0 text-muted" aria-hidden="true" />
              <input readOnly value={link} aria-label="Customer upload link"
                className="min-w-0 flex-1 rounded-field border border-line bg-canvas px-2.5 py-1.5 text-xs text-body" />
              <ActionButton onClick={copy} label="Copy customer link">
                <span className="inline-flex items-center gap-1.5">
                  {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
                  {copied ? 'Copied' : 'Copy'}
                </span>
              </ActionButton>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={panel.qrPngUrl} download="shop-qr.png"
                className="inline-flex items-center gap-1.5 rounded-field border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink hover:bg-soft">
                <Download size={13} aria-hidden="true" /> PNG
              </a>
              <a href={panel.qrSvgUrl} download="shop-qr.svg"
                className="inline-flex items-center gap-1.5 rounded-field border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink hover:bg-soft">
                <Download size={13} aria-hidden="true" /> SVG
              </a>
            </div>
          </div>
        </div>
      </div>

      <div className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 className="text-sm font-bold tracking-wide text-muted uppercase">Pair the local agent</h2>
        <p className="mt-1 text-sm text-muted">
          On the shop PC, download the agent, extract the zip and double-click
          <span className="font-semibold text-ink"> Install QrPrinter Agent</span>. It asks for a
          pairing code — generate one below and type it in. The code is single-use and expires.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <a href={panel.agentDownloadUrl} download="QrPrinterAgent.zip"
            className="inline-flex items-center gap-1.5 rounded-field border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-ink hover:bg-soft">
            <Download size={13} aria-hidden="true" /> Download agent
          </a>
          <ActionButton tone="primary" onClick={generate} disabled={pairBusy}>
            <span className="inline-flex items-center gap-1.5">
              <KeyRound size={13} aria-hidden="true" /> {pairBusy ? 'Generating…' : 'Generate pairing code'}
            </span>
          </ActionButton>
          {pairing ? (
            <span className="panel-numeric rounded-field bg-accent-soft px-3 py-1.5 text-lg font-bold tracking-widest text-accent-text">
              {pairing.code}
            </span>
          ) : null}
        </div>
        {pairing ? (
          <p className="mt-2 text-xs text-muted">
            Expires {new Date(pairing.expires_at).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}.
            Type this code into the installer on the shop PC.
          </p>
        ) : null}
        {pairError ? <p role="alert" className="mt-2 text-xs font-medium text-danger">{pairError}</p> : null}
      </div>
    </section>
  )
}

const fieldClass =
  'w-full rounded-field border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 hover:border-line-strong focus:border-accent-600 focus:bg-surface'

function Field({ id, label, hint, children }) {
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-semibold text-ink">{label}</label>
      {hint ? <p className="mt-0.5 mb-2 text-xs text-muted">{hint}</p> : <div className="mt-2" />}
      {children}
    </div>
  )
}

function RateInput({ name, value }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => {
    setDraft((current) => (Number(current) === value ? current : String(value)))
  }, [value])
  return (
    <div className="relative">
      <span aria-hidden="true" className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">₹</span>
      <input name={name} type="number" min="0" step="0.5" value={draft}
        onChange={(event) => setDraft(event.target.value)}
        className={`${fieldClass} panel-numeric pl-7`} />
    </div>
  )
}
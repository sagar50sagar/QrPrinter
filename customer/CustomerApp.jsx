import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle, CheckCircle2, CreditCard, FileText, Loader2, Store, Upload, X,
} from 'lucide-react'

const rupees = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', minimumFractionDigits: 0, maximumFractionDigits: 2,
})
const money = (value) => rupees.format(Number.isFinite(value) ? value : 0)

const slugFromPath = () => {
  const match = window.location.pathname.match(/\/s\/([^/]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

const ACCEPT = '.pdf,.png,.jpg,.jpeg,.webp'

// Razorpay's checkout script is loaded from its CDN on demand, only when a
// customer chooses to pay online. The order is marked paid by the server's
// verified webhook, never by this script's success callback.
const RAZORPAY_SRC = 'https://checkout.razorpay.com/v1/checkout.js'
let razorpayPromise = null
function loadRazorpay() {
  if (window.Razorpay) return Promise.resolve()
  if (!razorpayPromise) {
    razorpayPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script')
      script.src = RAZORPAY_SRC
      script.async = true
      script.onload = () => resolve()
      script.onerror = () => {
        razorpayPromise = null
        reject(new Error('Could not load the payment checkout. Check your connection and try again.'))
      }
      document.body.appendChild(script)
    })
  }
  return razorpayPromise
}

function printLabel(status) {
  return {
    pending: 'Waiting', queued: 'In queue', printing: 'Printing',
    printed: 'Printed', failed: 'Problem', rejected: 'Problem', uncertain: 'Checking',
  }[status] || status
}

function printTone(status) {
  if (status === 'printed') return 'bg-success-soft text-success'
  if (status === 'failed' || status === 'rejected') return 'bg-danger-soft text-danger'
  if (status === 'printing' || status === 'queued') return 'bg-accent-soft text-accent-text'
  return 'bg-soft text-muted'
}

export default function CustomerApp() {
  const slug = slugFromPath()
  const [shop, setShop] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [note, setNote] = useState('')
  const [files, setFiles] = useState([])
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')
  const [order, setOrder] = useState(null)
  const [paying, setPaying] = useState(false)
  const [payError, setPayError] = useState('')
  const [payNotice, setPayNotice] = useState('')
  const inputRef = useRef(null)
  const nextId = useRef(1)

  useEffect(() => {
    if (!slug) { setLoadError('This link is missing the shop address.'); return }
    let alive = true
    fetch(`/api/shop/${encodeURIComponent(slug)}`)
      .then(async (res) => {
        const body = await res.json().catch(() => ({}))
        if (!alive) return
        if (!res.ok) throw new Error(body.error || 'This shop link is not valid.')
        setShop(body)
      })
      .catch((error) => alive && setLoadError(error.message))
    return () => { alive = false }
  }, [slug])

  // Once an order exists, keep its payment and print status fresh.
  useEffect(() => {
    if (!order?.order_id) return undefined
    let alive = true
    const tick = () =>
      fetch(`/api/shop/${encodeURIComponent(slug)}/orders/${encodeURIComponent(order.order_id)}`)
        .then((res) => (res.ok ? res.json() : null))
        .then((body) => { if (alive && body?.ok) setOrder(body) })
        .catch(() => {})
    const timer = setInterval(tick, 4000)
    return () => { alive = false; clearInterval(timer) }
  }, [order?.order_id, slug])

  const addFiles = useCallback((list) => {
    const added = Array.from(list).map((file) => ({
      key: nextId.current++, file, copies: 1, mode: 'bw', duplex: false,
    }))
    setFiles((current) => [...current, ...added].slice(0, 20))
    if (inputRef.current) inputRef.current.value = ''
  }, [])

  const updateFile = (key, patch) =>
    setFiles((current) => current.map((f) => (f.key === key ? { ...f, ...patch } : f)))
  const removeFile = (key) => setFiles((current) => current.filter((f) => f.key !== key))

  const submit = async (event) => {
    event.preventDefault()
    setFormError('')
    if (!name.trim()) { setFormError('Please enter your name.'); return }
    if (files.length === 0) { setFormError('Add at least one document.'); return }
    setSubmitting(true)
    try {
      const data = new FormData()
      data.append('customer_name', name.trim())
      data.append('customer_phone', phone.trim())
      data.append('note', note.trim())
      data.append('items', JSON.stringify(files.map((f) => ({ copies: f.copies, mode: f.mode, duplex: f.duplex }))))
      for (const f of files) data.append('files', f.file, f.file.name)
      const res = await fetch(`/api/shop/${encodeURIComponent(slug)}/orders`, { method: 'POST', body: data })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 403) setShop((s) => (s ? { ...s, is_open: false } : s))
        throw new Error(body.error || 'The upload could not be completed.')
      }
      setOrder(body)
      setFiles([])
    } catch (error) {
      setFormError(error.message)
    } finally {
      setSubmitting(false)
    }
  }

  const payOnline = async () => {
    if (!order?.order_id) return
    setPaying(true); setPayError(''); setPayNotice('')
    try {
      const res = await fetch(`/api/shop/${encodeURIComponent(slug)}/orders/${encodeURIComponent(order.order_id)}/pay`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(body.error || 'The payment could not be started.')
      await loadRazorpay()
      const checkout = new window.Razorpay({
        key: body.key_id,
        order_id: body.rzp_order_id,
        amount: body.amount_paise,
        currency: body.currency || 'INR',
        name: shop?.name || 'Your cyber cafe',
        description: `Print order ${order.order_id}`,
        prefill: { name: order.customer_name || name, contact: phone },
        theme: { color: '#1566c8' },
        // Success only updates the message; the existing poll picks up the paid
        // state once the server's verified webhook confirms the money moved.
        handler: () => { setPayNotice('confirming'); setPaying(false) },
        modal: { ondismiss: () => { setPayNotice('cancelled'); setPaying(false) } },
      })
      checkout.on('payment.failed', (resp) => {
        setPayError(resp?.error?.description || 'The payment failed. Try again or pay at the counter.')
        setPaying(false)
      })
      checkout.open()
    } catch (error) {
      setPayError(error.message); setPaying(false)
    }
  }

  return (
    <div className="min-h-dvh bg-canvas text-body font-sans">
      <main className="mx-auto w-full max-w-md px-4 py-8 sm:py-12">
        <header className="mb-6 flex items-start gap-3">
          <span className="mt-0.5 flex h-11 w-11 shrink-0 items-center justify-center rounded-card bg-navy-900 text-white">
            <Store className="h-5 w-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-xl font-semibold text-ink">
              {shop ? shop.name : 'Upload documents'}
            </h1>
            {shop && (
              <p className={`mt-0.5 text-sm font-medium ${shop.is_open ? 'text-success' : 'text-danger'}`}>
                {shop.is_open ? 'Open — accepting uploads' : 'Closed right now'}
              </p>
            )}
          </div>
        </header>

        {loadError && (
          <Notice tone="danger" icon={<AlertCircle className="h-5 w-5" />} title="We could not open this shop">
            {loadError}
          </Notice>
        )}

        {!loadError && !shop && (
          <div className="flex items-center gap-2 text-muted" role="status">
            <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> Loading shop…
          </div>
        )}

        {shop && !shop.is_open && !order && (
          <Notice tone="warn" icon={<AlertCircle className="h-5 w-5" />} title="This shop is closed">
            {shop.welcome_message || 'Uploads are paused while the shop is closed. Please come back later.'}
          </Notice>
        )}

        {shop && shop.is_open && !order && (
          <form onSubmit={submit} className="space-y-5" noValidate>
            {shop.welcome_message && (
              <p className="rounded-card bg-surface p-3 text-sm text-body shadow-card">{shop.welcome_message}</p>
            )}

            <Field label="Your name" required>
              <input
                type="text" value={name} onChange={(e) => setName(e.target.value)}
                autoComplete="name" maxLength={80} required
                className="w-full rounded-field border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-200"
                placeholder="e.g. Priya Sharma"
              />
            </Field>

            <Field label="Phone (optional)">
              <input
                type="tel" value={phone} onChange={(e) => setPhone(e.target.value)}
                autoComplete="tel" maxLength={24}
                className="w-full rounded-field border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-200"
                placeholder="So the counter can call you"
              />
            </Field>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-ink">Documents</span>
                <span className="text-xs text-muted">PDF or image · up to 20</span>
              </div>
              <label className="flex cursor-pointer flex-col items-center gap-2 rounded-card border-2 border-dashed border-line-strong bg-surface px-4 py-6 text-center hover:border-accent-400">
                <Upload className="h-6 w-6 text-accent-600" aria-hidden="true" />
                <span className="text-sm font-medium text-ink">Tap to choose files</span>
                <span className="text-xs text-muted">Each file can have its own copies and colour setting</span>
                <input
                  ref={inputRef} type="file" accept={ACCEPT} multiple className="sr-only"
                  onChange={(e) => addFiles(e.target.files)}
                />
              </label>

              <ul className="mt-3 space-y-3">
                {files.map((f) => (
                  <li key={f.key} className="rounded-card border border-line bg-surface p-3 shadow-card">
                    <div className="flex items-start gap-2">
                      <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-ink">{f.file.name}</p>
                        <p className="text-xs text-muted">{(f.file.size / 1024 / 1024).toFixed(2)} MB</p>
                      </div>
                      <button
                        type="button" onClick={() => removeFile(f.key)}
                        aria-label={`Remove ${f.file.name}`}
                        className="rounded-field p-1 text-muted hover:bg-soft hover:text-danger"
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <label className="text-xs font-medium text-muted">
                        Copies
                        <input
                          type="number" min={1} max={500} value={f.copies}
                          onChange={(e) => updateFile(f.key, { copies: Math.max(1, Math.min(500, Number(e.target.value) || 1)) })}
                          className="mt-1 w-full rounded-field border border-line bg-canvas px-2 py-1.5 text-sm text-ink outline-none focus:border-accent-500"
                        />
                      </label>
                      <label className="text-xs font-medium text-muted">
                        Print type
                        <select
                          value={f.mode} onChange={(e) => updateFile(f.key, { mode: e.target.value })}
                          className="mt-1 w-full rounded-field border border-line bg-canvas px-2 py-1.5 text-sm text-ink outline-none focus:border-accent-500"
                        >
                          <option value="bw">B&amp;W</option>
                          <option value="color">Colour</option>
                        </select>
                      </label>
                    </div>
                    <label className="mt-2 flex items-center gap-2 text-xs font-medium text-muted">
                      <input
                        type="checkbox" checked={f.duplex}
                        onChange={(e) => updateFile(f.key, { duplex: e.target.checked })}
                        className="h-4 w-4 rounded border-line text-accent-600 focus:ring-accent-300"
                      />
                      Double-sided (duplex)
                    </label>
                  </li>
                ))}
              </ul>
            </div>

            <Field label="Note for the counter (optional)">
              <textarea
                value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} rows={2}
                className="w-full rounded-field border border-line bg-surface px-3 py-2 text-ink outline-none focus:border-accent-500 focus:ring-2 focus:ring-accent-200"
                placeholder="e.g. print the first page in colour"
              />
            </Field>

            <p className="text-xs text-muted">
              B&amp;W {money(shop.price_bw)}/page · Colour {money(shop.price_color)}/page. Pages are counted
              automatically and the final amount is confirmed after upload.
            </p>

            {formError && (
              <p role="alert" className="rounded-field bg-danger-soft px-3 py-2 text-sm text-danger">{formError}</p>
            )}

            <button
              type="submit" disabled={submitting}
              className="flex w-full items-center justify-center gap-2 rounded-field bg-accent-600 px-4 py-3 font-semibold text-white shadow-lift hover:bg-accent-700 disabled:opacity-60"
            >
              {submitting ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Upload className="h-5 w-5" aria-hidden="true" />}
              {submitting ? 'Uploading…' : `Upload ${files.length || ''} document${files.length === 1 ? '' : 's'}`}
            </button>
          </form>
        )}

        {order && (
          <section className="space-y-4" aria-live="polite">
            <div className="rounded-panel border border-line bg-surface p-5 text-center shadow-card">
              <CheckCircle2 className="mx-auto h-10 w-10 text-success" aria-hidden="true" />
              <h2 className="mt-2 text-lg font-semibold text-ink">Upload received</h2>
              <p className="mt-1 text-sm text-muted">Show this order number at the counter.</p>
              <p className="mt-3 font-mono text-3xl font-bold tracking-wide text-ink">{order.order_id}</p>
              <p className="mt-2 text-2xl font-semibold text-ink">{money(order.amount)}</p>
              <span className={`mt-3 inline-block rounded-full px-3 py-1 text-sm font-medium ${order.status === 'paid' ? 'bg-success-soft text-success' : 'bg-warn-soft text-warn'}`}>
                {order.status === 'paid' ? (order.method === 'online' ? 'Paid online' : 'Paid') : 'Pay at the counter'}
              </span>
            </div>

            {order.status !== 'paid' && shop?.online_payments && (
              <div className="rounded-card border border-line bg-surface p-4 shadow-card">
                <button
                  type="button" onClick={payOnline} disabled={paying || payNotice === 'confirming'}
                  className="flex w-full items-center justify-center gap-2 rounded-field bg-accent-600 px-4 py-3 font-semibold text-white shadow-lift hover:bg-accent-700 disabled:opacity-60"
                >
                  {paying ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <CreditCard className="h-5 w-5" aria-hidden="true" />}
                  {paying ? 'Opening checkout…' : `Pay online ${money(order.amount)}`}
                </button>
                <p className="mt-2 text-center text-xs text-muted">UPI or card, secured by Razorpay. Or pay cash at the counter.</p>
                {payNotice === 'confirming' && (
                  <p role="status" className="mt-2 rounded-field bg-success-soft px-3 py-2 text-center text-sm text-success">Payment received — confirming…</p>
                )}
                {payNotice === 'cancelled' && (
                  <p role="status" className="mt-2 rounded-field bg-warn-soft px-3 py-2 text-center text-sm text-warn">Payment cancelled. Try again or pay at the counter.</p>
                )}
                {payError && (
                  <p role="alert" className="mt-2 rounded-field bg-danger-soft px-3 py-2 text-center text-sm text-danger">{payError}</p>
                )}
              </div>
            )}

            {order.document_count > 0 && (
              <p className="text-center text-sm font-medium text-muted">
                {order.printed_documents} of {order.document_count} printed
                {order.printed_documents >= order.document_count ? ' — ready to collect' : ''}
              </p>
            )}

            <ul className="space-y-2">
              {(order.documents || []).map((doc) => (
                <li key={doc.id} className="flex items-center gap-3 rounded-card border border-line bg-surface p-3 shadow-card">
                  <FileText className="h-5 w-5 shrink-0 text-muted" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{doc.file}</p>
                    <p className="text-xs text-muted">{doc.id} · {doc.copies} cop{doc.copies === 1 ? 'y' : 'ies'} · {doc.mode === 'color' ? 'Colour' : 'B&W'}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-medium ${printTone(doc.print_status)}`}>
                    {printLabel(doc.print_status)}
                  </span>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() => { setOrder(null); setName(''); setPhone(''); setNote(''); setPayError(''); setPayNotice(''); setPaying(false) }}
              className="w-full rounded-field border border-line bg-surface px-4 py-2.5 font-medium text-ink hover:bg-soft"
            >
              Upload more documents
            </button>
          </section>
        )}

        <footer className="mt-10 text-center text-xs text-muted">
          Powered by {shop?.name || 'your cyber cafe'}
        </footer>
      </main>
    </div>
  )
}

function Field({ label, required, children }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-medium text-ink">
        {label}{required && <span className="text-danger"> *</span>}
      </span>
      {children}
    </label>
  )
}

function Notice({ tone, icon, title, children }) {
  const tones = {
    danger: 'border-danger/30 bg-danger-soft text-danger',
    warn: 'border-warn/30 bg-warn-soft text-warn',
  }
  return (
    <div role="alert" className={`rounded-card border p-4 shadow-card ${tones[tone] || tones.warn}`}>
      <div className="flex items-center gap-2 font-semibold">{icon}<span>{title}</span></div>
      <p className="mt-1 text-sm opacity-90">{children}</p>
    </div>
  )
}
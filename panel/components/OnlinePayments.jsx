import { useEffect, useState } from 'react'
import { AlertCircle, Check, Copy, CreditCard, Loader2, Trash2 } from 'lucide-react'
import { ActionButton } from './PanelUi.jsx'

const fieldClass =
  'w-full rounded-field border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 hover:border-line-strong focus:border-accent-600 focus:bg-surface'

/**
 * The shop connects its own Razorpay account so customers can pay online (UPI /
 * card) and the money settles straight to the shop. Secrets are write-only: the
 * server reports whether they are set, never their value. Optional — cash at the
 * counter keeps working regardless.
 */
export default function OnlinePayments({ panel }) {
  const state = panel.onlinePayments
  const [keyId, setKeyId] = useState('')
  const [keySecret, setKeySecret] = useState('')
  const [webhookSecret, setWebhookSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)

  const load = panel.loadOnlinePayments
  useEffect(() => { load().catch((err) => setError(err.message)) }, [load])
  useEffect(() => { if (state) setKeyId(state.key_id || '') }, [state?.key_id])

  const configured = Boolean(state?.configured)
  const webhookUrl = state?.webhook_url || ''

  const save = async () => {
    setBusy(true); setError(''); setSaved(false)
    try {
      await panel.saveOnlinePayments({ keyId: keyId.trim(), keySecret: keySecret.trim(), webhookSecret: webhookSecret.trim() })
      setKeySecret(''); setWebhookSecret('')
      setSaved(true); setTimeout(() => setSaved(false), 1500)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const disconnect = async () => {
    setBusy(true); setError('')
    try {
      await panel.removeOnlinePayments()
      setKeyId(''); setKeySecret(''); setWebhookSecret(''); setConfirming(false)
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const copy = async () => {
    try { await navigator.clipboard.writeText(webhookUrl); setCopied(true); setTimeout(() => setCopied(false), 1500) }
    catch { setCopied(false) }
  }

  return (
    <section aria-labelledby="online-payments-heading" className="max-w-2xl space-y-4">
      <div className="rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="flex items-center justify-between gap-3">
          <h2 id="online-payments-heading" className="text-sm font-bold tracking-wide text-muted uppercase">Online payments</h2>
          <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${configured ? 'bg-success-soft text-success' : 'bg-soft text-muted'}`}>
            {configured ? 'On' : 'Not set up'}
          </span>
        </div>
        <p className="mt-1 text-sm text-muted">
          Let customers pay for their prints online with UPI or card, straight into your own Razorpay
          account. Optional — customers can still pay cash at the counter. Online-paid orders arrive in
          the <strong className="font-semibold text-body">Prepaid</strong> tab, ready to print.
        </p>

        <div className="mt-4 space-y-4">
          <div>
            <label htmlFor="rzp-key-id" className="block text-sm font-semibold text-ink">Razorpay Key ID</label>
            <p className="mt-0.5 mb-2 text-xs text-muted">From your Razorpay dashboard → Settings → API Keys. Starts with rzp_test_ or rzp_live_.</p>
            <input id="rzp-key-id" type="text" value={keyId} onChange={(e) => setKeyId(e.target.value)}
              maxLength={60} placeholder="rzp_live_XXXXXXXXXXXX" className={fieldClass} autoComplete="off" spellCheck="false" />
          </div>
          <div>
            <label htmlFor="rzp-key-secret" className="block text-sm font-semibold text-ink">Razorpay Key Secret</label>
            <p className="mt-0.5 mb-2 text-xs text-muted">Stored encrypted, never shown again. Leave blank to keep the saved one.</p>
            <input id="rzp-key-secret" type="password" value={keySecret} onChange={(e) => setKeySecret(e.target.value)}
              maxLength={200} placeholder={state?.has_secret ? '•••••••• saved' : 'Key secret'} className={fieldClass} autoComplete="new-password" />
          </div>
          <div>
            <label htmlFor="rzp-webhook-secret" className="block text-sm font-semibold text-ink">Webhook secret</label>
            <p className="mt-0.5 mb-2 text-xs text-muted">You choose this when adding the webhook in Razorpay. It proves a payment really came from Razorpay.</p>
            <input id="rzp-webhook-secret" type="password" value={webhookSecret} onChange={(e) => setWebhookSecret(e.target.value)}
              maxLength={200} placeholder={state?.has_webhook_secret ? '•••••••• saved' : 'Webhook secret'} className={fieldClass} autoComplete="new-password" />
          </div>
        </div>

        {configured && !state?.has_webhook_secret && (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-field bg-warn-soft px-3 py-2 text-sm text-warn">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
            Add the webhook secret and create the webhook below, otherwise online payments cannot be confirmed.
          </p>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <ActionButton tone="primary" onClick={save} disabled={busy} label="Save online payment keys">
            <span className="inline-flex items-center gap-1.5">
              {busy ? <Loader2 size={13} className="animate-spin" aria-hidden="true" /> : <CreditCard size={13} aria-hidden="true" />}
              {busy ? 'Saving…' : 'Save'}
            </span>
          </ActionButton>
          {saved && <span className="inline-flex items-center gap-1 text-sm font-medium text-success"><Check size={14} aria-hidden="true" /> Saved</span>}
          {(configured || state?.has_secret) && !confirming && (
            <ActionButton tone="danger" onClick={() => setConfirming(true)} disabled={busy} label="Disconnect online payments">
              <span className="inline-flex items-center gap-1.5"><Trash2 size={13} aria-hidden="true" /> Disconnect</span>
            </ActionButton>
          )}
        </div>

        {confirming && (
          <div role="alert" className="mt-3 rounded-field border border-danger/30 bg-danger-soft p-3">
            <p className="text-sm font-medium text-danger">
              Disconnect online payments? Customers will only be able to pay at the counter, and your saved keys are removed.
            </p>
            <div className="mt-2 flex gap-2">
              <ActionButton tone="danger" onClick={disconnect} disabled={busy} label="Confirm disconnect">
                {busy ? 'Removing…' : 'Confirm disconnect'}
              </ActionButton>
              <ActionButton onClick={() => setConfirming(false)} disabled={busy} label="Cancel disconnect">Cancel</ActionButton>
            </div>
          </div>
        )}

        {error && <p role="alert" className="mt-3 rounded-field bg-danger-soft px-3 py-2 text-sm text-danger">{error}</p>}
      </div>

      <div className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h3 className="text-sm font-bold tracking-wide text-muted uppercase">Finish setup in Razorpay</h3>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-body">
          <li>Create a Razorpay account for your shop and complete its KYC.</li>
          <li>Copy the Key ID and Key Secret from Settings → API Keys into the fields above.</li>
          <li>In Razorpay → Settings → Webhooks, add a webhook with the URL below, choose a secret, and paste that same secret above.</li>
          <li>Subscribe the webhook to the <strong className="font-semibold">payment.captured</strong> and <strong className="font-semibold">order.paid</strong> events.</li>
        </ol>
        <div className="mt-3 flex items-center gap-2">
          <input readOnly value={webhookUrl} aria-label="Payment webhook URL"
            className="min-w-0 flex-1 rounded-field border border-line bg-canvas px-2.5 py-1.5 text-xs text-body" />
          <ActionButton onClick={copy} label="Copy webhook URL">
            <span className="inline-flex items-center gap-1.5">
              {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
              {copied ? 'Copied' : 'Copy'}
            </span>
          </ActionButton>
        </div>
        <p className="mt-2 text-xs text-muted">
          A print is marked paid only after Razorpay confirms the money through this webhook — never from
          the customer's browser.
        </p>
      </div>
    </section>
  )
}
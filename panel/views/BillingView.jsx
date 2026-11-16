import { useEffect, useState } from 'react'
import { CalendarClock, CircleAlert, CreditCard, ExternalLink, ShieldCheck } from 'lucide-react'
import { ActionButton, BillingBadge } from '../components/PanelUi.jsx'
import { money } from '../state/store.js'

const fmtDate = (iso) =>
  iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

/**
 * The shop's subscription: plan, live status, and subscribe / cancel. Access is
 * granted only by Razorpay's webhook, so subscribing opens a hosted checkout and
 * the status here updates on its own once payment is confirmed.
 */
export default function BillingView({ panel }) {
  const { billing, billingPlan, razorpayConfigured, loadBilling, subscribe, cancelSubscription } = panel
  const [loaded, setLoaded] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [checkoutUrl, setCheckoutUrl] = useState('')
  const [confirmCancel, setConfirmCancel] = useState(false)

  useEffect(() => {
    let alive = true
    loadBilling()
      .catch((err) => { if (alive) setError(err.message) })
      .finally(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [loadBilling])

  const state = billing?.state || 'none'
  const comped = Boolean(billing?.comped)
  const subStatus = billing?.subscription_status || 'none'
  const canSubscribe = !comped && !['created', 'authenticated', 'active'].includes(subStatus)
  const canCancel = ['created', 'authenticated', 'active', 'halted', 'paused'].includes(subStatus)
  const price = billingPlan ? money(billingPlan.amount_paise / 100) : money(299)
  const per = billingPlan?.period === 'yearly' ? 'year' : 'month'

  const startCheckout = async () => {
    setBusy(true); setError(''); setCheckoutUrl('')
    try {
      const data = await subscribe()
      if (data.short_url) {
        setCheckoutUrl(data.short_url)
        window.open(data.short_url, '_blank', 'noopener')
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const doCancel = async () => {
    setBusy(true); setError('')
    try {
      await cancelSubscription()
      setConfirmCancel(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <section aria-labelledby="plan-heading" className="rounded-card border border-line bg-surface p-5 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="plan-heading" className="text-sm font-bold tracking-wide text-muted uppercase">Subscription</h2>
            <p className="mt-1 text-lg font-bold text-ink">{billingPlan?.name || 'QrPrinter Monthly'}</p>
            <p className="panel-numeric mt-0.5 text-sm text-body">
              {price} <span className="text-muted">/ {per}</span>
            </p>
          </div>
          <BillingBadge state={state} />
        </div>

        <div className="mt-4 flex items-start gap-2 rounded-field bg-canvas px-3 py-2.5 text-sm text-body">
          <CalendarClock size={16} strokeWidth={1.9} aria-hidden="true" className="mt-0.5 shrink-0 text-muted" />
          <StatusLine billing={billing} state={state} subStatus={subStatus} />
        </div>
      </section>

      <section aria-labelledby="actions-heading" className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 id="actions-heading" className="text-sm font-bold tracking-wide text-muted uppercase">Manage</h2>

        {comped ? (
          <p className="mt-3 flex items-start gap-2 text-sm text-body">
            <ShieldCheck size={16} strokeWidth={1.9} aria-hidden="true" className="mt-0.5 shrink-0 text-accent-text" />
            This shop is comped — full access with no subscription needed. The platform manages this.
          </p>
        ) : (
          <div className="mt-3 space-y-3">
            {loaded && !razorpayConfigured ? (
              <p role="status" className="flex items-start gap-2 rounded-field bg-warn-soft px-3 py-2.5 text-sm font-medium text-warn">
                <CircleAlert size={16} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0" />
                Online payments aren’t set up on this server yet. Contact the platform owner to enable subscriptions.
              </p>
            ) : null}

            {subStatus === 'created' ? (
              <p className="text-sm text-muted">
                Checkout was started but not finished. Complete payment in Razorpay, or cancel and start again.
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {canSubscribe ? (
                <ActionButton tone="primary" onClick={startCheckout} disabled={busy || !razorpayConfigured}
                  label={`Subscribe for ${price} per ${per}`}>
                  <span className="inline-flex items-center gap-1.5">
                    <CreditCard size={14} strokeWidth={2} aria-hidden="true" />
                    {busy ? 'Opening checkout…' : `Subscribe — ${price}/${per}`}
                  </span>
                </ActionButton>
              ) : null}

              {canCancel && razorpayConfigured ? (
                confirmCancel ? (
                  <span className="inline-flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-danger">
                      Cancel at period end? Access continues until {fmtDate(billing?.period_end)}, then printing pauses.
                    </span>
                    <ActionButton tone="danger" onClick={doCancel} disabled={busy} label="Confirm cancellation">
                      {busy ? 'Cancelling…' : 'Confirm cancel'}
                    </ActionButton>
                    <ActionButton onClick={() => setConfirmCancel(false)} disabled={busy}>Keep</ActionButton>
                  </span>
                ) : (
                  <ActionButton tone="danger" onClick={() => setConfirmCancel(true)} disabled={busy} label="Cancel subscription">
                    Cancel subscription
                  </ActionButton>
                )
              ) : null}
            </div>

            {checkoutUrl ? (
              <div className="rounded-field border border-line bg-canvas px-3 py-2.5">
                <a href={checkoutUrl} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-accent-text hover:underline">
                  <ExternalLink size={14} strokeWidth={2} aria-hidden="true" />
                  Open Razorpay checkout
                </a>
                <p className="mt-1 text-xs text-muted">
                  Finish payment in the Razorpay window. This page activates automatically once payment is confirmed —
                  no need to refresh.
                </p>
              </div>
            ) : null}

            {error ? <p role="alert" className="text-sm font-medium text-danger">{error}</p> : null}
          </div>
        )}
      </section>

      <section aria-labelledby="how-heading" className="rounded-card border border-line bg-surface p-5 shadow-card">
        <h2 id="how-heading" className="text-sm font-bold tracking-wide text-muted uppercase">How billing works</h2>
        <ul className="mt-3 space-y-1.5 text-sm text-body">
          <li>Every new shop starts on a free trial — no card needed.</li>
          <li>Subscribe to keep printing after the trial. Payment is handled by Razorpay.</li>
          <li>If a payment lapses, a short grace period runs before printing and customer uploads pause.</li>
          <li>Cancelling keeps access through the period you already paid for; nothing is deleted.</li>
        </ul>
      </section>
    </div>
  )
}

function StatusLine({ billing, state, subStatus }) {
  if (!billing) return <span>Loading subscription…</span>
  const days = billing.days_left
  switch (state) {
    case 'comped':
      return <span>Comped by the platform — full access, no subscription required.</span>
    case 'active':
      return (
        <span>
          {subStatus === 'cancelled' ? 'Cancels at period end — paid through ' : 'Paid through '}
          <strong className="font-semibold text-ink">{fmtDate(billing.period_end)}</strong>
          {days != null ? ` · ${days} day${days === 1 ? '' : 's'} left` : ''}
        </span>
      )
    case 'trial':
      return (
        <span>
          Free trial — <strong className="font-semibold text-ink">{billing.trial_days_left} day{billing.trial_days_left === 1 ? '' : 's'} left</strong>,
          ends {fmtDate(billing.trial_ends_at)}. Subscribe to keep printing after that.
        </span>
      )
    case 'grace':
      return (
        <span>
          Subscription expired — <strong className="font-semibold text-ink">{days} grace day{days === 1 ? '' : 's'} left</strong>
          {billing.grace_ends_at ? ` (until ${fmtDate(billing.grace_ends_at)})` : ''}. Renew to avoid a pause.
        </span>
      )
    case 'lapsed':
      return <span>No active subscription. Printing and customer uploads are paused — subscribe to resume.</span>
    default:
      return <span>No active subscription yet. Subscribe to start printing.</span>
  }
}
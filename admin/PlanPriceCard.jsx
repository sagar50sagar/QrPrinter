import { useEffect, useState } from 'react'
import { Check, CreditCard, Save } from 'lucide-react'
import { ActionButton } from '../panel/components/PanelUi.jsx'
import { money } from '../panel/state/store.js'

const fieldClass =
  'w-full rounded-field border border-line bg-canvas px-3 py-2 text-sm text-ink outline-none transition-colors duration-150 hover:border-line-strong focus:border-accent-600 focus:bg-surface'

/**
 * The platform subscription price every shop pays. Superadmin-only. A change
 * applies to new subscriptions; existing subscribers keep their current price
 * until they re-subscribe, because Razorpay plans are immutable in amount.
 */
export default function PlanPriceCard({ plan, onSave }) {
  const current = plan ? plan.amount_paise / 100 : 0
  const [amount, setAmount] = useState(String(current))
  const [name, setName] = useState(plan?.name || '')
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setAmount(String(plan ? plan.amount_paise / 100 : 0))
    setName(plan?.name || '')
  }, [plan?.id, plan?.amount_paise, plan?.name])

  const per = plan?.period === 'yearly' ? 'year' : 'month'
  const dirty = Number(amount) !== current || name !== (plan?.name || '')
  const valid = amount !== '' && Number.isFinite(Number(amount)) && Number(amount) >= 0

  const save = async () => {
    setBusy(true)
    setSaved(false)
    const result = await onSave(Number(amount), name)
    setBusy(false)
    if (result) {
      setSaved(true)
      setTimeout(() => setSaved(false), 1500)
    }
  }

  return (
    <div className="rounded-card border border-line bg-surface p-5 shadow-card">
      <h2 className="flex items-center gap-1.5 text-sm font-bold tracking-wide text-muted uppercase">
        <CreditCard size={14} strokeWidth={2} aria-hidden="true" /> Subscription plan
      </h2>
      <p className="mt-2 text-sm text-body">
        <span className="font-semibold text-ink">{plan?.name || 'QrPrinter Monthly'}</span>
        {' — '}
        <span className="panel-numeric font-semibold text-ink">{money(current)}</span>
        <span className="text-muted"> / {per}</span>
      </p>
      <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink">Price per {per} (₹)</span>
          <div className="relative">
            <span aria-hidden="true" className="absolute top-1/2 left-3 -translate-y-1/2 text-sm text-muted">₹</span>
            <input
              type="number" min="0" step="1" value={amount}
              onChange={(event) => setAmount(event.target.value)}
              aria-label={`Subscription price per ${per} in rupees`}
              className={`${fieldClass} panel-numeric pl-7`}
            />
          </div>
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink">Plan name</span>
          <input
            type="text" value={name} maxLength={80}
            onChange={(event) => setName(event.target.value)}
            aria-label="Plan name" className={fieldClass}
          />
        </label>
        <ActionButton tone="primary" disabled={busy || !dirty || !valid} onClick={save} label="Save subscription price">
          <span className="inline-flex items-center gap-1.5">
            {saved ? <Check size={13} strokeWidth={2} aria-hidden="true" /> : <Save size={13} strokeWidth={2} aria-hidden="true" />}
            {busy ? 'Saving…' : saved ? 'Saved' : 'Save'}
          </span>
        </ActionButton>
      </div>
      <p className="mt-3 text-xs text-muted">
        Applies to new subscriptions. Existing subscribers keep their current price until they re-subscribe.
      </p>
    </div>
  )
}
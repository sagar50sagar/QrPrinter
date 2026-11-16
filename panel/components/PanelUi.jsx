/**
 * The handful of shapes the panel reuses. Kept here rather than in
 * src/components/ui so the counter does not inherit marketing decisions.
 */

export function StatCard({ icon: Glyph, label, value, hint, tone = 'neutral' }) {
  const tones = {
    neutral: 'text-accent-text bg-accent-soft',
    success: 'text-success bg-success-soft',
    warn: 'text-warn bg-warn-soft',
  }

  return (
    <div className="flex items-start gap-2.5 rounded-card border border-line bg-surface p-3 shadow-card md:gap-3 md:p-4">
      <span
        aria-hidden="true"
        className={`inline-flex size-8 shrink-0 items-center justify-center rounded-field md:size-9 ${tones[tone]}`}
      >
        <Glyph size={17} strokeWidth={1.9} />
      </span>
      <div className="min-w-0">
        <p className="text-[11px] font-semibold tracking-wide text-muted uppercase md:text-xs">{label}</p>
        <p className="panel-numeric mt-0.5 text-base font-bold text-ink md:text-xl">{value}</p>
        {hint ? <p className="mt-0.5 text-[11px] text-muted md:text-xs">{hint}</p> : null}
      </div>
    </div>
  )
}

/**
 * A filter row. It is a real radio group, not a row of buttons, because the
 * choices are mutually exclusive and a counter operator needs to know that.
 */
export function FilterGroup({ legend, name, value, onChange, options }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">
        {legend}
      </legend>
      <div className="flex flex-wrap gap-1.5">
        {options.map((option) => {
          const selected = option.value === value
          return (
            <label
              key={option.value}
              className={`inline-flex cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors duration-150 ${
                selected
                  ? 'border-accent-600 bg-accent-600 text-white'
                  : 'border-line bg-surface text-body hover:border-line-strong hover:bg-soft'
              }`}
            >
              <input
                type="radio"
                name={name}
                value={option.value}
                checked={selected}
                onChange={() => onChange(option.value)}
                className="sr-only"
              />
              {option.label}
              {option.count !== undefined ? (
                <span
                  className={`panel-numeric rounded-full px-1.5 text-xs font-semibold ${
                    selected ? 'bg-white/20' : 'bg-soft text-muted'
                  }`}
                >
                  {option.count}
                </span>
              ) : null}
            </label>
          )
        })}
      </div>
    </fieldset>
  )
}

export function ActionButton({ children, onClick, disabled, tone = 'default', label }) {
  const tones = {
    default: 'border-line bg-surface text-ink hover:bg-soft',
    primary: 'border-accent-600 bg-accent-600 text-white hover:bg-accent-700',
    danger: 'border-danger/40 bg-danger-soft text-danger hover:bg-danger/15',
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className={`rounded-field border px-3 py-1.5 text-sm font-semibold transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-45 ${tones[tone]} ${
        disabled ? '' : 'focus-visible:outline-2'
      }`}
    >
      {children}
    </button>
  )
}

/** The counter's payment decision: a dropdown that moves the job between the Paid and Unpaid lists. */
export function PaymentSelect({ paid, onChange, label }) {
  return (
    <select
      value={paid ? 'paid' : 'unpaid'}
      onChange={(event) => onChange(event.target.value === 'paid')}
      aria-label={label}
      className={`rounded-field border px-2 py-1 text-xs font-semibold ${
        paid
          ? 'border-success/30 bg-success-soft text-success hover:border-success'
          : 'border-warn/30 bg-warn-soft text-warn hover:border-warn'
      }`}
    >
      <option value="unpaid">Unpaid</option>
      <option value="paid">Paid</option>
    </select>
  )
}

const queueTones = {
  pending: 'bg-soft text-soft-ink ring-line-strong/60',
  printing: 'bg-accent-soft text-accent-text ring-accent-300/40',
  success: 'bg-success-soft text-success ring-success/25',
  failed: 'bg-danger-soft text-danger ring-danger/25',
}

const queueLabels = { pending: 'Pending', printing: 'Printing', success: 'Success', failed: 'Failed' }

export function QueueStatusBadge({ status }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${queueTones[status] ?? queueTones.pending}`}
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full bg-current ${status === 'printing' ? 'animate-pulse' : ''}`} />
      {queueLabels[status] ?? status}
    </span>
  )
}

export function EmptyState({ title, note }) {
  return (
    <div className="rounded-card border border-dashed border-line-strong bg-surface px-6 py-10 text-center">
      <p className="text-sm font-semibold text-ink">{title}</p>
      <p className="mt-1 text-sm text-muted">{note}</p>
    </div>
  )
}

export function ModeTag({ mode }) {
  return (
    <span
      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset ${
        mode === 'color'
          ? 'bg-accent-soft text-accent-text ring-accent-300/40'
          : 'bg-soft text-soft-ink ring-line-strong/60'
      }`}
    >
      {mode === 'color' ? 'Colour' : 'B&W'}
    </span>
  )
}

/** Subscription state → label + tone, shared by the panel and the platform console. */
export const billingStateMeta = (state) => ({
  comped: { label: 'Comped', tone: 'accent' },
  active: { label: 'Active', tone: 'success' },
  trial: { label: 'Free trial', tone: 'accent' },
  grace: { label: 'Grace period', tone: 'warn' },
  lapsed: { label: 'Lapsed', tone: 'danger' },
  none: { label: 'No plan', tone: 'neutral' },
}[state] || { label: state || 'Unknown', tone: 'neutral' })

const billingTones = {
  accent: 'bg-accent-soft text-accent-text ring-accent-300/40',
  success: 'bg-success-soft text-success ring-success/25',
  warn: 'bg-warn-soft text-warn ring-warn/25',
  danger: 'bg-danger-soft text-danger ring-danger/25',
  neutral: 'bg-soft text-soft-ink ring-line-strong/60',
}

export function BillingBadge({ state }) {
  const meta = billingStateMeta(state)
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${billingTones[meta.tone]}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {meta.label}
    </span>
  )
}

const printerTones = {
  ready: 'bg-success-soft text-success ring-success/25',
  offline: 'bg-danger-soft text-danger ring-danger/25',
  attention: 'bg-warn-soft text-warn ring-warn/25',
  unknown: 'bg-soft text-soft-ink ring-line-strong/60',
}

export function PrinterStateBadge({ state }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${printerTones[state] ?? printerTones.unknown}`}
    >
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {state}
    </span>
  )
}

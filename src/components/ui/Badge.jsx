const tones = {
  neutral: 'bg-soft text-soft-ink ring-line-strong/60',
  success: 'bg-success-soft text-success ring-success/25',
  warn: 'bg-warn-soft text-warn ring-warn/25',
  danger: 'bg-danger-soft text-danger ring-danger/25',
  info: 'bg-accent-soft text-accent-text ring-accent-300/40',
  planned: 'bg-warn-soft text-warn ring-warn/25',
  onNavy: 'bg-navy-800 text-navy-100 ring-navy-600',
}

export default function Badge({ children, tone = 'neutral', dot = false, className = '' }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${tones[tone]} ${className}`}
    >
      {dot ? <span className="size-1.5 rounded-full bg-current" /> : null}
      {children}
    </span>
  )
}

/** Small status pills shared by the overview and the shop detail. */
export function StatusBadge({ shop }) {
  const tone = shop.suspended
    ? 'bg-danger-soft text-danger ring-danger/25'
    : shop.is_open
      ? 'bg-success-soft text-success ring-success/25'
      : 'bg-soft text-soft-ink ring-line-strong/60'
  const label = shop.suspended ? 'Deactivated' : shop.is_open ? 'Open' : 'Closed'
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${tone}`}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  )
}

export function OnlineBadge({ online }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
        online ? 'bg-success-soft text-success ring-success/25' : 'bg-soft text-soft-ink ring-line-strong/60'
      }`}
    >
      <span aria-hidden="true" className={`size-1.5 rounded-full bg-current ${online ? 'animate-pulse' : ''}`} />
      {online ? 'Online' : 'Offline'}
    </span>
  )
}
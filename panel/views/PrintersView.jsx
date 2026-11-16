import { CircleAlert, Monitor, Network, Usb } from 'lucide-react'
import { EmptyState, PrinterStateBadge } from '../components/PanelUi.jsx'

const kindGlyph = { local: Usb, network: Network, shared: Network, loopback: Monitor }

export default function PrintersView({ panel }) {
  const { printers } = panel

  if (printers.length === 0) {
    return (
      <EmptyState
        title="No printers reported yet"
        note="The list fills in when the local agent sends its first heartbeat."
      />
    )
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted">
        These are the queues a shop can print into. When the panel is connected, this list comes from
        the local agent on this machine, so what Windows has installed is what shows here.
      </p>

      <ul className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {printers.map((printer) => {
          const Glyph = kindGlyph[printer.kind] ?? Network
          return (
            <li
              key={printer.name}
              className="rounded-card border border-line bg-surface p-4 shadow-card"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-ink">{printer.name}</p>
                  <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
                    <Glyph size={13} strokeWidth={1.9} aria-hidden="true" />
                    {printer.kind} · {printer.port || 'port unknown'}
                  </p>
                </div>
                <PrinterStateBadge state={printer.state} />
              </div>

              <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs">
                <div className="flex gap-1.5">
                  <dt className="text-muted">Queue</dt>
                  <dd className="panel-numeric font-semibold text-ink">{printer.queueLength}</dd>
                </div>
                {printer.isDefault ? (
                  <div className="flex gap-1.5">
                    <dt className="sr-only">Default</dt>
                    <dd className="font-semibold text-accent-text">Default printer</dd>
                  </div>
                ) : null}
              </dl>

              {printer.stateReason ? (
                <p className="mt-2.5 flex items-start gap-1.5 rounded-field bg-warn-soft px-2.5 py-2 text-xs font-medium text-warn">
                  <CircleAlert size={13} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0" />
                  {printer.stateReason}
                </p>
              ) : null}
            </li>
          )
        })}
      </ul>
    </div>
  )
}

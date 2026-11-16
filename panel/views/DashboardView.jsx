import { IndianRupee, Printer, ReceiptText, Wallet } from 'lucide-react'
import { PrinterStateBadge, StatCard } from '../components/PanelUi.jsx'
import QueuePanel from '../components/QueuePanel.jsx'
import { money } from '../state/store.js'

/** The overview: today's numbers, the printers' state, and the printing queue. */
export default function DashboardView({ panel }) {
  const { stats, printers } = panel

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <StatCard
          icon={Printer}
          label="Today prints"
          value={`${stats.printsToday} jobs · ${stats.printedSheets} sheets`}
          hint={`${stats.readyPrinters} of ${printers.length} printers ready`}
        />
        <StatCard
          icon={IndianRupee}
          label="Today payment"
          value={money(stats.collected)}
          hint={`${money(stats.cash)} cash · ${money(stats.online)} online`}
          tone="success"
        />
        <StatCard
          icon={Wallet}
          label="Waiting for payment"
          value={money(stats.owed)}
          hint={`${stats.owedCount} job${stats.owedCount === 1 ? '' : 's'} unpaid`}
          tone={stats.owed > 0 ? 'warn' : 'neutral'}
        />
        <StatCard
          icon={ReceiptText}
          label="Total billed today"
          value={money(stats.collected + stats.owed)}
          hint="Paid and unpaid together"
        />
      </div>

      <section aria-labelledby="dashboard-printers" className="rounded-card border border-line bg-surface p-4 shadow-card md:p-5">
        <h2 id="dashboard-printers" className="text-sm font-bold tracking-wide text-muted uppercase">
          Printers
        </h2>
        <ul className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {printers.map((printer) => (
            <li
              key={printer.name}
              className="flex items-center justify-between gap-3 rounded-field border border-line bg-canvas px-3 py-2.5"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">{printer.name}</p>
                <p className="text-xs text-muted">{printer.kind} · queue {printer.queueLength}</p>
              </div>
              <PrinterStateBadge state={printer.state} />
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-muted">
          Assignments and test prints live in Settings → Printer configuration.
        </p>
      </section>

      <QueuePanel panel={panel} />
    </div>
  )
}
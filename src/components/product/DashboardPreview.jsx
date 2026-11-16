import Badge from '@/components/ui/Badge.jsx'
import Icon from '@/components/ui/Icon.jsx'
import { dashboard } from '@/data/content.js'

const valueTone = {
  neutral: 'text-ink',
  success: 'text-success',
  warn: 'text-warn',
  danger: 'text-danger',
  info: 'text-accent-text',
}

const statusDot = {
  online: 'bg-success',
  busy: 'bg-accent-500',
  offline: 'bg-danger',
}

const sidebarItems = [
  { icon: 'dashboard', label: 'Dashboard', current: true },
  { icon: 'file-text', label: 'Print jobs' },
  { icon: 'printer', label: 'Printers' },
  { icon: 'scan', label: 'Scanning' },
  { icon: 'history', label: 'History' },
  { icon: 'users', label: 'Staff' },
]

function StateBadge({ state, className = '' }) {
  const meta = dashboard.states[state]
  return (
    <Badge tone={meta.tone} dot={state !== 'pending'} className={className}>
      {meta.label}
    </Badge>
  )
}

function StatTile({ stat }) {
  return (
    <div className="rounded-card border border-line bg-surface px-3.5 py-3">
      <p className="text-[11.5px] font-medium uppercase tracking-wide text-muted">
        {stat.label}
      </p>
      <p className={`mt-1 text-xl font-bold tabular-nums ${valueTone[stat.tone]}`}>
        {stat.value}
      </p>
      <p className="mt-0.5 truncate text-[11.5px] text-muted">{stat.meta}</p>
    </div>
  )
}

function JobRow({ job }) {
  return (
    <li className="border-t border-line px-3 py-2.5 transition-colors duration-150 hover:bg-surface sm:px-4 lg:grid lg:grid-cols-[minmax(0,2.1fr)_46px_58px_minmax(0,1.2fr)_104px] lg:items-center lg:gap-3">
      <div className="flex min-w-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <Icon name="file" size={14} className="shrink-0 text-muted" />
            <span className="truncate text-[13px] font-semibold text-ink">{job.file}</span>
          </div>
          <p className="mt-0.5 truncate pl-5 text-[11.5px] text-muted">
            #{job.id} &middot; {job.time}
            <span className="lg:hidden">
              {' '}
              &middot; {job.pages} pages &middot; {job.copies}&times; &middot; {job.printer}
            </span>
          </p>
        </div>
        <StateBadge state={job.state} className="shrink-0 lg:hidden" />
      </div>

      <span className="hidden text-[13px] tabular-nums text-body lg:block">{job.pages}</span>
      <span className="hidden text-[13px] tabular-nums text-body lg:block">{job.copies}&times;</span>
      <span className="hidden truncate text-[13px] text-body lg:block">{job.printer}</span>
      {/* wrapper carries the responsive display; Badge owns its own inline-flex */}
      <span className="hidden lg:inline-flex">
        <StateBadge state={job.state} />
      </span>
    </li>
  )
}

/**
 * The product screen, drawn with real markup instead of a screenshot: crisp on
 * every screen size, a few kilobytes instead of a megabyte of PNG, and it can be
 * replaced by a captured image later by swapping this one component.
 *
 * Plain divs and paragraphs only. This is a picture of the app, so it must not
 * add landmarks or outline headings to the landing page itself.
 *
 * `hero` is the trimmed version used beside the headline; `full` is the
 * standalone preview section.
 */
export default function DashboardPreview({ variant = 'hero', caption }) {
  const isFull = variant === 'full'
  const jobs = isFull ? dashboard.jobs : dashboard.jobs.slice(0, 3)
  const printers = isFull ? dashboard.printers : dashboard.printers.slice(0, 3)

  return (
    <figure className="m-0">
      <div className="overflow-hidden rounded-panel border border-line-strong bg-canvas shadow-panel">
        {/* window header */}
        <div className="flex items-center justify-between gap-3 border-b border-line bg-surface px-3.5 py-2.5">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="inline-flex size-7 shrink-0 items-center justify-center rounded-md bg-ink text-[11px] font-bold text-canvas">
              Q
            </span>
            <div className="min-w-0">
              <p className="truncate text-[12.5px] font-semibold text-ink">Sharma Cyber Cafe</p>
              <p className="truncate text-[11px] text-muted">Counter 1 &middot; 03 Nov, 12:05</p>
            </div>
          </div>
          <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-success-soft px-2.5 py-1 text-[11px] font-semibold text-success ring-1 ring-success/20 ring-inset">
            <span className="size-1.5 rounded-full bg-success" />
            Agent online
          </span>
        </div>

        <div className={isFull ? 'flex' : ''}>
          {isFull ? (
            <div className="hidden w-44 shrink-0 border-r border-line bg-surface px-2.5 py-3 md:block">
              <p className="px-2 pb-2 text-[10.5px] font-semibold uppercase tracking-wider text-muted">
                Menu
              </p>
              <ul className="space-y-0.5">
                {sidebarItems.map((item) => (
                  <li
                    key={item.label}
                    className={`flex items-center gap-2.5 rounded-md px-2 py-1.5 text-[12.5px] font-medium ${
                      item.current
                        ? 'bg-accent-soft text-accent-text'
                        : 'text-body'
                    }`}
                  >
                    <Icon name={item.icon} size={15} className="shrink-0" />
                    {item.label}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="min-w-0 flex-1 p-3 sm:p-4">
            <div
              className={`grid gap-2.5 ${
                isFull ? 'sm:grid-cols-2 lg:grid-cols-4' : 'grid-cols-2 lg:grid-cols-4'
              }`}
            >
              {dashboard.stats.map((stat) => (
                <StatTile key={stat.label} stat={stat} />
              ))}
            </div>

            <div className={isFull ? 'mt-3 grid gap-3 lg:grid-cols-2' : 'mt-3'}>
              <div className="rounded-card border border-line bg-surface">
                <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                  <p className="text-[12.5px] font-semibold text-ink">Printers</p>
                  <span className="text-[11px] text-muted">{printers.length} added</span>
                </div>
                <ul className="border-t border-line">
                  {printers.map((printer) => (
                    <li
                      key={printer.name}
                      className="flex items-center justify-between gap-3 border-t border-line px-3.5 py-2 transition-colors duration-150 first:border-t-0 hover:bg-surface"
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className={`size-2 shrink-0 rounded-full ${statusDot[printer.status]}`} />
                        <span className="min-w-0">
                          <span className="block truncate text-[12.5px] font-medium text-ink">
                            {printer.name}
                          </span>
                          <span className="block text-[11px] text-muted">
                            {printer.kind}
                            {printer.queue > 0 ? ` · ${printer.queue} in queue` : ' · idle'}
                          </span>
                        </span>
                      </span>
                      <StateBadge state={printer.status} />
                    </li>
                  ))}
                </ul>
              </div>

              {isFull ? (
                <div className="rounded-card border border-line bg-surface">
                  <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                    <p className="text-[12.5px] font-semibold text-ink">Scanning activity</p>
                    <span className="text-[11px] text-muted">Last hour</span>
                  </div>
                  <ul>
                    {dashboard.scans.map((scan) => (
                      <li
                        key={scan.file}
                        className="flex items-center gap-2.5 border-t border-line px-3.5 py-2.5 first:border-t-0"
                      >
                        <Icon name="scan" size={15} className="shrink-0 text-muted" />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] font-medium text-ink">
                            {scan.file}
                          </span>
                          <span className="block truncate text-[11px] text-muted">
                            {scan.pages} pages &middot; {scan.by}
                          </span>
                        </span>
                        <span className="shrink-0 text-[11px] tabular-nums text-muted">
                          {scan.time}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </div>

            <div className="mt-3 rounded-card border border-line bg-surface">
              <div className="flex items-center justify-between gap-2 px-3.5 py-2.5">
                <p className="text-[12.5px] font-semibold text-ink">Recent print jobs</p>
                <span className="text-[11px] text-muted">Today</span>
              </div>
              <div className="hidden border-t border-line px-3 py-1.5 sm:px-4 lg:grid lg:grid-cols-[minmax(0,2.1fr)_46px_58px_minmax(0,1.2fr)_104px] lg:gap-3">
                {[
                  ['File', 'left'],
                  ['Pages', 'right'],
                  ['Copies', 'right'],
                  ['Printer', 'left'],
                  ['Status', 'left'],
                ].map(([label, align]) => (
                  <span
                    key={label}
                    className={`text-[10.5px] font-semibold uppercase tracking-wider text-muted ${
                      align === 'right' ? 'text-right' : ''
                    }`}
                  >
                    {label}
                  </span>
                ))}
              </div>
              <ul className="pb-1">
                {jobs.map((job) => (
                  <JobRow key={job.id} job={job} />
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>

      <figcaption className="mt-3 text-center text-[12.5px] text-muted">
        {caption ?? 'Preview with sample data. Your own printers and jobs appear here after setup.'}
      </figcaption>
    </figure>
  )
}

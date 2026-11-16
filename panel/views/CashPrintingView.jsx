import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleAlert, FileText, Printer, Search } from 'lucide-react'
import { ActionButton, EmptyState, FilterGroup, ModeTag, PaymentSelect, QueueStatusBadge } from '../components/PanelUi.jsx'
import { clockTime, isActive, isToday, money } from '../state/store.js'

const ALL = 'all'

/**
 * Cash printing: jobs paid at the counter. The Paid/Unpaid dropdown is the
 * counter's main control — changing it moves the job between the two lists,
 * and the store persists it with every other job change. Once a job is paid
 * it gets the same Print button as Prepaid; nothing prints before payment.
 */
export default function CashPrintingView({ panel }) {
  const { jobs, queue, settings, amountOf, markPaid, enqueuePrint } = panel
  const cashJobs = useMemo(() => jobs.filter((job) => job.method === 'cash'), [jobs])

  const [status, setStatus] = useState('unpaid')
  const [mode, setMode] = useState(ALL)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState([])
  const [announcement, setAnnouncement] = useState('')
  const [warning, setWarning] = useState('')

  const byStatus = (job) =>
    status === ALL || (status === 'paid' ? job.paid : !job.paid)
  const byMode = (job) => mode === ALL || job.mode === mode
  const byQuery = (job) => {
    const text = query.trim().toLowerCase()
    return !text || `${job.id} ${job.name} ${job.file}`.toLowerCase().includes(text)
  }

  // Facet counts ignore their own filter, so "Paid 5" means what a person
  // expects: five jobs would show if they tapped it.
  const counts = useMemo(() => {
    const paid = cashJobs.filter((job) => job.paid).length
    return {
      status: { [ALL]: cashJobs.length, paid, unpaid: cashJobs.length - paid },
      mode: {
        [ALL]: cashJobs.filter(byStatus).length,
        color: cashJobs.filter((job) => byStatus(job) && job.mode === 'color').length,
        bw: cashJobs.filter((job) => byStatus(job) && job.mode === 'bw').length,
      },
    }
  }, [cashJobs, status, mode])

  const visible = useMemo(
    () =>
      cashJobs
        .filter((job) => byStatus(job) && byMode(job) && byQuery(job))
        .slice()
        .sort((a, b) => new Date(b.at) - new Date(a.at)),
    [cashJobs, status, mode, query],
  )

  // The latest queue entry per job drives the row's status badge and locks its
  // Print button while the job is still moving.
  const latestByJob = useMemo(() => {
    const map = new Map()
    for (const entry of queue) map.set(entry.jobId, entry)
    return map
  }, [queue])

  // Select All skips successfully printed jobs so bulk actions never redo
  // finished work; a failed job is still owed a print and stays selectable.
  const selectable = useMemo(
    () => visible.filter((job) => latestByJob.get(job.id)?.status !== 'success'),
    [visible, latestByJob],
  )

  const selectedIds = useMemo(() => {
    const visibleIds = new Set(visible.map((job) => job.id))
    return selected.filter((id) => visibleIds.has(id))
  }, [selected, visible])

  const selectedAmount = selectedIds.reduce(
    (sum, id) => sum + amountOf(cashJobs.find((job) => job.id === id)),
    0,
  )

  const allChecked = selectable.length > 0 && selectable.every((job) => selectedIds.includes(job.id))
  const someChecked = selectedIds.length > 0 && !allChecked
  const headRef = useRef(null)

  useEffect(() => {
    if (headRef.current) headRef.current.indeterminate = someChecked
  }, [someChecked])

  const toggleAll = () => {
    setSelected(allChecked ? [] : selectable.map((job) => job.id))
  }

  const toggleOne = (id) => {
    setSelected((current) => (current.includes(id) ? current.filter((one) => one !== id) : [...current, id]))
  }

  const apply = (paid, phrase) => {
    if (selectedIds.length === 0) return
    markPaid(selectedIds, paid)
    setAnnouncement(`${selectedIds.length} job${selectedIds.length === 1 ? '' : 's'} ${phrase}.`)
    setSelected([])
  }

  const print = (job) => {
    const result = enqueuePrint([job.id])
    if (result.sent > 0) {
      const printer = job.mode === 'color' ? settings.printerColor : settings.printerBw
      setAnnouncement(`${job.file} sent to ${printer}.`)
    } else {
      setAnnouncement('')
    }
    const cautions = []
    if (result.unassigned.bw > 0) {
      cautions.push('Not sent — no B&W printer assigned. Set one in Settings → Printer configuration.')
    }
    if (result.unassigned.color > 0) {
      cautions.push('Not sent — no colour printer assigned. Set one in Settings → Printer configuration.')
    }
    if (result.duplicates > 0) {
      cautions.push('Already in the queue — not sent again.')
    }
    setWarning(cautions.join(' '))
  }

  const printButton = (job) => {
    const entry = latestByJob.get(job.id)
    const busy = entry && isActive(entry)
    return (
      <ActionButton
        tone="primary"
        disabled={busy}
        label={`Print ${job.id}`}
        onClick={() => print(job)}
      >
        <span className="inline-flex items-center gap-1.5">
          <Printer size={13} strokeWidth={2} aria-hidden="true" />
          {busy ? 'In queue' : 'Print'}
        </span>
      </ActionButton>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-x-6 gap-y-3 rounded-card border border-line bg-surface p-4 shadow-card panel-no-print">
        <FilterGroup
          legend="Payment"
          name="filter-status"
          value={status}
          onChange={setStatus}
          options={[
            { value: 'unpaid', label: 'Unpaid', count: counts.status.unpaid },
            { value: 'paid', label: 'Paid', count: counts.status.paid },
            { value: ALL, label: 'All', count: counts.status[ALL] },
          ]}
        />
        <FilterGroup
          legend="Print type"
          name="filter-mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: ALL, label: 'All', count: counts.mode[ALL] },
            { value: 'color', label: 'Colour', count: counts.mode.color },
            { value: 'bw', label: 'B&W', count: counts.mode.bw },
          ]}
        />
        <div className="min-w-44 flex-1">
          <label htmlFor="cash-search" className="mb-1.5 block text-xs font-semibold tracking-wide text-muted uppercase">
            Search
          </label>
          <div className="relative">
            <Search size={14} strokeWidth={1.9} aria-hidden="true" className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input
              id="cash-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Id, customer or file"
              className="w-full rounded-field border border-line bg-canvas py-2 pr-3 pl-8 text-sm text-ink outline-none transition-colors duration-150 hover:border-line-strong focus:border-accent-600 focus:bg-surface"
            />
          </div>
        </div>
      </div>

      {selectedIds.length > 0 ? (
        <div
          className="panel-no-print flex flex-wrap items-center gap-2 rounded-card border border-accent-600/30 bg-accent-soft p-3"
          role="toolbar"
          aria-label="Actions on selected jobs"
        >
          <p className="panel-numeric mr-auto text-sm font-semibold text-ink">
            {selectedIds.length} selected · {money(selectedAmount)}
          </p>
          <ActionButton tone="primary" onClick={() => apply(true, 'marked paid')}>
            Mark paid
          </ActionButton>
          <ActionButton onClick={() => apply(false, 'marked unpaid')}>Mark unpaid</ActionButton>
          <ActionButton onClick={() => setSelected([])}>Clear</ActionButton>
        </div>
      ) : null}

      <p role="status" aria-live="polite" className="min-h-5 text-sm font-medium text-success">
        {announcement}
      </p>
      {warning ? (
        <p role="alert" className="flex items-start gap-2 rounded-card border border-warn/30 bg-warn-soft p-3 text-sm font-medium text-warn">
          <CircleAlert size={15} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0" />
          {warning}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState
          title={query ? 'No cash jobs match' : status === 'unpaid' ? 'Nothing waiting for cash' : 'No jobs match these filters'}
          note={query ? 'Try a different id, customer or file name.' : 'Change the filters above to see more.'}
        />
      ) : (
        <>
          {/*
            Wide screens: a table, because the counter reads columns. Below
            1024px ten columns cannot fit and the wrapper would clip the
            payment controls off screen, so the card list is used instead.
          */}
          <div
            data-panel="job-table"
            className="panel-sticky-head hidden overflow-hidden rounded-card border border-line bg-surface shadow-card lg:block"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">
                Cash print jobs with payment status. Use the checkbox in each row to select jobs.
              </caption>
              <thead className="border-b border-line text-left text-xs font-semibold tracking-wide text-muted uppercase">
                <tr>
                  <th scope="col" className="px-3 py-2.5">
                    <label className="inline-flex cursor-pointer items-center gap-2">
                      <input
                        ref={headRef}
                        type="checkbox"
                        checked={allChecked}
                        onChange={toggleAll}
                        disabled={selectable.length === 0}
                        aria-label="Select all jobs shown"
                        className="size-4 accent-[var(--color-accent-600)]"
                      />
                      <span className="sr-only">Select all</span>
                    </label>
                  </th>
                  <th scope="col" className="px-3 py-2.5">Id</th>
                  <th scope="col" className="px-3 py-2.5">Customer</th>
                  <th scope="col" className="px-3 py-2.5">File</th>
                  <th scope="col" className="px-3 py-2.5">Type</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Sheets</th>
                  <th scope="col" className="px-3 py-2.5 text-right">Amount</th>
                  <th scope="col" className="px-3 py-2.5">Payment</th>
                  <th scope="col" className="px-3 py-2.5">Time</th>
                  <th scope="col" className="px-3 py-2.5">Print</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {visible.map((job) => {
                  const entry = latestByJob.get(job.id)
                  return (
                  <tr key={job.id} className={selected.includes(job.id) ? 'bg-accent-soft/60' : 'hover:bg-soft/60'}>
                    <td className="px-3 py-2.5">
                      <input
                        type="checkbox"
                        checked={selected.includes(job.id)}
                        onChange={() => toggleOne(job.id)}
                        aria-label={`Select job ${job.id}`}
                        className="size-4 accent-[var(--color-accent-600)]"
                      />
                    </td>
                    <td className="panel-numeric px-3 py-2.5 font-semibold text-ink">{job.id}</td>
                    <td className="px-3 py-2.5 text-body">{job.name}</td>
                    <td className="max-w-52 truncate px-3 py-2.5 text-body">
                      <span className="inline-flex items-center gap-1.5">
                        <FileText size={14} strokeWidth={1.9} aria-hidden="true" className="text-muted" />
                        {job.file}
                      </span>
                    </td>
                    <td className="px-3 py-2.5">
                      <ModeTag mode={job.mode} />
                    </td>
                    <td className="panel-numeric px-3 py-2.5 text-right text-body">
                      {job.pages * job.copies}
                      <span className="text-muted"> ({job.pages}×{job.copies})</span>
                    </td>
                    <td className="panel-numeric px-3 py-2.5 text-right font-semibold text-ink">
                      {money(amountOf(job))}
                    </td>
                    <td className="px-3 py-2.5">
                      <PaymentSelect
                        paid={job.paid}
                        onChange={(paid) => markPaid([job.id], paid)}
                        label={`Payment status for ${job.id}, currently ${job.paid ? 'paid' : 'unpaid'}`}
                      />
                    </td>
                    <td className="panel-numeric px-3 py-2.5 text-muted">
                      {clockTime(job.at)}
                      {isToday(job.at) ? null : <span className="ml-1 text-xs">yest.</span>}
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="flex items-center gap-2">
                        {entry ? <QueueStatusBadge status={entry.status} /> : null}
                        {job.paid ? printButton(job) : null}
                      </div>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Narrow screens: cards, because ten columns cannot fit. */}
          <ul data-panel="job-cards" className="space-y-2.5 lg:hidden">
            <li className="panel-no-print">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-card border border-line bg-surface px-3 py-2.5 text-sm font-semibold text-ink">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleAll}
                  disabled={selectable.length === 0}
                  className="size-4 accent-[var(--color-accent-600)]"
                />
                Select all {selectable.length} job{selectable.length === 1 ? '' : 's'}
              </label>
            </li>

            {visible.map((job) => {
              const entry = latestByJob.get(job.id)
              return (
              <li key={job.id} className="rounded-card border border-line bg-surface p-3.5 shadow-card">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selected.includes(job.id)}
                    onChange={() => toggleOne(job.id)}
                    aria-label={`Select job ${job.id}`}
                    className="mt-1 size-4 shrink-0 accent-[var(--color-accent-600)]"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="panel-numeric text-sm font-bold text-ink">{job.id}</p>
                      <p className="panel-numeric text-sm font-bold text-ink">{money(amountOf(job))}</p>
                    </div>
                    <p className="mt-0.5 text-sm text-body">{job.name}</p>
                    <p className="truncate text-xs text-muted">{job.file}</p>

                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      <ModeTag mode={job.mode} />
                      <span className="panel-numeric text-xs text-muted">
                        {job.pages * job.copies} {job.pages * job.copies === 1 ? 'sheet' : 'sheets'}
                      </span>
                      <span className="panel-numeric text-xs text-muted">{clockTime(job.at)}</span>
                    </div>

                    <div className="mt-2.5 flex flex-wrap items-center gap-2">
                      <PaymentSelect
                        paid={job.paid}
                        onChange={(paid) => markPaid([job.id], paid)}
                        label={`Payment status for ${job.id}, currently ${job.paid ? 'paid' : 'unpaid'}`}
                      />
                      {entry ? <QueueStatusBadge status={entry.status} /> : null}
                      {job.paid ? printButton(job) : null}
                    </div>
                  </div>
                </div>
              </li>
              )
            })}
          </ul>
        </>
      )}
    </div>
  )
}
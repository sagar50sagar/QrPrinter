import { useEffect, useMemo, useRef, useState } from 'react'
import { CircleAlert, FileText, Printer, Search } from 'lucide-react'
import { ActionButton, EmptyState, FilterGroup, ModeTag, QueueStatusBadge } from '../components/PanelUi.jsx'
import { clockTime, isActive, isToday } from '../state/store.js'

const ALL = 'all'

/**
 * Prepaid printing: already paid online, so there is nothing to collect and no
 * payment control here. The work is selecting documents and printing them;
 * routing to the B&W or Colour printer is automatic from Settings.
 */
export default function PrepaidPrintingView({ panel }) {
  const { jobs, queue, settings, enqueuePrint } = panel
  const prepaidJobs = useMemo(() => jobs.filter((job) => job.method === 'online'), [jobs])

  const [mode, setMode] = useState(ALL)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState([])
  const [announcement, setAnnouncement] = useState('')
  const [warning, setWarning] = useState('')
  const [batch, setBatch] = useState([])

  const byMode = (job) => mode === ALL || job.mode === mode
  const byQuery = (job) => {
    const text = query.trim().toLowerCase()
    return !text || `${job.id} ${job.name} ${job.file}`.toLowerCase().includes(text)
  }

  const counts = useMemo(
    () => ({
      [ALL]: prepaidJobs.length,
      color: prepaidJobs.filter((job) => job.mode === 'color').length,
      bw: prepaidJobs.filter((job) => job.mode === 'bw').length,
    }),
    [prepaidJobs],
  )

  const visible = useMemo(
    () =>
      prepaidJobs
        .filter((job) => byMode(job) && byQuery(job))
        .slice()
        .sort((a, b) => new Date(b.at) - new Date(a.at)),
    [prepaidJobs, mode, query],
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

  const allChecked = selectable.length > 0 && selectable.every((job) => selectedIds.includes(job.id))
  const someChecked = selectedIds.length > 0 && !allChecked
  const headRef = useRef(null)

  useEffect(() => {
    if (headRef.current) headRef.current.indeterminate = someChecked
  }, [someChecked])

  const batchActive = batch.filter((id) => {
    const entry = latestByJob.get(id)
    return entry && isActive(entry)
  }).length
  const batchDone = batch.length - batchActive

  useEffect(() => {
    if (batch.length > 0 && batchActive === 0) {
      setAnnouncement(`${batch.length} document${batch.length === 1 ? '' : 's'} finished printing.`)
      setBatch([])
    }
  }, [batch, batchActive])

  const toggleAll = () => {
    setSelected(allChecked ? [] : selectable.map((job) => job.id))
  }

  const toggleOne = (id) => {
    setSelected((current) => (current.includes(id) ? current.filter((one) => one !== id) : [...current, id]))
  }

  const print = (ids) => {
    const result = enqueuePrint(ids)
    if (result.sent > 0) {
      const routes = []
      if (result.sentBw > 0) routes.push(`${result.sentBw} B&W to ${settings.printerBw}`)
      if (result.sentColor > 0) routes.push(`${result.sentColor} colour to ${settings.printerColor}`)
      setAnnouncement(`${result.sent} document${result.sent === 1 ? '' : 's'} sent: ${routes.join(', ')}.`)
      setBatch((current) => [...current, ...result.sentIds])
    } else {
      setAnnouncement('')
    }
    const cautions = []
    if (result.unassigned.bw > 0) {
      cautions.push(`${result.unassigned.bw} B&W document${result.unassigned.bw === 1 ? '' : 's'} not sent — no B&W printer assigned. Set one in Settings → Printer configuration.`)
    }
    if (result.unassigned.color > 0) {
      cautions.push(`${result.unassigned.color} colour document${result.unassigned.color === 1 ? '' : 's'} not sent — no colour printer assigned. Set one in Settings → Printer configuration.`)
    }
    if (result.duplicates > 0) {
      cautions.push(`${result.duplicates} already in the queue and were not sent again.`)
    }
    setWarning(cautions.join(' '))
    setSelected([])
  }

  const printButton = (job) => {
    const entry = latestByJob.get(job.id)
    const busy = entry && isActive(entry)
    return (
      <ActionButton
        tone="primary"
        disabled={busy}
        label={`Print ${job.id}`}
        onClick={() => print([job.id])}
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
          legend="Document type"
          name="filter-prepaid-mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: ALL, label: 'All', count: counts[ALL] },
            { value: 'bw', label: 'B&W', count: counts.bw },
            { value: 'color', label: 'Colour', count: counts.color },
          ]}
        />
        <div className="min-w-44 flex-1">
          <label htmlFor="prepaid-search" className="mb-1.5 block text-xs font-semibold tracking-wide text-muted uppercase">
            Search
          </label>
          <div className="relative">
            <Search size={14} strokeWidth={1.9} aria-hidden="true" className="absolute top-1/2 left-3 -translate-y-1/2 text-muted" />
            <input
              id="prepaid-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Id, customer or file"
              className="w-full rounded-field border border-line bg-canvas py-2 pr-3 pl-8 text-sm text-ink outline-none transition-colors duration-150 hover:border-line-strong focus:border-accent-600 focus:bg-surface"
            />
          </div>
        </div>
      </div>

      <div
        className="panel-no-print flex flex-wrap items-center gap-2 rounded-card border border-line bg-surface p-3 shadow-card"
        role="toolbar"
        aria-label="Printing actions"
      >
        <p className="panel-numeric mr-auto text-sm font-semibold text-ink">
          {selectedIds.length} selected
          {batch.length > 0 && batchActive > 0 ? ` · printing ${batchDone} of ${batch.length} finished` : ''}
        </p>
        {batch.length > 0 && batchActive > 0 ? (
          <progress
            value={batchDone}
            max={batch.length}
            aria-label="Bulk printing progress"
            className="h-2 w-32 overflow-hidden rounded-full align-middle accent-[var(--color-accent-600)]"
          />
        ) : null}
        <ActionButton tone="primary" disabled={selectedIds.length === 0} onClick={() => print(selectedIds)}>
          <span className="inline-flex items-center gap-1.5">
            <Printer size={14} strokeWidth={2} aria-hidden="true" />
            Print selected{selectedIds.length > 0 ? ` (${selectedIds.length})` : ''}
          </span>
        </ActionButton>
      </div>

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
          title={query ? 'No prepaid documents match' : 'No prepaid documents'}
          note={query ? 'Try a different id, customer or file name.' : 'Documents paid online arrive here, ready to print.'}
        />
      ) : (
        <>
          <div
            data-panel="prepaid-table"
            className="panel-sticky-head hidden overflow-hidden rounded-card border border-line bg-surface shadow-card lg:block"
          >
            <table className="w-full text-sm">
              <caption className="sr-only">
                Prepaid documents, ready to print. Use the checkbox in each row to select documents.
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
                        aria-label="Select all documents shown"
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
                  <th scope="col" className="px-3 py-2.5">Submitted</th>
                  <th scope="col" className="px-3 py-2.5">Status</th>
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
                          aria-label={`Select document ${job.id}`}
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
                      <td className="panel-numeric px-3 py-2.5 text-muted">
                        {clockTime(job.at)}
                        {isToday(job.at) ? null : <span className="ml-1 text-xs">yest.</span>}
                      </td>
                      <td className="px-3 py-2.5">
                        {entry ? <QueueStatusBadge status={entry.status} /> : <span className="text-xs text-muted">Not printed</span>}
                      </td>
                      <td className="px-3 py-2.5">{printButton(job)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Narrow screens: cards, because nine columns cannot fit. */}
          <ul data-panel="prepaid-cards" className="space-y-2.5 lg:hidden">
            <li className="panel-no-print">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-card border border-line bg-surface px-3 py-2.5 text-sm font-semibold text-ink">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleAll}
                  disabled={selectable.length === 0}
                  className="size-4 accent-[var(--color-accent-600)]"
                />
                Select all {selectable.length} document{selectable.length === 1 ? '' : 's'}
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
                      aria-label={`Select document ${job.id}`}
                      className="mt-1 size-4 shrink-0 accent-[var(--color-accent-600)]"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline justify-between gap-2">
                        <p className="panel-numeric text-sm font-bold text-ink">{job.id}</p>
                        {entry ? <QueueStatusBadge status={entry.status} /> : <span className="text-xs text-muted">Not printed</span>}
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

                      <div className="mt-2.5">{printButton(job)}</div>
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        </>
      )}

      <p className="text-xs text-muted">
        Documents route automatically: B&W to {settings.printerBw || 'the assigned B&W printer'}, colour to{' '}
        {settings.printerColor || 'the assigned colour printer'}. Change the assignments in Settings → Printer
        configuration. A mixed selection prints on both printers at once.
      </p>
    </div>
  )
}
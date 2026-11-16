import { RotateCcw } from 'lucide-react'
import { ActionButton, EmptyState, ModeTag, QueueStatusBadge } from './PanelUi.jsx'
import { clockTime, isActive, isToday } from '../state/store.js'

/**
 * The central printing queue: what is waiting, what the printer is working on,
 * what finished and what failed. Finished entries stay as history until
 * cleared, and the whole list survives a reload.
 */
export default function QueuePanel({ panel }) {
  const { queue, retryPrint, clearFinishedPrints } = panel

  const active = queue.filter(isActive)
  const finished = queue.filter((entry) => !isActive(entry))
  const rows = [...active, ...finished.slice().reverse()]

  return (
    <section aria-labelledby="queue-heading" className="rounded-card border border-line bg-surface p-4 shadow-card md:p-5">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="queue-heading" className="text-sm font-bold tracking-wide text-muted uppercase">
          Printing queue
        </h2>
        <p className="panel-numeric mr-auto text-sm text-body">
          {queue.length === 0
            ? 'Nothing sent yet'
            : `${active.length} in progress · ${finished.length} finished`}
        </p>
        {finished.length > 0 ? (
          <ActionButton onClick={clearFinishedPrints}>Clear finished</ActionButton>
        ) : null}
      </div>

      {active.length > 0 ? (
        <div className="mt-3 flex items-center gap-3">
          <progress
            value={finished.length}
            max={queue.length}
            aria-label="Printing progress"
            className="h-2 min-w-0 flex-1 overflow-hidden rounded-full accent-[var(--color-accent-600)]"
          />
          <span className="panel-numeric shrink-0 text-xs font-semibold text-muted">
            {finished.length} of {queue.length} finished
          </span>
        </div>
      ) : null}

      {rows.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            title="The queue is empty"
            note="Print a document from Printing → Prepaid printing and it shows up here."
          />
        </div>
      ) : (
        <ul data-panel="queue-list" className="mt-3 divide-y divide-line">
          {rows.map((entry) => (
            <li key={entry.id} className="flex flex-wrap items-center gap-x-3 gap-y-2 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-ink">{entry.file}</p>
                <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
                  <span>{entry.name}</span>
                  <ModeTag mode={entry.mode} />
                  <span aria-hidden="true">→</span>
                  <span className="font-medium text-body">{entry.printer}</span>
                  <span className="panel-numeric">
                    {clockTime(entry.at)}
                    {isToday(entry.at) ? null : ' yest.'}
                  </span>
                </p>
                {entry.status === 'failed' && entry.error ? (
                  <p role="alert" className="mt-1 text-xs font-medium text-danger">
                    {entry.error}
                  </p>
                ) : null}
              </div>
              <QueueStatusBadge status={entry.status} />
              {entry.status === 'failed' ? (
                <ActionButton label={`Retry ${entry.file}`} onClick={() => retryPrint(entry.id)}>
                  <span className="inline-flex items-center gap-1.5">
                    <RotateCcw size={13} strokeWidth={2} aria-hidden="true" />
                    Retry
                  </span>
                </ActionButton>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <p className="mt-3 text-xs text-muted">
        Reported by the local agent: a job moves to Printing when the agent takes it, and only reaches
        Success when the agent confirms the print. A failed job can be retried.
      </p>
    </section>
  )
}
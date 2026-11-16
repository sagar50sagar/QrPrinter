import { useEffect, useState } from 'react'
import { Printer } from 'lucide-react'
import { ActionButton, PrinterStateBadge } from './PanelUi.jsx'

/**
 * Which printer handles which print type. The list is the agent's heartbeat
 * shape; until an agent is connected it is sample data, and Test checks the
 * last reported state rather than pretending to probe the device.
 */
export default function PrinterConfig({ panel }) {
  const { settings, printers, patchSettings } = panel
  const [draft, setDraft] = useState({ bw: settings.printerBw, color: settings.printerColor })
  const [savedNote, setSavedNote] = useState('')
  const [testNote, setTestNote] = useState({ bw: '', color: '' })

  const dirty = draft.bw !== settings.printerBw || draft.color !== settings.printerColor

  // "Clear changes" resets the assignments from outside this card, so the
  // draft follows — but only when it is not already what is stored.
  useEffect(() => {
    setDraft((current) =>
      current.bw === settings.printerBw && current.color === settings.printerColor
        ? current
        : { bw: settings.printerBw, color: settings.printerColor },
    )
  }, [settings.printerBw, settings.printerColor])

  const save = () => {
    patchSettings({ printerBw: draft.bw, printerColor: draft.color })
    setSavedNote('Printer assignments saved to the server.')
  }

  const test = (kind) => {
    const name = draft[kind]
    if (!name) {
      setTestNote((current) => ({ ...current, [kind]: 'Nothing assigned to test.' }))
      return
    }
    const printer = printers.find((one) => one.name === name)
    if (!printer) {
      setTestNote((current) => ({ ...current, [kind]: `${name} is not in the reported printer list.` }))
      return
    }
    const reason = printer.stateReason ? ` (${printer.stateReason})` : ''
    setTestNote((current) => ({
      ...current,
      [kind]: `${name}: ${printer.state}${reason} — last reported state, not a live probe.`,
    }))
  }

  const row = (kind, label) => {
    const assigned = printers.find((one) => one.name === draft[kind])
    return (
      <div className="rounded-field border border-line bg-canvas p-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`printer-${kind}`} className="min-w-28 text-sm font-semibold text-ink">
            {label}
          </label>
          <select
            id={`printer-${kind}`}
            value={draft[kind]}
            onChange={(event) => {
              setDraft((current) => ({ ...current, [kind]: event.target.value }))
              setSavedNote('')
              setTestNote((current) => ({ ...current, [kind]: '' }))
            }}
            className="min-w-0 flex-1 rounded-field border border-line bg-surface px-2.5 py-2 text-sm text-body hover:border-line-strong"
          >
            <option value="">Not assigned</option>
            {printers.map((printer) => (
              <option key={printer.name} value={printer.name}>
                {printer.name} — {printer.state}
              </option>
            ))}
          </select>
          <ActionButton label={`Test ${label}`} onClick={() => test(kind)}>
            <span className="inline-flex items-center gap-1.5">
              <Printer size={13} strokeWidth={2} aria-hidden="true" />
              Test printer
            </span>
          </ActionButton>
          {assigned ? <PrinterStateBadge state={assigned.state} /> : null}
        </div>
        {testNote[kind] ? (
          <p role="status" className="mt-2 text-xs font-medium text-body">
            {testNote[kind]}
          </p>
        ) : null}
      </div>
    )
  }

  return (
    <section aria-labelledby="printer-config-heading" className="max-w-2xl rounded-card border border-line bg-surface p-5 shadow-card">
      <h2 id="printer-config-heading" className="text-sm font-bold tracking-wide text-muted uppercase">
        Printer configuration
      </h2>
      <p className="mt-1 text-sm text-muted">
        Documents route by print type: B&W jobs go to the B&W printer, colour jobs to the colour
        printer. A type left unassigned is warned about, never sent to the other printer.
      </p>

      <div className="mt-4 space-y-3">
        {row('bw', 'B&W printer')}
        {row('color', 'Colour printer')}
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <ActionButton tone="primary" disabled={!dirty} onClick={save}>
          Save configuration
        </ActionButton>
        {dirty ? <span className="text-xs font-medium text-warn">Unsaved changes</span> : null}
        <p role="status" aria-live="polite" className="text-sm font-medium text-success">
          {savedNote}
        </p>
      </div>

      <p className="mt-3 text-xs text-muted">
        The dropdown lists what the local agent reports on its heartbeat. Test checks that last reported
        state; the agent prints a real test page when a job is sent to that printer.
      </p>
    </section>
  )
}
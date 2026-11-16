import { useRef, useState } from 'react'
import { Banknote, Wallet } from 'lucide-react'
import CashPrintingView from './CashPrintingView.jsx'
import PrepaidPrintingView from './PrepaidPrintingView.jsx'

const sections = [
  { id: 'cash', label: 'Cash printing', glyph: Banknote },
  { id: 'prepaid', label: 'Prepaid printing', glyph: Wallet },
]

/** Printing splits by how the money arrives: collected at the counter, or already online. */
export default function PrintingView({ panel }) {
  const [section, setSection] = useState('cash')
  const tabRefs = useRef([])

  const onTabKeyDown = (event) => {
    const keys = { ArrowRight: 1, ArrowLeft: -1 }
    const step = keys[event.key]
    if (!step) return
    event.preventDefault()
    const index = sections.findIndex((entry) => entry.id === section)
    const next = (index + step + sections.length) % sections.length
    setSection(sections[next].id)
    tabRefs.current[next]?.focus()
  }

  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="Printing sections" className="panel-no-print flex gap-1.5 overflow-x-auto">
        {sections.map((entry, index) => {
          const Glyph = entry.glyph
          const selected = section === entry.id
          return (
            <button
              key={entry.id}
              ref={(node) => {
                tabRefs.current[index] = node
              }}
              type="button"
              role="tab"
              id={`tab-printing-${entry.id}`}
              aria-selected={selected}
              aria-controls={`panel-printing-${entry.id}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => setSection(entry.id)}
              onKeyDown={onTabKeyDown}
              className={`inline-flex shrink-0 items-center gap-1.5 rounded-field border px-2.5 py-1.5 text-sm font-semibold transition-colors duration-150 md:gap-2 md:px-3 md:py-2 ${
                selected
                  ? 'border-line bg-surface text-ink shadow-card'
                  : 'border-transparent text-muted hover:bg-soft hover:text-ink'
              }`}
            >
              <Glyph size={16} strokeWidth={1.9} aria-hidden="true" />
              {entry.label}
            </button>
          )
        })}
      </div>

      {section === 'cash' ? (
        <section role="tabpanel" id="panel-printing-cash" aria-labelledby="tab-printing-cash">
          <CashPrintingView panel={panel} />
        </section>
      ) : (
        <section role="tabpanel" id="panel-printing-prepaid" aria-labelledby="tab-printing-prepaid">
          <PrepaidPrintingView panel={panel} />
        </section>
      )}
    </div>
  )
}
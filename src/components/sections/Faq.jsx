import { useId, useState } from 'react'
import Section from '@/components/ui/Section.jsx'
import Icon from '@/components/ui/Icon.jsx'
import { faq } from '@/data/content.js'

function FaqItem({ item, isOpen, onToggle }) {
  const panelId = useId()

  return (
    <li className="group border-b border-line">
      <h3>
        <button
          type="button"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={onToggle}
          className="-mx-3 flex w-[calc(100%+1.5rem)] items-start justify-between gap-4 rounded-field px-3 py-5 text-left transition-colors duration-200 hover:bg-soft focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <span className="text-[1.0625rem] font-semibold text-ink transition-colors duration-200 group-hover:text-accent-text">{item.q}</span>
          <span
            className={`mt-0.5 shrink-0 text-muted transition-transform duration-200 ${
              isOpen ? 'rotate-180' : ''
            }`}
            aria-hidden="true"
          >
            <Icon name="chevron-down" size={20} />
          </span>
        </button>
      </h3>
      {/* grid-rows 0fr -> 1fr animates height without measuring the DOM */}
      <div
        id={panelId}
        className={`grid transition-[grid-template-rows] duration-250 ease-out ${
          isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
        }`}
      >
        <div className="overflow-hidden" aria-hidden={isOpen ? undefined : true}>
          <p className="max-w-3xl pb-5 pr-10 text-[0.9375rem] leading-relaxed text-body">
            {item.a}
          </p>
        </div>
      </div>
    </li>
  )
}

export default function Faq() {
  const [openIndex, setOpenIndex] = useState(0)

  return (
    <Section id="faq" tone="surface">
      <div className="grid gap-10 lg:grid-cols-[minmax(0,0.75fr)_minmax(0,1.25fr)] lg:gap-16">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-accent-text">
            {faq.eyebrow}
          </p>
          <h2 id="faq-title" className="text-section mt-3">
            {faq.title}
          </h2>
          <p className="mt-4 text-[1.0625rem] text-body">{faq.description}</p>
        </div>

        <ul className="border-t border-line">
          {faq.items.map((item, index) => (
            <FaqItem
              key={item.q}
              item={item}
              isOpen={openIndex === index}
              onToggle={() => setOpenIndex(openIndex === index ? null : index)}
            />
          ))}
        </ul>
      </div>
    </Section>
  )
}

import Section from '@/components/ui/Section.jsx'
import SectionHeading from '@/components/ui/SectionHeading.jsx'
import Reveal from '@/components/ui/Reveal.jsx'
import Icon from '@/components/ui/Icon.jsx'
import { benefits } from '@/data/content.js'

export default function Benefits() {
  return (
    <Section id="benefits" tone="surface">
      <SectionHeading
        id="benefits-title"
        eyebrow={benefits.eyebrow}
        title={benefits.title}
        description={benefits.description}
      />

      <ul className="mt-12 grid gap-x-10 gap-y-8 sm:grid-cols-2">
        {benefits.items.map((item, index) => (
          <Reveal as="li" key={item.title} delay={index * 60} className="group flex gap-4">
            <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-card bg-soft text-soft-ink transition-[background-color,color] duration-200 group-hover:bg-accent-600 group-hover:text-white">
              <Icon name={item.icon} size={19} />
            </span>
            <div>
              <h3 className="text-[1.0625rem] font-semibold">{item.title}</h3>
              <p className="mt-1.5 text-[0.9375rem] text-body">{item.text}</p>
            </div>
          </Reveal>
        ))}
      </ul>
    </Section>
  )
}

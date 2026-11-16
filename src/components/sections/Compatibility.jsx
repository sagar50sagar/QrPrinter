import Section from '@/components/ui/Section.jsx'
import SectionHeading from '@/components/ui/SectionHeading.jsx'
import Card from '@/components/ui/Card.jsx'
import Icon from '@/components/ui/Icon.jsx'
import Reveal from '@/components/ui/Reveal.jsx'
import { links } from '@/config/links.js'
import Button from '@/components/ui/Button.jsx'
import { compatibility } from '@/data/content.js'

export default function Compatibility() {
  return (
    <Section id="compatibility" tone="canvas">
      <SectionHeading
        id="compatibility-title"
        eyebrow={compatibility.eyebrow}
        title={compatibility.title}
        description={compatibility.description}
      />

      <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {compatibility.items.map((item, index) => (
          <Reveal as="li" key={item.title} delay={(index % 3) * 60} className="h-full">
            <Card hover className="h-full">
              <span className="inline-flex size-10 items-center justify-center rounded-card bg-soft text-soft-ink transition-[background-color,color] duration-200 group-hover:bg-accent-600 group-hover:text-white">
                <Icon name={item.icon} size={19} />
              </span>
              <h3 className="mt-4 text-[1.0625rem] font-semibold">{item.title}</h3>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-body">{item.text}</p>
            </Card>
          </Reveal>
        ))}

        <Reveal as="li" delay={120} className="h-full sm:col-span-2 lg:col-span-1">
          <div className="hover-lift flex h-full flex-col justify-between gap-5 rounded-card border border-line-strong bg-soft p-5 sm:p-6">
            <div>
              <span className="inline-flex size-10 items-center justify-center rounded-card bg-surface text-soft-ink">
                <Icon name="network-warnings" size={19} />
              </span>
              <h3 className="mt-4 text-[1.0625rem] font-semibold">Check your exact model</h3>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-body">
                {compatibility.disclosure}
              </p>
            </div>
            <Button href={links.support} variant="secondary" size="sm" className="self-start">
              Ask about my device
            </Button>
          </div>
        </Reveal>
      </ul>
    </Section>
  )
}

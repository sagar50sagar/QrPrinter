import Section from '@/components/ui/Section.jsx'
import SectionHeading from '@/components/ui/SectionHeading.jsx'
import Icon from '@/components/ui/Icon.jsx'
import Reveal from '@/components/ui/Reveal.jsx'
import { steps } from '@/data/content.js'

export default function HowItWorks() {
  return (
    <Section id="how-it-works" tone="surface">
      <SectionHeading
        id="how-it-works-title"
        eyebrow={steps.eyebrow}
        title={steps.title}
        description={steps.description}
      />

      <ol className="relative mt-12 grid gap-8 sm:grid-cols-2 lg:grid-cols-4 lg:gap-6">
        {/* connecting rail: vertical on phones, horizontal across four columns */}
        <span
          aria-hidden="true"
          className="absolute left-6 top-6 bottom-6 w-px bg-line-strong sm:hidden"
        />
        <span
          aria-hidden="true"
          className="absolute left-[12.5%] right-[12.5%] top-6 hidden h-px bg-line-strong lg:block"
        />

        {steps.items.map((step, index) => (
          <Reveal
            as="li"
            key={step.title}
            delay={index * 80}
            className="group relative flex items-start gap-4 lg:flex-col lg:items-center lg:gap-4 lg:text-center"
          >
            <span className="relative z-10 inline-flex size-12 shrink-0 items-center justify-center rounded-full border border-line-strong bg-surface text-soft-ink shadow-card transition-[background-color,border-color,color,transform] duration-200 motion-safe:group-hover:-translate-y-1 group-hover:border-accent-600 group-hover:bg-accent-600 group-hover:text-white">
              <Icon name={step.icon} size={20} />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.12em] text-accent-text">
                Step {index + 1}
              </p>
              <h3 className="mt-1.5 text-[1.0625rem] font-semibold">{step.title}</h3>
              <p className="mt-1.5 text-[0.9375rem] leading-relaxed text-body">{step.text}</p>
            </div>
          </Reveal>
        ))}
      </ol>
    </Section>
  )
}

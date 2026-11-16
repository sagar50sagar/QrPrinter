import Section from '@/components/ui/Section.jsx'
import SectionHeading from '@/components/ui/SectionHeading.jsx'
import Badge from '@/components/ui/Badge.jsx'
import Button from '@/components/ui/Button.jsx'
import Icon from '@/components/ui/Icon.jsx'
import Reveal from '@/components/ui/Reveal.jsx'
import { pricing } from '@/data/content.js'

function Price({ plan }) {
  if (plan.amount === null) {
    return (
      <div>
        <p className="text-[2rem] leading-none font-bold text-muted">
          &#8377; &mdash;
        </p>
        <p className="mt-2 text-[13px] text-muted">Not announced yet</p>
      </div>
    )
  }

  return (
    <p className="flex items-baseline gap-1.5">
      <span className="text-[2rem] leading-none font-bold tabular-nums text-ink">
        {'\u20B9'}
        {plan.amount}
      </span>
      {plan.period ? <span className="text-sm text-muted">{plan.period}</span> : null}
    </p>
  )
}

export default function Pricing() {
  return (
    <Section id="pricing" tone="canvas">
      <SectionHeading
        id="pricing-title"
        eyebrow={pricing.eyebrow}
        title={pricing.title}
        description={pricing.description}
        align="center"
      />

      <ul className="mt-12 grid gap-5 lg:grid-cols-3 lg:items-start">
        {pricing.plans.map((plan, index) => (
          <Reveal as="li" key={plan.name} delay={index * 70} className="h-full">
            <article
              className={`hover-lift relative flex h-full flex-col rounded-panel border p-6 ${
                plan.featured
                  ? 'glass-strong border-accent-600 shadow-lift ring-1 ring-accent-600'
                  : 'bg-surface border-line shadow-card hover:border-line-strong hover:shadow-lift'
              }`}
            >
              {plan.featured ? (
                <Badge tone="info" className="absolute -top-3 left-6">
                  Most popular
                </Badge>
              ) : null}

              <h3 className="text-[1.125rem] font-semibold">{plan.name}</h3>
              <p className="mt-1.5 min-h-[2.75rem] text-[0.9375rem] leading-relaxed text-body">
                {plan.cadence}
              </p>

              <div className="mt-5 border-t border-line pt-5">
                <Price plan={plan} />
              </div>

              <ul className="mt-6 flex-1 space-y-3">
                {plan.features.map((feature) => (
                  <li key={feature} className="flex gap-2.5 text-[0.9375rem] text-ink">
                    <Icon name="check" size={17} className="mt-0.5 shrink-0 text-accent-text" />
                    {feature}
                  </li>
                ))}
              </ul>

              <Button
                kind={plan.cta.kind}
                variant={plan.featured ? 'primary' : 'secondary'}
                block
                className="mt-7"
              >
                {plan.cta.label}
              </Button>
            </article>
          </Reveal>
        ))}
      </ul>

      <p className="mx-auto mt-8 max-w-2xl text-center text-[13px] text-muted">
        {pricing.disclosure}
      </p>
    </Section>
  )
}

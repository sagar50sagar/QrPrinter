import { hero } from '@/data/content.js'
import Button from '@/components/ui/Button.jsx'
import Icon from '@/components/ui/Icon.jsx'
import DashboardPreview from '@/components/product/DashboardPreview.jsx'

export default function Hero() {
  return (
    <section id="top" className="border-b border-line bg-canvas">
      <div className="container-site grid gap-12 py-14 sm:py-20 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)] lg:items-center lg:gap-14 lg:py-24">
        <div className="max-w-xl">
          <p className="inline-flex items-center gap-2 rounded-full border border-line-strong bg-soft px-3 py-1 text-xs font-semibold text-soft-ink">
            <span className="size-1.5 rounded-full bg-accent-500" aria-hidden="true" />
            {hero.eyebrow}
          </p>

          <h1 className="text-hero mt-5 text-balance">{hero.title}</h1>

          <p className="mt-5 text-[1.0625rem] leading-relaxed text-body sm:text-lg">
            {hero.description}
          </p>

          <div className="mt-8 flex flex-wrap gap-3">
            <Button kind={hero.primaryCta.kind} size="lg" icon="arrow-right">
              {hero.primaryCta.label}
            </Button>
            <Button href={hero.secondaryCta.href} variant="secondary" size="lg">
              {hero.secondaryCta.label}
            </Button>
          </div>

          <ul className="mt-9 flex flex-wrap gap-x-6 gap-y-3">
            {hero.highlights.map((item) => (
              <li key={item.label} className="group flex items-center gap-2.5">
                <span className="inline-flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent-text transition-colors duration-200 group-hover:bg-accent-600 group-hover:text-white">
                  <Icon name={item.icon} size={17} />
                </span>
                <span className="text-sm font-medium text-ink">{item.label}</span>
              </li>
            ))}
          </ul>

          <p className="mt-7 flex items-start gap-2 text-[13px] text-muted">
            <Icon name="shield" size={15} className="mt-0.5 shrink-0 text-muted" />
            {hero.trustNote}
          </p>
        </div>

        <div className="relative">
          <DashboardPreview variant="hero" />

          {/* glass chip: the one deliberately transparent element in the hero */}
          <div className="glass absolute -bottom-5 left-3 hidden max-w-[78%] items-center gap-3 rounded-card border border-line px-4 py-3 shadow-lift sm:flex">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent-600 text-white">
              <Icon name={hero.floatCard.icon} size={18} />
            </span>
            <span className="min-w-0">
              <span className="block text-[13px] font-semibold text-ink">
                {hero.floatCard.title}
              </span>
              <span className="block text-[12px] text-muted">{hero.floatCard.text}</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

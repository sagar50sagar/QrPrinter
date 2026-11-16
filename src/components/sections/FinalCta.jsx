import Section from '@/components/ui/Section.jsx'
import Button from '@/components/ui/Button.jsx'
import { finalCta } from '@/data/content.js'

export default function FinalCta() {
  return (
    <Section id="get-started" tone="navy" className="border-t border-band-line">
      <div className="glass-on-band mx-auto max-w-2xl rounded-panel border border-navy-700 p-8 text-center sm:p-12">
        <h2 id="get-started-title" className="text-section text-band-ink">
          {finalCta.title}
        </h2>
        <p className="mt-4 text-[1.0625rem] leading-relaxed text-band-body">
          {finalCta.description}
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Button kind={finalCta.primary.kind} variant="onNavy" size="lg" icon="arrow-right">
            {finalCta.primary.label}
          </Button>
          <Button kind={finalCta.secondary.kind} variant="outlineOnNavy" size="lg">
            {finalCta.secondary.label}
          </Button>
        </div>

        {/* band-dim drops under 4.5:1 once it sits on the lighter glass panel */}
        <p className="mt-6 text-[13px] text-band-body">{finalCta.note}</p>
      </div>
    </Section>
  )
}

import Section from '@/components/ui/Section.jsx'
import SectionHeading from '@/components/ui/SectionHeading.jsx'
import Card from '@/components/ui/Card.jsx'
import Badge from '@/components/ui/Badge.jsx'
import Icon from '@/components/ui/Icon.jsx'
import Reveal from '@/components/ui/Reveal.jsx'
import Button from '@/components/ui/Button.jsx'
import { features } from '@/data/content.js'

export default function Features() {
  return (
    <Section id="features" tone="canvas">
      <SectionHeading
        id="features-title"
        eyebrow={features.eyebrow}
        title={features.title}
        description={features.description}
        action={
          <Button href="#how-it-works" variant="link" icon="arrow-right">
            See how it works
          </Button>
        }
      />

      <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {features.items.map((item, index) => (
          <Reveal as="li" key={item.title} delay={(index % 4) * 60} className="h-full">
            <Card as="article" hover className="h-full">
              <span className="inline-flex size-10 items-center justify-center rounded-card bg-accent-soft text-accent-text transition-[background-color,color] duration-200 group-hover:bg-accent-600 group-hover:text-white">
                <Icon name={item.icon} size={19} />
              </span>
              <h3 className="mt-4 text-[1.0625rem] font-semibold">{item.title}</h3>
              <p className="mt-2 text-[0.9375rem] leading-relaxed text-body">{item.text}</p>
              {item.status === 'planned' ? (
                <Badge tone="planned" className="mt-4">
                  Coming soon
                </Badge>
              ) : null}
            </Card>
          </Reveal>
        ))}
      </ul>
    </Section>
  )
}

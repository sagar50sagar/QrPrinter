import Section from '@/components/ui/Section.jsx'
import SectionHeading from '@/components/ui/SectionHeading.jsx'
import Reveal from '@/components/ui/Reveal.jsx'
import DashboardPreview from '@/components/product/DashboardPreview.jsx'
import { dashboard } from '@/data/content.js'

export default function DashboardSection() {
  return (
    <Section id="dashboard" tone="surface">
      <SectionHeading
        id="dashboard-title"
        eyebrow={dashboard.eyebrow}
        title={dashboard.title}
        description={dashboard.description}
        align="center"
      />
      <Reveal className="mt-12">
        <DashboardPreview variant="full" caption={dashboard.caption} />
      </Reveal>
    </Section>
  )
}

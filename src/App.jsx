import Navbar from '@/components/layout/Navbar.jsx'
import Footer from '@/components/layout/Footer.jsx'
import Hero from '@/components/sections/Hero.jsx'
import Benefits from '@/components/sections/Benefits.jsx'
import Features from '@/components/sections/Features.jsx'
import HowItWorks from '@/components/sections/HowItWorks.jsx'
import Compatibility from '@/components/sections/Compatibility.jsx'
import DashboardSection from '@/components/sections/DashboardSection.jsx'
import Pricing from '@/components/sections/Pricing.jsx'
import Faq from '@/components/sections/Faq.jsx'
import FinalCta from '@/components/sections/FinalCta.jsx'
import useTheme from '@/lib/useTheme.js'

export default function App() {
  const [theme, toggleTheme] = useTheme()

  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-100 focus:rounded-field focus:bg-surface focus:px-4 focus:py-2 focus:font-semibold focus:text-ink focus:shadow-lift"
      >
        Skip to content
      </a>

      <Navbar theme={theme} onToggleTheme={toggleTheme} />

      <main id="main" tabIndex={-1}>
        <Hero />
        <Benefits />
        <Features />
        <HowItWorks />
        <Compatibility />
        <DashboardSection />
        <Pricing />
        <Faq />
        <FinalCta />
      </main>

      <Footer />
    </>
  )
}

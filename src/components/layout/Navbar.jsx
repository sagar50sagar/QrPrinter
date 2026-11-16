import { useCallback, useEffect, useState } from 'react'
import { nav } from '@/config/brand.js'
import { links } from '@/config/links.js'
import Button from '@/components/ui/Button.jsx'
import Icon from '@/components/ui/Icon.jsx'
import Logo from '@/components/ui/Logo.jsx'
import ThemeToggle from '@/components/ui/ThemeToggle.jsx'

/** Sections the scroll-spy can light up, in document order. */
const watched = nav.map((item) => item.href.slice(1))

export default function Navbar({ theme, onToggleTheme }) {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(null)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  // Highlight the section currently under the navbar.
  useEffect(() => {
    const sections = watched
      .map((id) => document.getElementById(id))
      .filter(Boolean)
    if (sections.length === 0) return

    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        setActive(visible[0]?.target.id ?? null)
      },
      { rootMargin: '-88px 0px -55% 0px', threshold: 0 },
    )

    sections.forEach((section) => observer.observe(section))
    return () => observer.disconnect()
  }, [])

  const close = useCallback(() => setOpen(false), [])

  // Close the mobile panel when the Escape key is used or the viewport grows
  // back into desktop layout, where the panel is hidden by CSS anyway.
  useEffect(() => {
    if (!open) return

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false)
        document.getElementById('nav-toggle')?.focus()
      }
    }

    const media = window.matchMedia('(min-width: 1024px)')
    const onMediaChange = (event) => event.matches && setOpen(false)

    document.addEventListener('keydown', onKeyDown)
    media.addEventListener('change', onMediaChange)
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      media.removeEventListener('change', onMediaChange)
    }
  }, [open])

  const linkClass = (href) =>
    `rounded-field px-3 py-2 text-sm font-medium transition-[background-color,color] duration-200 hover:bg-soft ${
      active === href.slice(1) ? 'text-accent-text' : 'text-body hover:text-ink'
    }`

  return (
    <header
      className={`glass sticky top-0 z-50 border-b transition-[border-color,box-shadow] duration-200 ${
        scrolled ? 'border-line shadow-card' : 'border-transparent'
      }`}
    >
      <div className="container-site flex h-17 items-center justify-between gap-4">
        <Logo />

        <nav aria-label="Primary" className="hidden lg:block">
          <ul className="flex items-center gap-1">
            {nav.map((item) => (
              <li key={item.href}>
                <a href={item.href} className={linkClass(item.href)}>
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <Button href={links.login} variant="secondary" size="sm">
            Login
          </Button>
          <Button kind="signup" size="sm" icon="arrow-right">
            Get Started
          </Button>
        </div>

        <div className="flex items-center gap-1.5 lg:hidden">
          <ThemeToggle theme={theme} onToggle={onToggleTheme} />
          <button
            id="nav-toggle"
            type="button"
            aria-expanded={open}
            aria-controls="mobile-nav"
            onClick={() => setOpen((value) => !value)}
            className="inline-flex size-11 items-center justify-center rounded-field border border-line text-ink transition-colors duration-200 hover:bg-soft"
          >
            <span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
            <Icon name={open ? 'close' : 'menu'} size={22} />
          </button>
        </div>
      </div>

      {open ? (
        <div id="mobile-nav" className="glass-strong border-t border-line lg:hidden">
          <nav aria-label="Primary" className="container-site py-4">
            <ul className="flex flex-col">
              {nav.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    onClick={close}
                    className="block rounded-field px-3 py-3 text-base font-medium text-ink transition-colors duration-200 hover:bg-soft"
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
            <div className="mt-2 border-t border-line pt-2">
              <ThemeToggle theme={theme} onToggle={onToggleTheme} variant="row" />
            </div>
            <div className="mt-3 flex flex-col gap-2 border-t border-line pt-4">
              <Button href={links.login} variant="secondary" size="md" block>
                Login
              </Button>
              <Button kind="signup" size="md" block icon="arrow-right" onClick={close}>
                Get Started
              </Button>
            </div>
          </nav>
        </div>
      ) : null}
    </header>
  )
}

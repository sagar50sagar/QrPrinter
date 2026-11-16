import { brand } from '@/config/brand.js'
import { links } from '@/config/links.js'
import { footer as footerContent } from '@/data/content.js'
import Icon from '@/components/ui/Icon.jsx'
import Logo from '@/components/ui/Logo.jsx'

const year = new Date().getFullYear()

const linkClass =
  'text-sm text-band-body underline-offset-4 transition-colors duration-200 hover:text-band-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2'

export default function Footer() {
  return (
    <footer className="bg-band-deep text-band-body">
      <div className="container-site py-14 sm:py-18">
        <h2 className="sr-only">Site map</h2>
        <div className="grid gap-10 lg:grid-cols-[1.4fr_repeat(4,1fr)]">
          <div className="max-w-xs">
            <Logo onNavy />
            <p className="mt-4 text-sm leading-relaxed text-band-body">
              {footerContent.description}
            </p>
            <a
              href={links.support}
              className="mt-5 inline-flex items-center gap-2 rounded-field text-sm font-semibold text-band-ink underline-offset-4 transition-colors duration-200 hover:text-accent-300 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4"
            >
              <Icon name="mail" size={16} />
              {brand.supportEmail}
            </a>
          </div>

          {footerContent.columns.map((column) => (
            <nav key={column.title} aria-label={column.title}>
              <h3 className="text-sm font-semibold uppercase tracking-[0.12em] text-band-ink">
                {column.title}
              </h3>
              <ul className="mt-4 space-y-2.5">
                {column.links.map((item) => (
                  <li key={item.label}>
                    <a href={item.href ?? links[item.kind] ?? links.signup} className={linkClass}>
                      {item.label}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-band-line pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-band-dim">
            &copy; {year} {brand.copyrightName}. All rights reserved.
          </p>
          <ul className="flex flex-wrap items-center gap-x-6 gap-y-2">
            {footerContent.legal.map((item) => (
              <li key={item.label}>
                <a href={links[item.kind]} className={linkClass}>
                  {item.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </footer>
  )
}

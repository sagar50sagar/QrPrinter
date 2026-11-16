import { brand } from '@/config/brand.js'

/**
 * Placeholder identity: a printer mark plus the product name read from
 * src/config/brand.js. Fills use the logo tokens so the mark stays legible on
 * both themes; swap the <svg> for a real logo file and the wordmark keeps
 * working from the same config value.
 */
export default function Logo({ href = '/', onNavy = false, className = '' }) {
  const plate = onNavy ? 'var(--color-navy-50)' : 'var(--color-logo-bg)'
  const body = onNavy ? 'var(--color-navy-900)' : 'var(--color-logo-fg)'
  const sheet = onNavy ? 'var(--color-navy-50)' : 'var(--color-logo-bg)'

  return (
    <a
      href={href}
      aria-label={`${brand.name} — home`}
      className={`group inline-flex items-center gap-2.5 rounded-field focus-visible:outline-2 focus-visible:outline-offset-4 ${className}`}
    >
      <svg
        width="30"
        height="30"
        viewBox="0 0 32 32"
        aria-hidden="true"
        focusable="false"
        className="transition-transform duration-200 motion-safe:group-hover:-translate-y-px"
      >
        <rect width="32" height="32" rx="7" fill={plate} />
        <rect x="10" y="6.5" width="12" height="6" rx="1.5" fill="var(--color-accent-300)" />
        <rect x="6" y="12" width="20" height="9.5" rx="2.5" fill={body} />
        <rect
          x="10"
          y="18"
          width="12"
          height="8"
          rx="1.5"
          fill={sheet}
          stroke={onNavy ? 'var(--color-navy-50)' : 'var(--color-logo-bg)'}
          strokeWidth="1.5"
        />
        <circle cx="22.5" cy="15.5" r="1.25" fill="var(--color-success)" />
      </svg>
      <span
        className={`text-[1.0625rem] font-bold tracking-[-0.01em] ${
          onNavy ? 'text-band-ink' : 'text-ink'
        }`}
      >
        {brand.name}
      </span>
    </a>
  )
}

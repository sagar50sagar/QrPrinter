import { isExternal, resolveHref } from '@/config/links.js'
import Icon from './Icon.jsx'

const base =
  'inline-flex items-center justify-center gap-2 font-semibold whitespace-nowrap ' +
  'rounded-field transition-[background-color,border-color,box-shadow,color,transform] duration-200'

const lift = 'motion-safe:hover:-translate-y-px motion-safe:active:translate-y-0'

const variants = {
  primary: `bg-accent-600 text-white shadow-card hover:bg-accent-700 hover:shadow-lift active:bg-accent-800 focus-visible:outline-accent-700 dark:focus-visible:outline-accent-400 ${lift}`,
  secondary: `border border-line bg-surface text-ink shadow-card hover:border-line-strong hover:bg-soft hover:shadow-lift active:bg-soft ${lift}`,
  onNavy: `bg-band-ink text-band-deep shadow-panel hover:bg-white hover:shadow-lift focus-visible:outline-white ${lift}`,
  outlineOnNavy:
    'border border-navy-600 text-white hover:border-navy-400 hover:bg-navy-800 focus-visible:outline-white',
  link: 'text-accent-text underline-offset-4 hover:underline p-0',
}

const sizes = {
  sm: 'px-3.5 py-2 text-sm',
  md: 'px-5 py-2.5 text-[0.9375rem]',
  lg: 'px-6 py-3 text-base',
}

/**
 * One button, two tags. Anything with an href is a link (a CTA on a landing page
 * always navigates), everything else is a real <button>.
 */
export default function Button({
  children,
  href,
  kind,
  variant = 'primary',
  size = 'md',
  icon,
  iconLeft,
  external = false,
  block = false,
  className = '',
  ...rest
}) {
  const classes = `${base} ${variants[variant]} ${variant === 'link' ? '' : sizes[size]} ${
    block ? 'w-full' : ''
  } ${className}`

  const iconSize = size === 'lg' ? 18 : 16
  const inner = (
    <>
      {iconLeft ? <Icon name={iconLeft} size={iconSize} /> : null}
      {children}
      {icon ? (
        <Icon
          name={icon}
          size={iconSize}
          className="transition-transform duration-200 motion-safe:group-hover:translate-x-0.5"
        />
      ) : null}
    </>
  )

  if (href || kind) {
    const to = resolveHref({ href, kind })
    const externalish = external || isExternal(to)
    return (
      <a
        href={to}
        className={`group ${classes}`}
        {...(externalish && /^https?:/.test(to)
          ? { target: '_blank', rel: 'noopener noreferrer' }
          : {})}
        {...rest}
      >
        {inner}
      </a>
    )
  }

  return (
    <button type="button" className={`group ${classes}`} {...rest}>
      {inner}
    </button>
  )
}

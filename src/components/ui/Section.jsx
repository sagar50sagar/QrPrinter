const tones = {
  surface: 'bg-surface',
  canvas: 'bg-canvas',
  navy: 'bg-band text-band-body',
}

/**
 * Page section: semantic <section> + predictable rhythm + optional background.
 * `tight` is used where a section only carries a heading and a wide panel.
 */
export default function Section({
  id,
  tone = 'surface',
  size = 'default',
  className = '',
  containerClassName = '',
  children,
  ...rest
}) {
  const paddings = {
    tight: 'py-14 sm:py-20',
    default: 'py-20 sm:py-28',
  }

  return (
    <section
      id={id}
      aria-labelledby={id ? `${id}-title` : undefined}
      className={`${tones[tone]} ${paddings[size]} ${className}`}
      {...rest}
    >
      <div className={`container-site ${containerClassName}`}>{children}</div>
    </section>
  )
}

/**
 * Heading block used by every section. The <h2> carries the id that
 * <Section aria-labelledby> points at, so the section is named for
 * assistive tech without extra landmarks.
 */
export default function SectionHeading({
  id,
  eyebrow,
  title,
  description,
  align = 'left',
  onNavy = false,
  action = null,
}) {
  const centered = align === 'center'

  return (
    <div
      className={`flex flex-col gap-5 ${
        centered ? 'items-center text-center' : 'sm:flex-row sm:items-end sm:justify-between'
      }`}
    >
      <div className="max-w-2xl">
        {eyebrow ? (
          <p
            className={`text-xs font-semibold uppercase tracking-[0.14em] ${
              onNavy ? 'text-accent-300' : 'text-accent-text'
            }`}
          >
            {eyebrow}
          </p>
        ) : null}
        <h2 id={id} className={`text-section mt-3 ${onNavy ? 'text-band-ink' : 'text-ink'}`}>
          {title}
        </h2>
        {description ? (
          <p
            className={`mt-4 text-base sm:text-[1.0625rem] ${
              onNavy ? 'text-band-body' : 'text-body'
            }`}
          >
            {description}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}

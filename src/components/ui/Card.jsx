/**
 * Card surface. `hover` adds the shared lift and turns the card into a `group`
 * so headings and icon chips can react to the same pointer.
 * `glass` is for the few surfaces that deliberately sit over other content.
 */
export default function Card({
  children,
  as: Tag = 'div',
  hover = false,
  glass = false,
  padded = true,
  className = '',
}) {
  return (
    <Tag
      className={`border border-line rounded-card shadow-card ${
        glass ? 'glass' : 'bg-surface'
      } ${padded ? 'p-5 sm:p-6' : ''} ${
        hover ? `hover-lift group hover:border-line-strong hover:shadow-lift` : ''
      } ${className}`}
    >
      {children}
    </Tag>
  )
}

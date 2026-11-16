import Icon from '@/components/ui/Icon.jsx'

/**
 * `icon` sits in the navbar; `row` is the labelled switch inside the mobile
 * sheet, where a bare icon is easy to miss.
 */
export default function ThemeToggle({ theme, onToggle, variant = 'icon', className = '' }) {
  const isDark = theme === 'dark'
  const label = isDark ? 'Switch to light theme' : 'Switch to dark theme'

  if (variant === 'row') {
    return (
      <button
        type="button"
        onClick={onToggle}
        aria-pressed={isDark}
        className={`flex w-full items-center justify-between gap-4 rounded-field px-3 py-3 text-base font-medium text-ink transition-colors duration-200 hover:bg-soft ${className}`}
      >
        <span className="flex items-center gap-2.5">
          <Icon name={isDark ? 'moon' : 'sun'} size={18} className="text-accent-text" />
          Dark mode
        </span>
        <span
          aria-hidden="true"
          className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border transition-colors duration-200 ${
            isDark ? 'border-accent-600 bg-accent-600' : 'border-line-strong bg-soft'
          }`}
        >
          <span
            className={`absolute size-4 rounded-full bg-ink shadow-card transition-[left] duration-200 ${
              isDark ? 'left-6' : 'left-1'
            }`}
          />
        </span>
      </button>
    )
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={label}
      title={label}
      className={`inline-flex size-11 items-center justify-center rounded-field border border-line text-ink transition-[background-color,border-color,color] duration-200 hover:border-line-strong hover:bg-soft ${className}`}
    >
      <Icon name={isDark ? 'sun' : 'moon'} size={19} />
    </button>
  )
}

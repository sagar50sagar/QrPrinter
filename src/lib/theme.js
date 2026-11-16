const STORAGE_KEY = 'qp-theme'

/** The explicit choice, or null while the page should keep following the OS. */
export function storedTheme() {
  try {
    const value = localStorage.getItem(STORAGE_KEY)
    return value === 'light' || value === 'dark' ? value : null
  } catch {
    return null
  }
}

export function currentTheme() {
  if (typeof document === 'undefined') return 'light'
  return document.documentElement.classList.contains('dark') ? 'dark' : 'light'
}

/**
 * Paint without remembering. The `<html class="dark">` decision itself is made
 * by the inline script in index.html before first paint; this keeps the
 * browser chrome colour in sync with whatever that script chose.
 */
export function paintTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark')

  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) {
    meta.setAttribute(
      'content',
      getComputedStyle(document.documentElement).getPropertyValue('--color-canvas').trim() ||
        '#0e1c33',
    )
  }
}

export function applyTheme(theme) {
  paintTheme(theme)
  try {
    localStorage.setItem(STORAGE_KEY, theme)
  } catch {
    /* this session only */
  }
}

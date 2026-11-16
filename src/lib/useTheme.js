import { useCallback, useEffect, useState } from 'react'
import { applyTheme, currentTheme, paintTheme, storedTheme } from './theme.js'

/**
 * One source of truth for the colour theme, so every toggle on the page shows
 * the same state. Until the visitor chooses explicitly, the page keeps tracking
 * their operating system setting.
 */
export default function useTheme() {
  const [theme, setTheme] = useState(currentTheme)

  useEffect(() => {
    paintTheme(currentTheme())

    const media = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (storedTheme()) return
      const next = media.matches ? 'dark' : 'light'
      paintTheme(next)
      setTheme(next)
    }

    media.addEventListener('change', onChange)
    return () => media.removeEventListener('change', onChange)
  }, [])

  const toggleTheme = useCallback(() => {
    const next = currentTheme() === 'dark' ? 'light' : 'dark'
    applyTheme(next)
    setTheme(next)
  }, [])

  return [theme, toggleTheme]
}

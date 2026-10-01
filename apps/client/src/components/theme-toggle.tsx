import { useEffect } from 'react'
import { Moon, Sun } from '@phosphor-icons/react'
import { useStore } from '../store'
import {
  applyColorScheme,
  darkQuery,
  resolveColorScheme,
  toggledThemePreference,
  writeThemePreference,
} from '../utils/theme'

function ThemeToggle({ className }: { className?: string }) {
  const themePreference = useStore((state) => state.themePreference)
  const colorScheme = useStore((state) => state.colorScheme)
  const setThemePreference = useStore((state) => state.setThemePreference)
  const setColorScheme = useStore((state) => state.setColorScheme)

  // Keeps the `.dark` class on <html> (Tailwind's `dark:` variants) and the
  // store's resolved `colorScheme` (the 3D scene's shader uniforms) in step
  // with the preference — and, while following the system, with the OS
  // setting changing underneath us.
  useEffect(() => {
    writeThemePreference(themePreference)

    const update = () => {
      const scheme = resolveColorScheme(themePreference)
      applyColorScheme(scheme)
      setColorScheme(scheme)
    }

    update()

    if (themePreference !== 'system') return
    const query = darkQuery()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [themePreference])

  const isDark = colorScheme === 'dark'

  return (
    <button
      type="button"
      onClick={() => setThemePreference(toggledThemePreference(colorScheme))}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      className={className}
    >
      {isDark ? <Sun /> : <Moon />}
      {isDark ? 'Light' : 'Dark'}
    </button>
  )
}

export default ThemeToggle

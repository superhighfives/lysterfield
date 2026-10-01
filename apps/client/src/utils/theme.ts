export type ThemePreference = 'system' | 'light' | 'dark'
export type ColorScheme = 'light' | 'dark'

// Must match the key index.html's inline pre-paint script reads, which
// applies the same `.dark` class before React mounts so a dark-mode visit
// doesn't flash the light background first.
const STORAGE_KEY = 'theme'

export const darkQuery = () => window.matchMedia('(prefers-color-scheme: dark)')

export function readThemePreference(): ThemePreference {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Storage blocked (private mode, disabled site data) — fall through.
  }

  return 'system'
}

export function writeThemePreference(preference: ThemePreference) {
  try {
    if (preference === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // Storage blocked — the choice still applies for this visit.
  }
}

export function resolveColorScheme(preference: ThemePreference): ColorScheme {
  if (preference !== 'system') return preference
  return darkQuery().matches ? 'dark' : 'light'
}

export function applyColorScheme(scheme: ColorScheme) {
  const root = document.documentElement
  root.classList.toggle('dark', scheme === 'dark')
  root.style.colorScheme = scheme
}

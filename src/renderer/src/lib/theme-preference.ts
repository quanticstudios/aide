import { useSyncExternalStore } from 'react'

export type ThemePreference = 'system' | 'light' | 'dark' | 'contrast'
/** The styles.css palette a preference resolves to. */
export type Palette = 'light' | 'dark' | 'contrast'
/** Light or dark, for libraries that only know those two (the diff view). */
export type ColorScheme = 'light' | 'dark'

export interface ThemeOption {
  readonly id: ThemePreference
  readonly label: string
  readonly hint: string
}

export const THEME_OPTIONS: readonly ThemeOption[] = [
  {
    id: 'system',
    label: 'System',
    hint: 'Light or Dark, following the OS setting.',
  },
  {
    id: 'light',
    label: 'Light',
    hint: 'White panes on cool gray chrome.',
  },
  {
    id: 'dark',
    label: 'Dark',
    hint: 'Cool near-black. Panes lift off the chrome.',
  },
  {
    id: 'contrast',
    label: 'High contrast',
    hint: 'Pure black canvas, hairline edges.',
  },
]

const STORAGE_KEY = 'aide.theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'
const PREFERENCES = new Set<string>(THEME_OPTIONS.map((option) => option.id))
const listeners = new Set<() => void>()

export function getThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'system'
  const stored = window.localStorage.getItem(STORAGE_KEY)
  return stored && PREFERENCES.has(stored)
    ? (stored as ThemePreference)
    : 'system'
}

export function resolvePalette(
  preference: ThemePreference,
  systemPrefersDark: boolean,
): Palette {
  if (preference !== 'system') return preference
  return systemPrefersDark ? 'dark' : 'light'
}

export function getPalette(): Palette {
  return (document.documentElement.dataset.palette as Palette) ?? 'dark'
}

export function getColorScheme(): ColorScheme {
  return getPalette() === 'light' ? 'light' : 'dark'
}

/** Calls the listener after every palette change. */
export function subscribePalette(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The active light or dark scheme; re-renders when the theme or the OS setting changes. */
export function useColorScheme(): ColorScheme {
  return useSyncExternalStore(subscribePalette, getColorScheme, () => 'dark')
}

function applyThemePreference(): void {
  const palette = resolvePalette(
    getThemePreference(),
    window.matchMedia(DARK_QUERY).matches,
  )
  const root = document.documentElement
  if (root.dataset.palette === palette) return
  const scheme = palette === 'light' ? 'light' : 'dark'
  // why: otherwise every transition-colors element fades from the old palette at its own speed.
  root.dataset.paletteSwitching = ''
  root.dataset.palette = palette
  // why: HeroUI switches its own variables on data-theme and the dark/light class.
  root.dataset.theme = scheme
  root.classList.toggle('dark', scheme === 'dark')
  root.classList.toggle('light', scheme === 'light')
  // why: reading a computed value applies the new palette while transitions are still off.
  void getComputedStyle(root).transitionDuration
  setTimeout(() => delete root.dataset.paletteSwitching)
  for (const listener of listeners) listener()
}

export function setThemePreference(preference: ThemePreference): void {
  window.localStorage.setItem(STORAGE_KEY, preference)
  applyThemePreference()
}

export function initializeThemePreference(): void {
  applyThemePreference()
  window.matchMedia(DARK_QUERY).addEventListener('change', applyThemePreference)
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null) applyThemePreference()
  })
}

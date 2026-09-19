export type ThemePreference = 'dark' | 'contrast'

export interface ThemePreview {
  readonly canvas: string
  readonly pane: string
  readonly card: string
  readonly bar: string
  readonly primary: string
}

export interface ThemeOption {
  readonly id: ThemePreference
  readonly label: string
  readonly hint: string
  readonly preview: ThemePreview
}

export const THEME_OPTIONS: readonly ThemeOption[] = [
  {
    id: 'dark',
    label: 'Dark',
    hint: 'Cool near-black. Panes lift off the chrome.',
    preview: {
      canvas: '#08090c',
      pane: '#14161b',
      card: '#1c1f26',
      bar: '#3a3f4a',
      primary: '#2997ff',
    },
  },
  {
    id: 'contrast',
    label: 'High contrast',
    hint: 'Pure black canvas, hairline edges.',
    preview: {
      canvas: '#07080a',
      pane: '#0d0d0d',
      card: '#141416',
      bar: '#2c2c30',
      primary: '#0071e3',
    },
  },
]

const STORAGE_KEY = 'aide.theme'

export function getThemePreference(): ThemePreference {
  if (typeof window === 'undefined') return 'dark'
  return window.localStorage.getItem(STORAGE_KEY) === 'contrast'
    ? 'contrast'
    : 'dark'
}

function applyThemePreference(): void {
  document.documentElement.dataset.palette = getThemePreference()
}

export function setThemePreference(preference: ThemePreference): void {
  window.localStorage.setItem(STORAGE_KEY, preference)
  applyThemePreference()
}

export function initializeThemePreference(): void {
  applyThemePreference()
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null) applyThemePreference()
  })
}

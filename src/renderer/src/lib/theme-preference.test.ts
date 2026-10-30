// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

let systemDark: boolean
let systemListeners: (() => void)[]

// why: the preference keeps module state, so each test loads a fresh copy.
async function loadPreference() {
  vi.resetModules()
  return import('./theme-preference')
}

// why: Node's own localStorage global shadows happy-dom's and is undefined without a file.
function stubLocalStorage() {
  const items = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    clear: () => items.clear(),
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
  })
}

function setSystemDark(value: boolean) {
  systemDark = value
  for (const listener of systemListeners) listener()
}

beforeEach(() => {
  stubLocalStorage()
  systemDark = true
  systemListeners = []
  vi.stubGlobal('matchMedia', (query: string) => ({
    addEventListener: (_type: string, listener: () => void) =>
      systemListeners.push(listener),
    get matches() {
      return query === '(prefers-color-scheme: dark)' && systemDark
    },
  }))
})

afterEach(() => {
  vi.unstubAllGlobals()
  const root = document.documentElement
  delete root.dataset.palette
  delete root.dataset.theme
  root.className = ''
})

describe('resolvePalette', () => {
  it('follows the OS for system and keeps every explicit palette', async () => {
    const { resolvePalette } = await loadPreference()
    expect(resolvePalette('system', true)).toBe('dark')
    expect(resolvePalette('system', false)).toBe('light')
    expect(resolvePalette('light', true)).toBe('light')
    expect(resolvePalette('dark', false)).toBe('dark')
    expect(resolvePalette('contrast', false)).toBe('contrast')
  })
})

describe('theme preference', () => {
  it('defaults to system and treats unknown stored values as system', async () => {
    const { getThemePreference } = await loadPreference()
    expect(getThemePreference()).toBe('system')
    window.localStorage.setItem('aide.theme', 'sepia')
    expect(getThemePreference()).toBe('system')
  })

  it('switches palette, HeroUI theme and listeners when the OS setting flips', async () => {
    const { getColorScheme, initializeThemePreference, subscribePalette } =
      await loadPreference()
    const listener = vi.fn()
    subscribePalette(listener)
    initializeThemePreference()
    const root = document.documentElement
    expect(root.dataset.palette).toBe('dark')
    expect(root.dataset.theme).toBe('dark')
    expect(root.classList.contains('dark')).toBe(true)

    vi.useFakeTimers()
    setSystemDark(false)
    expect(root.dataset.paletteSwitching).toBe('')
    vi.runAllTimers()
    vi.useRealTimers()
    expect(root.dataset.paletteSwitching).toBeUndefined()
    expect(root.dataset.palette).toBe('light')
    expect(root.dataset.theme).toBe('light')
    expect(root.classList.contains('dark')).toBe(false)
    expect(root.classList.contains('light')).toBe(true)
    expect(getColorScheme()).toBe('light')
    expect(listener).toHaveBeenCalledTimes(2)

    setSystemDark(false)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('keeps an explicit palette while the OS setting changes', async () => {
    const { getColorScheme, initializeThemePreference, setThemePreference } =
      await loadPreference()
    initializeThemePreference()
    setThemePreference('contrast')
    expect(document.documentElement.dataset.palette).toBe('contrast')
    expect(getColorScheme()).toBe('dark')
    expect(window.localStorage.getItem('aide.theme')).toBe('contrast')

    setSystemDark(false)
    expect(document.documentElement.dataset.palette).toBe('contrast')
  })
})

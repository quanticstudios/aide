import { useSyncExternalStore } from 'react'

/** An empty family or a null size keeps the styles.css default. */
export interface FontPreference {
  readonly uiFamily: string
  readonly uiSize: number | null
  readonly codeFamily: string
  readonly codeSize: number | null
}

export const DEFAULT_UI_FONT_SIZE = 14
export const FONT_SIZE_RANGE = { max: 24, min: 9 } as const

const DEFAULT_FONTS: FontPreference = {
  codeFamily: '',
  codeSize: null,
  uiFamily: '',
  uiSize: null,
}
const STORAGE_KEY = 'aide.fonts'
const listeners = new Set<() => void>()
let current = DEFAULT_FONTS

function readFamily(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readSize(value: unknown): number | null {
  return typeof value === 'number' &&
    value >= FONT_SIZE_RANGE.min &&
    value <= FONT_SIZE_RANGE.max
    ? value
    : null
}

/** Drops whatever in stored JSON is not a usable family or an in-range size. */
export function parseFontPreference(stored: string | null): FontPreference {
  try {
    const value = JSON.parse(stored ?? '{}') as Record<string, unknown>
    return {
      codeFamily: readFamily(value.codeFamily),
      codeSize: readSize(value.codeSize),
      uiFamily: readFamily(value.uiFamily),
      uiSize: readSize(value.uiSize),
    }
  } catch {
    return DEFAULT_FONTS
  }
}

export function getFontPreference(): FontPreference {
  return current
}

export function useFontPreference(): FontPreference {
  return useSyncExternalStore(
    subscribeFontPreference,
    getFontPreference,
    getFontPreference,
  )
}

export function subscribeFontPreference(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

// see: styles.css `--ui-font-family` and `--code-font-family` — these repeat their default stacks.
const UI_FONT_FALLBACK =
  '"Geist Variable", system-ui, -apple-system, "Segoe UI", sans-serif'
const CODE_FONT_FALLBACK =
  '"Geist Mono Variable", "JetBrains Mono", ui-monospace, Menlo, monospace'
const GENERIC_FAMILIES = new Set([
  'cursive',
  'emoji',
  'fantasy',
  'math',
  'monospace',
  'sans-serif',
  'serif',
  'system-ui',
  'ui-monospace',
  'ui-rounded',
  'ui-sans-serif',
  'ui-serif',
])

/** Quotes each family the user typed and appends the default stack, so a missing font falls back to it instead of serif. */
export function fontStack(family: string, fallback: string): string | null {
  const names = family
    .split(',')
    .map((name) => name.trim().replace(/^["']|["']$/g, ''))
    .filter(Boolean)
  if (names.length === 0) return null
  return [
    ...names.map((name) =>
      GENERIC_FAMILIES.has(name) ? name : JSON.stringify(name),
    ),
    fallback,
  ].join(', ')
}

function setRootProperty(name: string, value: string | null): void {
  const style = document.documentElement.style
  if (value) style.setProperty(name, value)
  else style.removeProperty(name)
}

function applyFontPreference(): void {
  current = parseFontPreference(window.localStorage.getItem(STORAGE_KEY))
  setRootProperty(
    '--ui-font-family',
    fontStack(current.uiFamily, UI_FONT_FALLBACK),
  )
  setRootProperty(
    '--ui-font-scale',
    current.uiSize === null
      ? null
      : String(current.uiSize / DEFAULT_UI_FONT_SIZE),
  )
  setRootProperty(
    '--code-font-family',
    fontStack(current.codeFamily, CODE_FONT_FALLBACK),
  )
  setRootProperty(
    '--code-font-size',
    current.codeSize === null ? null : `${current.codeSize}px`,
  )
  for (const listener of listeners) listener()
}

export function setFontPreference(change: Partial<FontPreference>): void {
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ ...current, ...change }),
  )
  applyFontPreference()
}

export function initializeFontPreference(): void {
  applyFontPreference()
  window.addEventListener('storage', (event) => {
    if (event.key === STORAGE_KEY || event.key === null) applyFontPreference()
  })
}

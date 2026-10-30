// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// why: the preference keeps module state, so each test loads a fresh copy.
async function loadPreference() {
  vi.resetModules()
  return import('./font-preference')
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

beforeEach(stubLocalStorage)

afterEach(() => {
  vi.unstubAllGlobals()
  document.documentElement.removeAttribute('style')
})

describe('parseFontPreference', () => {
  it('keeps trimmed families and in-range sizes', async () => {
    const { parseFontPreference } = await loadPreference()
    expect(
      parseFontPreference(
        JSON.stringify({
          codeFamily: ' Fira Code ',
          codeSize: 13.5,
          uiFamily: 'Inter',
          uiSize: 16,
        }),
      ),
    ).toEqual({
      codeFamily: 'Fira Code',
      codeSize: 13.5,
      uiFamily: 'Inter',
      uiSize: 16,
    })
  })

  it('drops out-of-range sizes, wrong types and broken JSON', async () => {
    const { parseFontPreference } = await loadPreference()
    const defaults = {
      codeFamily: '',
      codeSize: null,
      uiFamily: '',
      uiSize: null,
    }
    expect(
      parseFontPreference(
        JSON.stringify({ codeFamily: 3, codeSize: 2, uiSize: '14' }),
      ),
    ).toEqual(defaults)
    expect(parseFontPreference('{')).toEqual(defaults)
    expect(parseFontPreference(null)).toEqual(defaults)
  })
})

describe('setFontPreference', () => {
  it('sets root custom properties and removes them on reset', async () => {
    const {
      getFontPreference,
      initializeFontPreference,
      setFontPreference,
      subscribeFontPreference,
    } = await loadPreference()
    initializeFontPreference()
    const listener = vi.fn()
    subscribeFontPreference(listener)
    const style = document.documentElement.style

    setFontPreference({ codeSize: 14, uiFamily: 'Inter', uiSize: 21 })
    expect(style.getPropertyValue('--ui-font-family')).toBe('Inter')
    expect(style.getPropertyValue('--ui-font-scale')).toBe('1.5')
    expect(style.getPropertyValue('--code-font-size')).toBe('14px')
    expect(style.getPropertyValue('--code-font-family')).toBe('')
    expect(getFontPreference().uiSize).toBe(21)
    expect(listener).toHaveBeenCalledOnce()

    setFontPreference({ codeSize: null, uiFamily: '', uiSize: null })
    expect(style.getPropertyValue('--ui-font-family')).toBe('')
    expect(style.getPropertyValue('--ui-font-scale')).toBe('')
    expect(style.getPropertyValue('--code-font-size')).toBe('')
  })
})

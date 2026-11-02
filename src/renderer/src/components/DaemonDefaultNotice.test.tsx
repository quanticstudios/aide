// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import DaemonDefaultNotice from './DaemonDefaultNotice'

describe('DaemonDefaultNotice', () => {
  it('sits in the layout instead of floating over the sidebar footer', () => {
    const store = new Map<string, string>()
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        removeItem: (key: string) => store.delete(key),
        setItem: (key: string, value: string) => store.set(key, value),
      },
    })
    const markup = renderToStaticMarkup(<DaemonDefaultNotice />)
    expect(markup).toContain('Sessions now run on pitwall')
    expect(markup).not.toMatch(/class="[^"]*\b(fixed|absolute)\b/)
  })
})

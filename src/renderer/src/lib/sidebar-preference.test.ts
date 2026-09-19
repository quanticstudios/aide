import { describe, expect, it } from 'vitest'

import { resolveSidebarOpen } from './sidebar-preference'

describe('resolveSidebarOpen', () => {
  it('falls back to the global value while the workspace has no stored state', () => {
    expect(resolveSidebarOpen(null, true)).toBe(true)
    expect(resolveSidebarOpen(null, false)).toBe(false)
    expect(resolveSidebarOpen(undefined, true)).toBe(true)
  })

  it('prefers the workspace state over the global value', () => {
    expect(resolveSidebarOpen(false, true)).toBe(false)
    expect(resolveSidebarOpen(true, false)).toBe(true)
  })
})

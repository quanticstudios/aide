import { describe, expect, it } from 'vitest'

import { isAllowedPreviewUrl, normalizePreviewUrl } from './preview-target'

describe('normalizePreviewUrl', () => {
  it('falls back to the default local preview target', () => {
    expect(normalizePreviewUrl('')).toBe('http://127.0.0.1:4173')
  })

  it('prepends http for a bare localhost target', () => {
    expect(normalizePreviewUrl('localhost:3000')).toBe('http://localhost:3000')
  })
})

describe('isAllowedPreviewUrl', () => {
  it('allows localhost and loopback targets', () => {
    expect(isAllowedPreviewUrl('http://localhost:3000')).toBe(true)
    expect(isAllowedPreviewUrl('http://127.0.0.1:4173')).toBe(true)
  })

  it('rejects non-local or invalid targets', () => {
    expect(isAllowedPreviewUrl('https://example.com')).toBe(false)
    expect(isAllowedPreviewUrl('file:///tmp/index.html')).toBe(false)
    expect(isAllowedPreviewUrl('http://user@localhost:3000')).toBe(false)
    expect(isAllowedPreviewUrl('http://[::1]:4173')).toBe(true)
    expect(isAllowedPreviewUrl(`http://localhost/${'a'.repeat(2049)}`)).toBe(
      false,
    )
    expect(isAllowedPreviewUrl('not-a-url')).toBe(false)
  })
})

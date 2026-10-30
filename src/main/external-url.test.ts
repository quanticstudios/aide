import { describe, expect, it, vi } from 'vitest'

import { isAllowedExternalUrl, openAllowedExternalUrl } from './external-url'

describe('isAllowedExternalUrl', () => {
  it.each([
    'https://example.com/a?b=1#c',
    'http://localhost:3000',
    'mailto:dev@example.com',
    'HTTPS://EXAMPLE.COM',
  ])('allows %s', (url) => {
    expect(isAllowedExternalUrl(url)).toBe(true)
  })

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    ' javascript:alert(1)',
    'vscode://file/etc/passwd',
    'data:text/html,<script>alert(1)</script>',
    'ssh://host',
    'src/foo.ts',
    '//example.com',
    '',
    42,
    null,
  ])('refuses %s', (url) => {
    expect(isAllowedExternalUrl(url)).toBe(false)
  })
})

describe('openAllowedExternalUrl', () => {
  it('opens allowed URLs and logs refused ones', async () => {
    const openExternal = vi.fn(async () => undefined)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    await openAllowedExternalUrl('https://example.com', openExternal)
    await openAllowedExternalUrl('file:///etc/passwd', openExternal)

    expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://example.com')
    expect(warn).toHaveBeenCalledWith(
      'Refused to open external URL',
      'file:///etc/passwd',
    )
    warn.mockRestore()
  })
})

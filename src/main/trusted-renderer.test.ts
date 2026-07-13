import { describe, expect, it } from 'vitest'

import { isTrustedRendererUrl } from './trusted-renderer'

describe('isTrustedRendererUrl', () => {
  it('allows only the configured packaged renderer document', () => {
    const location = { rendererHtmlPath: '/opt/aide/out/renderer/index.html' }

    expect(
      isTrustedRendererUrl(
        'file:///opt/aide/out/renderer/index.html#diagnostics',
        location,
      ),
    ).toBe(true)
    expect(
      isTrustedRendererUrl('file:///home/user/untrusted.html', location),
    ).toBe(false)
    expect(
      isTrustedRendererUrl(
        'file://evil/opt/aide/out/renderer/index.html',
        location,
      ),
    ).toBe(false)
    expect(isTrustedRendererUrl('https://example.com/', location)).toBe(false)
  })

  it('allows only the configured development origin and path', () => {
    const location = {
      loadRendererUrl: 'http://127.0.0.1:5173/',
      rendererHtmlPath: '/unused/index.html',
    }

    expect(isTrustedRendererUrl('http://127.0.0.1:5173/#app', location)).toBe(
      true,
    )
    expect(isTrustedRendererUrl('http://127.0.0.1:5173/other', location)).toBe(
      false,
    )
    expect(isTrustedRendererUrl('http://localhost:5173/', location)).toBe(false)
    expect(
      isTrustedRendererUrl('http://user:secret@127.0.0.1:5173/', location),
    ).toBe(false)
  })
})

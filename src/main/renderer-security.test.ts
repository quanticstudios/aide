import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

import { describe, expect, it } from 'vitest'

const rendererHtml = readFileSync(
  resolve(import.meta.dirname, '../renderer/index.html'),
  'utf8',
)

describe('renderer security policy', () => {
  it('loads no remote fonts and defines an offline content security policy', () => {
    expect(rendererHtml).not.toMatch(
      /fonts\.googleapis\.com|fonts\.gstatic\.com/,
    )
    expect(rendererHtml).toContain('http-equiv="Content-Security-Policy"')
    expect(rendererHtml).toContain("default-src 'self'")
    expect(rendererHtml).toContain("object-src 'none'")
    expect(rendererHtml).toContain('ws://127.0.0.1:*')
  })

  it('lets remote https images in without opening scripts or plain http images', () => {
    const policy = Object.fromEntries(
      (
        /Content-Security-Policy"\s+content="([^"]+)"/.exec(
          rendererHtml,
        )?.[1] ?? ''
      )
        .split(';')
        .map((directive) => directive.trim().split(/\s+/))
        .map(([name = '', ...sources]) => [name, sources]),
    )
    expect(policy['script-src']).toEqual(["'self'"])
    expect(policy['img-src']).toEqual(["'self'", 'data:', 'https:'])
    expect(policy['default-src']).toEqual(["'self'"])
  })
})

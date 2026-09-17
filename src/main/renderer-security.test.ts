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
})

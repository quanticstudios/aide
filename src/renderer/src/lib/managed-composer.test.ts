import { describe, expect, it } from 'vitest'
import {
  createPastedTextAttachment,
  fitImageWithin,
  PASTE_ATTACHMENT_THRESHOLD,
} from './managed-composer'

describe('createPastedTextAttachment', () => {
  it('keeps pastes up to the threshold inline', () => {
    expect(
      createPastedTextAttachment('x'.repeat(PASTE_ATTACHMENT_THRESHOLD), []),
    ).toBeNull()
  })

  it('turns a 20 KB paste into a numbered text attachment with the full text', () => {
    const text = 'y'.repeat(20 * 1024)
    const existing = [
      {
        id: 'a',
        kind: 'pasted-text' as const,
        name: 'pasted-text-1.txt',
        text,
      },
    ]
    expect(createPastedTextAttachment(text, existing)).toEqual({
      id: expect.any(String),
      kind: 'pasted-text',
      name: 'pasted-text-2.txt',
      text,
    })
  })

  it('rejects a paste over 256 KB', () => {
    expect(() =>
      createPastedTextAttachment('z'.repeat(256 * 1024 + 1), []),
    ).toThrow('256 KB')
  })
})

describe('fitImageWithin', () => {
  it('scales the long side of a 6000x4000 screenshot to 2048 px', () => {
    expect(fitImageWithin(6000, 4000)).toEqual({ height: 1365, width: 2048 })
    expect(fitImageWithin(1000, 9000)).toEqual({ height: 2048, width: 228 })
  })

  it('never upscales', () => {
    expect(fitImageWithin(800, 600)).toEqual({ height: 600, width: 800 })
    expect(fitImageWithin(2048, 2048)).toEqual({ height: 2048, width: 2048 })
  })
})

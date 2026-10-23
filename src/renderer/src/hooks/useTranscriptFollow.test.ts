import { describe, expect, it } from 'vitest'

import { pinSpacerHeight } from './useTranscriptFollow'

describe('pinSpacerHeight', () => {
  it('adds the trailing space a short message needs to reach the top', () => {
    expect(
      pinSpacerHeight({ clientHeight: 600, contentEnd: 1200, pinTop: 1100 }),
    ).toBe(500)
  })

  it('releases the pin once the reply fills the viewport below the message', () => {
    expect(
      pinSpacerHeight({ clientHeight: 600, contentEnd: 1700, pinTop: 1100 }),
    ).toBe(0)
    expect(
      pinSpacerHeight({ clientHeight: 600, contentEnd: 2400, pinTop: 1100 }),
    ).toBe(0)
  })
})

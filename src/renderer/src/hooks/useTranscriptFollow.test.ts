import { describe, expect, it } from 'vitest'

import { pinSpacerHeight, releasePin } from './useTranscriptFollow'

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

describe('releasePin', () => {
  it('clears a pending and an active pin and removes the trailing space', () => {
    const pin = { active: true, pending: { previous: null }, spacer: 320 }
    const content = { style: { paddingBottom: '320px' } }

    releasePin(pin, content)

    expect(pin).toEqual({ active: false, pending: null, spacer: 0 })
    expect(content.style.paddingBottom).toBe('')
  })
})

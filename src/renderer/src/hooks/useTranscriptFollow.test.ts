import { describe, expect, it } from 'vitest'

import {
  jumpToLatest,
  leftBottom,
  pinSpacerHeight,
  releasePin,
} from './useTranscriptFollow'

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

describe('jumpToLatest', () => {
  it('drops an active pin and its trailing space before scrolling to the bottom', () => {
    const pin = { active: true, pending: { previous: null }, spacer: 320 }
    const content = { style: { paddingBottom: '320px' } }
    const scroll = { scrollHeight: 2400, scrollTop: 1100 }

    jumpToLatest(pin, content, scroll)

    expect(pin).toEqual({ active: false, pending: null, spacer: 0 })
    expect(content.style.paddingBottom).toBe('')
    expect(scroll.scrollTop).toBe(2400)
  })
})

describe('leftBottom', () => {
  it('ignores a clamp at the bottom that the next stream chunk outgrew', () => {
    expect(
      leftBottom({
        clientHeight: 700,
        previousScrollHeight: 109_258,
        previousScrollTop: 108_557,
        scrollHeight: 127_778,
        scrollTop: 108_538,
      }),
    ).toBe(false)
  })

  it('counts a scroll up away from the bottom', () => {
    expect(
      leftBottom({
        clientHeight: 700,
        previousScrollHeight: 109_258,
        previousScrollTop: 108_557,
        scrollHeight: 127_778,
        scrollTop: 100_000,
      }),
    ).toBe(true)
  })

  it('ignores a scroll up that ends near the bottom', () => {
    expect(
      leftBottom({
        clientHeight: 700,
        previousScrollHeight: 2400,
        previousScrollTop: 1700,
        scrollHeight: 2400,
        scrollTop: 1670,
      }),
    ).toBe(false)
  })
})

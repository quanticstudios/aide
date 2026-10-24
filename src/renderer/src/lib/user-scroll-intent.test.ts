// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest'

import { onUserScrollIntent } from './user-scroll-intent'

function setup() {
  const scroll = document.createElement('div')
  const child = document.createElement('p')
  scroll.append(child)
  const onIntent = vi.fn()
  const stop = onUserScrollIntent(scroll, onIntent)
  return { child, onIntent, scroll, stop }
}

describe('onUserScrollIntent', () => {
  const intents: [string, () => Event][] = [
    ['wheel', () => new WheelEvent('wheel', { bubbles: true })],
    ['pointerdown', () => new PointerEvent('pointerdown', { bubbles: true })],
    ...['PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown', ' '].map(
      (key): [string, () => Event] => [
        `keydown ${key}`,
        () => new KeyboardEvent('keydown', { bubbles: true, key }),
      ],
    ),
  ]

  it.each(
    intents,
  )('fires once on %s from inside the scroller', (_, createEvent) => {
    const { child, onIntent } = setup()

    child.dispatchEvent(createEvent())
    child.dispatchEvent(createEvent())

    expect(onIntent).toHaveBeenCalledTimes(1)
  })

  it('ignores keys that do not scroll', () => {
    const { child, onIntent } = setup()

    child.dispatchEvent(
      new KeyboardEvent('keydown', { bubbles: true, key: 'a' }),
    )

    expect(onIntent).not.toHaveBeenCalled()
  })

  it('stops listening once stopped', () => {
    const { onIntent, scroll, stop } = setup()

    stop()
    scroll.dispatchEvent(new WheelEvent('wheel'))

    expect(onIntent).not.toHaveBeenCalled()
  })
})

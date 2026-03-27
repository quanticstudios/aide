import { describe, expect, it } from 'vitest'

import { mapInputToShortcutEvent } from './app-shortcuts'

describe('mapInputToShortcutEvent', () => {
  it('maps Ctrl+Tab to the overview shell', () => {
    expect(
      mapInputToShortcutEvent({
        alt: false,
        code: 'Tab',
        control: true,
        key: 'Tab',
        meta: false,
      }),
    ).toEqual({ type: 'overview-open' })
  })

  it('maps Alt+h/l and Alt+arrow keys to pane navigation', () => {
    expect(
      mapInputToShortcutEvent({
        alt: true,
        code: 'KeyH',
        control: false,
        key: 'h',
        meta: false,
      }),
    ).toEqual({ type: 'pane-previous' })

    expect(
      mapInputToShortcutEvent({
        alt: true,
        code: 'ArrowRight',
        control: false,
        key: 'ArrowRight',
        meta: false,
      }),
    ).toEqual({ type: 'pane-next' })
  })

  it('maps Alt+j/k and Alt+arrow keys to workspace navigation', () => {
    expect(
      mapInputToShortcutEvent({
        alt: true,
        code: 'KeyJ',
        control: false,
        key: 'j',
        meta: false,
      }),
    ).toEqual({ type: 'workspace-next' })

    expect(
      mapInputToShortcutEvent({
        alt: true,
        code: 'ArrowUp',
        control: false,
        key: 'ArrowUp',
        meta: false,
      }),
    ).toEqual({ type: 'workspace-previous' })
  })

  it('maps Ctrl+digit to project jump', () => {
    expect(
      mapInputToShortcutEvent({
        alt: false,
        code: 'Digit3',
        control: true,
        key: '3',
        meta: false,
      }),
    ).toEqual({ projectIndex: 2, type: 'project-jump' })
  })

  it('ignores unrelated keys', () => {
    expect(
      mapInputToShortcutEvent({
        alt: false,
        code: 'KeyH',
        control: false,
        key: 'h',
        meta: false,
      }),
    ).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'

import {
  type ShortcutInput,
  mapShortcutInputToAppEvent,
  shouldBlockTerminalShortcutInput,
} from './shortcuts'

function createInput(
  input: Partial<ShortcutInput> & Pick<ShortcutInput, 'key'>,
): ShortcutInput {
  const { key, ...rest } = input

  return {
    alt: false,
    code: input.code ?? key,
    control: false,
    key,
    meta: false,
    ...rest,
  }
}

describe('mapShortcutInputToAppEvent', () => {
  it('maps the existing shell navigation shortcuts', () => {
    expect(
      mapShortcutInputToAppEvent(
        createInput({ alt: true, code: 'KeyH', key: 'h' }),
      ),
    ).toEqual({ type: 'pane-previous' })

    expect(
      mapShortcutInputToAppEvent(
        createInput({ alt: true, code: 'ArrowDown', key: 'ArrowDown' }),
      ),
    ).toEqual({ type: 'workspace-next' })

    expect(
      mapShortcutInputToAppEvent(
        createInput({ control: true, code: 'Digit2', key: '2' }),
      ),
    ).toEqual({ projectIndex: 1, type: 'project-jump' })

    expect(
      mapShortcutInputToAppEvent(
        createInput({ control: true, code: 'Tab', key: 'Tab' }),
      ),
    ).toEqual({ type: 'overview-open' })
  })

  it('ignores unrelated keys', () => {
    expect(
      mapShortcutInputToAppEvent(createInput({ key: 'x', code: 'KeyX' })),
    ).toBeNull()
  })
})

describe('shouldBlockTerminalShortcutInput', () => {
  it('blocks shell-owned shortcuts from terminal input', () => {
    expect(
      shouldBlockTerminalShortcutInput(
        createInput({ alt: true, code: 'ArrowLeft', key: 'ArrowLeft' }),
      ),
    ).toBe(true)

    expect(
      shouldBlockTerminalShortcutInput(
        createInput({ control: true, code: 'Digit3', key: '3' }),
      ),
    ).toBe(true)

    expect(
      shouldBlockTerminalShortcutInput(
        createInput({ meta: true, code: 'Tab', key: 'Tab' }),
      ),
    ).toBe(true)
  })

  it('blocks default Super or Meta navigation aliases for window managers', () => {
    expect(
      shouldBlockTerminalShortcutInput(
        createInput({ meta: true, code: 'ArrowRight', key: 'ArrowRight' }),
      ),
    ).toBe(true)

    expect(
      shouldBlockTerminalShortcutInput(
        createInput({ meta: true, code: 'KeyH', key: 'h' }),
      ),
    ).toBe(true)
  })

  it('allows normal terminal input and unrelated modifier chords', () => {
    expect(
      shouldBlockTerminalShortcutInput(createInput({ code: 'KeyA', key: 'a' })),
    ).toBe(false)

    expect(
      shouldBlockTerminalShortcutInput(
        createInput({ meta: true, code: 'KeyP', key: 'p' }),
      ),
    ).toBe(false)
  })
})

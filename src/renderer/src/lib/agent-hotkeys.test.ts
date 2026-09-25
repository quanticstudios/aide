import { describe, expect, it } from 'vitest'

import {
  type AgentHotkeyContext,
  type AgentHotkeyEvent,
  resolveAgentHotkey,
} from './agent-hotkeys'

const runningContext: AgentHotkeyContext = {
  isMac: false,
  isMenuOpen: false,
  isTurnRunning: true,
}

function keyEvent(
  key: string,
  modifiers: Partial<AgentHotkeyEvent> = {},
): AgentHotkeyEvent {
  return {
    altKey: false,
    ctrlKey: false,
    key,
    metaKey: false,
    shiftKey: false,
    ...modifiers,
  }
}

describe('resolveAgentHotkey', () => {
  it('interrupts on a bare Escape while a turn runs', () => {
    expect(resolveAgentHotkey(keyEvent('Escape'), runningContext)).toBe(
      'interrupt',
    )
  })

  it('leaves Escape alone for menus, idle turns, and modifier combinations', () => {
    expect(
      resolveAgentHotkey(keyEvent('Escape'), {
        ...runningContext,
        isMenuOpen: true,
      }),
    ).toBeNull()
    expect(
      resolveAgentHotkey(keyEvent('Escape'), {
        ...runningContext,
        isTurnRunning: false,
      }),
    ).toBeNull()
    expect(
      resolveAgentHotkey(
        keyEvent('Escape', { shiftKey: true }),
        runningContext,
      ),
    ).toBeNull()
  })

  it('opens the composer menus on Ctrl+Shift+M/E/A', () => {
    const chord = { ctrlKey: true, shiftKey: true }
    expect(resolveAgentHotkey(keyEvent('M', chord), runningContext)).toBe(
      'open-model-menu',
    )
    expect(resolveAgentHotkey(keyEvent('E', chord), runningContext)).toBe(
      'open-effort-menu',
    )
    expect(resolveAgentHotkey(keyEvent('A', chord), runningContext)).toBe(
      'open-permission-menu',
    )
  })

  it('reads Meta instead of Ctrl on macOS', () => {
    const macContext = { ...runningContext, isMac: true }
    expect(
      resolveAgentHotkey(
        keyEvent('m', { metaKey: true, shiftKey: true }),
        macContext,
      ),
    ).toBe('open-model-menu')
    expect(
      resolveAgentHotkey(
        keyEvent('m', { ctrlKey: true, shiftKey: true }),
        macContext,
      ),
    ).toBeNull()
    expect(
      resolveAgentHotkey(
        keyEvent('m', { metaKey: true, shiftKey: true }),
        runningContext,
      ),
    ).toBeNull()
  })

  it('ignores chords that miss Shift, add Alt, or hit an unbound key', () => {
    expect(
      resolveAgentHotkey(keyEvent('m', { ctrlKey: true }), runningContext),
    ).toBeNull()
    expect(
      resolveAgentHotkey(
        keyEvent('m', { altKey: true, ctrlKey: true, shiftKey: true }),
        runningContext,
      ),
    ).toBeNull()
    expect(
      resolveAgentHotkey(
        keyEvent('j', { ctrlKey: true, shiftKey: true }),
        runningContext,
      ),
    ).toBeNull()
  })

  it('keeps the composer menus reachable while a menu is open or the session idles', () => {
    expect(
      resolveAgentHotkey(keyEvent('M', { ctrlKey: true, shiftKey: true }), {
        isMac: false,
        isMenuOpen: true,
        isTurnRunning: false,
      }),
    ).toBe('open-model-menu')
  })
})

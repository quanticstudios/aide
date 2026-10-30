import { describe, expect, it } from 'vitest'

import { readTerminalTheme, terminalFont } from './terminal-theme'

describe('readTerminalTheme', () => {
  it('reads each ANSI slot from its token and keeps the pane background', () => {
    const tokens: Record<string, string> = {
      '--accent-purple': ' #7a45d6',
      '--terminal-cyan': '#0f6e85',
      '--terminal-white': '#5c6370',
    }
    const theme = readTerminalTheme({
      getPropertyValue: (name: string) => tokens[name] ?? '',
    })
    expect(theme.background).toBe('transparent')
    expect(theme.magenta).toBe('#7a45d6')
    expect(theme.brightMagenta).toBe('#7a45d6')
    expect(theme.cyan).toBe('#0f6e85')
    expect(theme.white).toBe('#5c6370')
  })
})

describe('terminalFont', () => {
  const defaults = {
    codeFamily: '',
    codeSize: null,
    uiFamily: '',
    uiSize: null,
  }

  it('keeps JetBrains Mono at 13px until a code font is set', () => {
    expect(terminalFont(defaults)).toEqual({
      fontFamily:
        'JetBrains Mono, JetBrainsMono Nerd Font, MesloLGS NF, Symbols Nerd Font Mono, monospace',
      fontSize: 13,
    })
  })

  it('puts the code font first and keeps the Nerd Font fallbacks', () => {
    const font = terminalFont({
      ...defaults,
      codeFamily: 'Fira Code',
      codeSize: 15,
    })
    expect(
      font.fontFamily.startsWith('Fira Code, JetBrainsMono Nerd Font'),
    ).toBe(true)
    expect(font.fontSize).toBe(15)
  })
})

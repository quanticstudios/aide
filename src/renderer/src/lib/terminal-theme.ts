import type { ITheme } from 'xterm'

import type { FontPreference } from './font-preference'

// The ANSI slots the state accents already cover read the accents, so a palette restyles both together.
const TERMINAL_TOKENS = {
  black: '--terminal-black',
  blue: '--accent-blue',
  brightBlack: '--terminal-bright-black',
  brightBlue: '--accent-blue',
  brightCyan: '--terminal-cyan',
  brightGreen: '--accent-green',
  brightMagenta: '--accent-purple',
  brightRed: '--accent-red',
  brightWhite: '--terminal-bright-white',
  brightYellow: '--accent-yellow',
  cursor: '--foreground',
  cursorAccent: '--background',
  cyan: '--terminal-cyan',
  foreground: '--foreground',
  green: '--accent-green',
  magenta: '--accent-purple',
  red: '--accent-red',
  selectionBackground: '--terminal-selection',
  white: '--terminal-white',
  yellow: '--accent-yellow',
} as const satisfies Partial<Record<keyof ITheme, string>>

const TERMINAL_FONT_FALLBACK =
  'JetBrainsMono Nerd Font, MesloLGS NF, Symbols Nerd Font Mono, monospace'
const TERMINAL_FONT_SIZE = 13

/** xterm takes concrete colors, so this reads the active palette's tokens off the root element. */
export function readTerminalTheme(
  style: Pick<CSSStyleDeclaration, 'getPropertyValue'>,
): ITheme {
  const theme: ITheme = { background: 'transparent' }
  for (const [slot, token] of Object.entries(TERMINAL_TOKENS)) {
    theme[slot as keyof typeof TERMINAL_TOKENS] = style
      .getPropertyValue(token)
      .trim()
  }
  return theme
}

/** The code font when one is set, keeping Nerd Font fallbacks for prompt glyphs. */
export function terminalFont(fonts: FontPreference): {
  fontFamily: string
  fontSize: number
} {
  return {
    fontFamily: `${fonts.codeFamily || 'JetBrains Mono'}, ${TERMINAL_FONT_FALLBACK}`,
    fontSize: fonts.codeSize ?? TERMINAL_FONT_SIZE,
  }
}

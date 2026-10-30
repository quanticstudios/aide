export interface AnsiSegment {
  readonly className: string
  readonly text: string
}

const FOREGROUND: Record<number, string> = {
  30: 'text-muted-foreground',
  31: 'text-accent-red',
  32: 'text-accent-green',
  33: 'text-accent-yellow',
  34: 'text-accent-blue',
  35: 'text-accent-purple',
  36: 'text-cyan-500',
  37: 'text-foreground',
}

// why: ESC [ ... letter covers SGR and cursor moves; ESC ] ... BEL/ST covers OSC titles and hyperlinks.
const ESCAPE =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escapes are control characters.
  /\u001b\[([\d;?]*)([A-Za-z])|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g

/** Splits terminal output into text runs with Tailwind classes for its SGR colors; drops every other escape. */
export function parseAnsi(input: string): AnsiSegment[] {
  const segments: AnsiSegment[] = []
  let foreground = ''
  let bold = false
  let dim = false
  let italic = false
  let underline = false
  let cursor = 0
  const push = (text: string) => {
    if (!text) return
    const className = [
      foreground,
      bold && 'font-bold',
      dim && 'opacity-70',
      italic && 'italic',
      underline && 'underline',
    ]
      .filter(Boolean)
      .join(' ')
    const previous = segments.at(-1)
    if (previous?.className === className) {
      segments[segments.length - 1] = {
        className,
        text: previous.text + text,
      }
    } else {
      segments.push({ className, text })
    }
  }

  for (const match of input.matchAll(ESCAPE)) {
    push(input.slice(cursor, match.index))
    cursor = match.index + match[0].length
    if (match[2] !== 'm') continue
    const codes = (match[1] || '0').split(';').map(Number)
    for (let index = 0; index < codes.length; index += 1) {
      const code = codes[index] ?? 0
      if (code === 0) {
        foreground = ''
        bold = dim = italic = underline = false
      } else if (code === 1) bold = true
      else if (code === 2) dim = true
      else if (code === 3) italic = true
      else if (code === 4) underline = true
      else if (code === 22) bold = dim = false
      else if (code === 23) italic = false
      else if (code === 24) underline = false
      else if (code === 39) foreground = ''
      else if (FOREGROUND[code]) foreground = FOREGROUND[code]
      else if (FOREGROUND[code - 60]) foreground = FOREGROUND[code - 60]
      // shortcut: 256-color and truecolor runs (38/48;5;n, 38/48;2;r;g;b) are skipped, not drawn; map them if tools lean on them.
      else if (code === 38 || code === 48)
        index += codes[index + 1] === 5 ? 2 : 4
    }
  }
  push(input.slice(cursor))
  return segments
}

import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
export const RENDERER_PATH = path.join(root, 'src/renderer')
export const TOKEN_FILE = path.join(RENDERER_PATH, 'src/styles.css')

// The function names may follow `_` in a Tailwind arbitrary value such as shadow-[0_2px_rgba(...)].
const LITERAL =
  /#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\b|(?<![a-z-])(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(|['"](?:white|black)['"]/i
// Bare keywords count only in CSS, where prose cannot contain them.
const CSS_KEYWORD = /(?<![\w-])(?:white|black)(?![\w-])/i
// Tailwind palette classes; a shade or white/black, so token names like bg-stone stay allowed.
const TAILWIND_PALETTE =
  /\b(?:bg|text|border|ring|outline|fill|stroke|from|via|to|shadow|divide|decoration|caret|accent|placeholder)-(?:(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}|white|black)\b/

/** Lines outside the token file that write a color literally instead of reading a token. */
export function sourceViolations(source, isCss = false) {
  return source
    .split('\n')
    .map((line, index) => ({ line: index + 1, text: line.trim() }))
    .filter(
      ({ text }) =>
        LITERAL.test(text) ||
        TAILWIND_PALETTE.test(text) ||
        (isCss && CSS_KEYWORD.test(text)),
    )
}

/** Declarations in the token file that use a color literal outside a custom property definition. */
export function tokenFileViolations(css) {
  return (
    css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split(/[;{}]/)
      .map((chunk) => chunk.trim())
      .filter((chunk) => LITERAL.test(chunk) || CSS_KEYWORD.test(chunk))
      .filter((chunk) => !/^--[a-z][a-z0-9-]*\s*:/.test(chunk))
      // why: a mask reads only alpha, so its black is not a color.
      .filter((chunk) => !/^(?:-webkit-)?mask(?:-image)?\s*:/.test(chunk))
  )
}

async function rendererSources(directory) {
  const entries = await readdir(directory, { withFileTypes: true })
  const files = await Promise.all(
    entries.map((entry) => {
      const target = path.join(directory, entry.name)
      if (entry.isDirectory()) return rendererSources(target)
      return /\.(css|html|tsx?)$/.test(entry.name) &&
        !/\.test\.tsx?$/.test(entry.name)
        ? [target]
        : []
    }),
  )
  return files.flat()
}

export async function colorLiteralViolations() {
  const violations = []
  for (const file of await rendererSources(RENDERER_PATH)) {
    const source = await readFile(file, 'utf8')
    const relative = path.relative(root, file)
    if (file === TOKEN_FILE) {
      for (const chunk of tokenFileViolations(source)) {
        violations.push(`${relative}: ${chunk.split('\n')[0]}`)
      }
    } else {
      for (const { line, text } of sourceViolations(
        source,
        file.endsWith('.css'),
      )) {
        violations.push(`${relative}:${line}: ${text}`)
      }
    }
  }
  return violations
}

if (import.meta.main) {
  const violations = await colorLiteralViolations()
  for (const violation of violations) {
    process.stderr.write(`${violation}\n`)
  }
  if (violations.length > 0) {
    process.stderr.write(
      'Define colors as custom properties in src/renderer/src/styles.css and read them with var() or a Tailwind token class.\n',
    )
    process.exitCode = 1
  } else {
    process.stdout.write('No color literal outside the token file.\n')
  }
}

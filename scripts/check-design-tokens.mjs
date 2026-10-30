import { readFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
export const DESIGN_PATH = path.join(root, 'DESIGN.md')
export const STYLES_PATH = path.join(root, 'src/renderer/src/styles.css')

// A definition is a custom property at the start of a declaration line.
export function definedTokens(css) {
  return new Set(
    [...css.matchAll(/^\s*(--[a-z][a-z0-9-]*)\s*:/gm)].map((match) => match[1]),
  )
}

// The doc names a token anywhere it writes --name, so prose, tables and code all count.
export function documentedTokens(markdown) {
  return new Set(
    [...markdown.matchAll(/(?<![\w-])--[a-z][a-z0-9-]*/g)].map(
      (match) => match[0],
    ),
  )
}

export function compareTokens(css, markdown) {
  const defined = definedTokens(css)
  const documented = documentedTokens(markdown)
  return {
    missingFromStyles: [...documented].filter((name) => !defined.has(name)),
    missingFromDesign: [...defined].filter((name) => !documented.has(name)),
  }
}

if (import.meta.main) {
  const [css, markdown] = await Promise.all([
    readFile(STYLES_PATH, 'utf8'),
    readFile(DESIGN_PATH, 'utf8'),
  ])
  const { missingFromStyles, missingFromDesign } = compareTokens(css, markdown)
  for (const name of missingFromStyles) {
    process.stderr.write(
      `DESIGN.md names ${name}, which styles.css does not define.\n`,
    )
  }
  for (const name of missingFromDesign) {
    process.stderr.write(
      `styles.css defines ${name}, which DESIGN.md does not name.\n`,
    )
  }
  if (missingFromStyles.length + missingFromDesign.length > 0) {
    process.exitCode = 1
  } else {
    process.stdout.write('DESIGN.md and styles.css name the same tokens.\n')
  }
}

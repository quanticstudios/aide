import { readFile } from 'node:fs/promises'
import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
export const STYLES_PATH = path.join(root, 'src/renderer/src/styles.css')

export const PALETTES = ['contrast', 'dark', 'light']

const SURFACES = [
  '--background',
  '--surface',
  '--surface-1',
  '--surface-2',
  '--popover',
]
const STATUS = [
  '--accent-blue',
  '--accent-green',
  '--accent-yellow',
  '--accent-red',
  '--accent-purple',
  '--accent-peach',
  '--destructive',
]
const SYNTAX = [
  '--shiki-token-comment',
  '--shiki-token-constant',
  '--shiki-token-function',
  '--shiki-token-keyword',
  '--shiki-token-link',
  '--shiki-token-parameter',
  '--shiki-token-punctuation',
  '--shiki-token-string',
  '--shiki-token-string-expression',
]

/** Each pair is a text token over a stack of background layers, bottom first. WCAG AA asks 4.5:1 for body text. */
export const PAIRS = [
  ...['--foreground', '--body', '--muted-foreground', '--primary-on-dark']
    .concat(STATUS)
    .flatMap((text) => SURFACES.map((surface) => [text, [surface]])),
  ...STATUS.filter((status) => status !== '--destructive').map((status) => [
    status,
    ['--surface', `${status}-soft`],
  ]),
  ...SYNTAX.map((token) => [token, ['--surface-1']]),
  ['--terminal-cyan', ['--background']],
  ['--terminal-white', ['--background']],
  ['--primary-foreground', ['--primary']],
  ['--field-foreground', ['--field-background']],
  ['--field-placeholder', ['--field-background']],
  ['--sidebar-foreground', ['--sidebar']],
]

const MIN_RATIO = 4.5

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '')
}

function declarations(body) {
  const tokens = new Map()
  for (const match of body.matchAll(/(--[a-z][a-z0-9-]*)\s*:\s*([^;]+);/g)) {
    tokens.set(match[1], match[2].trim())
  }
  return tokens
}

/** Custom properties per palette: the base block carries "contrast", the others override it. */
export function paletteTokens(css) {
  const base = new Map()
  const overrides = Object.fromEntries(
    PALETTES.map((name) => [name, new Map()]),
  )
  for (const match of stripComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // why: the text before a block can end with earlier at-rule statements.
    const selectors = match[1]
      .split(';')
      .at(-1)
      .split(',')
      .map((selector) => selector.trim())
    const body = declarations(match[2])
    if (selectors.includes(':root')) {
      for (const [name, value] of body) base.set(name, value)
    }
    for (const name of PALETTES) {
      if (selectors.includes(`[data-palette="${name}"]`)) {
        for (const [token, value] of body) overrides[name].set(token, value)
      }
    }
  }
  return Object.fromEntries(
    PALETTES.map((name) => [name, new Map([...base, ...overrides[name]])]),
  )
}

export function parseColor(value) {
  const hex = value.match(/^#([0-9a-f]{3,8})$/i)?.[1]
  if (hex && [3, 4, 6, 8].includes(hex.length)) {
    const digits =
      hex.length <= 4
        ? [...hex].map((digit) => digit + digit)
        : hex.match(/../g)
    const [r, g, b, a = 255] = digits.map((pair) => Number.parseInt(pair, 16))
    return { r, g, b, a: a / 255 }
  }
  const rgb = value.match(/^rgba?\(([^)]+)\)$/i)?.[1]
  if (rgb) {
    const [r, g, b, a = 1] = rgb
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(Number)
    return { r, g, b, a }
  }
  throw new Error(`Cannot parse color ${value}`)
}

function resolve(tokens, name, seen = new Set()) {
  if (seen.has(name)) throw new Error(`${name} refers to itself`)
  const value = tokens.get(name)
  if (value === undefined) throw new Error(`${name} is not defined`)
  const reference = value.match(/^var\((--[a-z0-9-]+)\)$/)?.[1]
  return reference ? resolve(tokens, reference, seen.add(name)) : value
}

function over(top, bottom) {
  const mix = (channel) => top[channel] * top.a + bottom[channel] * (1 - top.a)
  return { r: mix('r'), g: mix('g'), b: mix('b'), a: 1 }
}

function luminance({ r, g, b }) {
  const linear = (channel) => {
    const value = channel / 255
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b)
}

export function contrastRatio(text, background) {
  const [light, dark] = [luminance(text), luminance(background)].sort(
    (a, b) => b - a,
  )
  return (light + 0.05) / (dark + 0.05)
}

/** Ratios below AA for every pair in every palette. Translucent layers sit on --background. */
export function contrastFailures(css) {
  const failures = []
  for (const [palette, tokens] of Object.entries(paletteTokens(css))) {
    const color = (name) => parseColor(resolve(tokens, name))
    const canvas = color('--background')
    for (const [text, layers] of PAIRS) {
      const background = layers.reduce(
        (below, layer) => over(color(layer), below),
        canvas,
      )
      const ratio = contrastRatio(over(color(text), background), background)
      if (ratio < MIN_RATIO) {
        failures.push({ background: layers.join(' + '), palette, ratio, text })
      }
    }
  }
  return failures
}

if (import.meta.main) {
  const failures = contrastFailures(await readFile(STYLES_PATH, 'utf8'))
  for (const { background, palette, ratio, text } of failures) {
    process.stderr.write(
      `${palette}: ${text} on ${background} is ${ratio.toFixed(2)}:1, below ${MIN_RATIO}:1.\n`,
    )
  }
  if (failures.length > 0) {
    process.exitCode = 1
  } else {
    process.stdout.write('Every palette passes WCAG AA for its text pairs.\n')
  }
}

import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  contrastFailures,
  contrastRatio,
  PAIRS,
  paletteTokens,
  parseColor,
  STYLES_PATH,
} from './check-contrast.mjs'

test('parses hex and rgba colors', () => {
  assert.deepEqual(parseColor('#fff'), { a: 1, b: 255, g: 255, r: 255 })
  assert.deepEqual(parseColor('#00000080').a, 128 / 255)
  assert.deepEqual(parseColor('rgba(20, 22, 27, 0.1)'), {
    a: 0.1,
    b: 27,
    g: 22,
    r: 20,
  })
  assert.throws(() => parseColor('oklch(50% 0.1 20)'))
})

test('matches the WCAG ratios for black and white', () => {
  const ratio = contrastRatio(parseColor('#000'), parseColor('#fff'))
  assert.equal(ratio.toFixed(2), '21.00')
  assert.equal(
    contrastRatio(parseColor('#777'), parseColor('#fff')) < 4.5,
    true,
  )
})

test('palettes override the base block, and data-palette blocks count without :root', () => {
  const css = `@import "x";
:root,
[data-palette="contrast"] { --a: #000; --b: #fff; }
[data-palette="light"] { --a: #fff; }
:root[data-motion="reduced"] * { --a: #f00; }`
  const palettes = paletteTokens(css)
  assert.equal(palettes.contrast.get('--a'), '#000')
  assert.equal(palettes.dark.get('--a'), '#000')
  assert.equal(palettes.light.get('--a'), '#fff')
  assert.equal(palettes.light.get('--b'), '#fff')
})

test('reports a pair that drops below AA, compositing translucent layers', () => {
  const texts = PAIRS.map(([text]) => `${text}: #ffffff;`)
  const layers = PAIRS.flatMap(([, stack]) =>
    stack.map((layer) => `${layer}: #000000;`),
  )
  const css = `:root { ${[...texts, ...layers].join(' ')} }
[data-palette="light"] { --muted-foreground: rgba(255, 255, 255, 0.2); }`
  const failures = contrastFailures(css)
  assert.equal(failures.length > 0, true)
  for (const failure of failures) {
    assert.equal(failure.palette, 'light')
    assert.equal(failure.text, '--muted-foreground')
  }
})

test('every palette in styles.css passes AA for its text pairs', async () => {
  assert.deepEqual(contrastFailures(await readFile(STYLES_PATH, 'utf8')), [])
})

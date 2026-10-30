import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import {
  compareTokens,
  DESIGN_PATH,
  definedTokens,
  documentedTokens,
  STYLES_PATH,
} from './check-design-tokens.mjs'

test('reads definitions, not var() reads', () => {
  const css = ':root {\n  --surface-1: #141416;\n  --ring: var(--primary);\n}\n'
  assert.deepEqual([...definedTokens(css)], ['--surface-1', '--ring'])
})

test('finds tokens in prose, tables and code, but not in single-dash words', () => {
  const markdown =
    'Use `--surface-1`.\n\n| `--ring` | x |\n|---|---|\n\nvar(--t-fast), -webkit-font-smoothing\n'
  assert.deepEqual(
    [...documentedTokens(markdown)],
    ['--surface-1', '--ring', '--t-fast'],
  )
})

test('reports names missing from either side', () => {
  assert.deepEqual(
    compareTokens(':root {\n  --a: 1;\n  --b: 2;\n}\n', '`--a` `--c`'),
    { missingFromStyles: ['--c'], missingFromDesign: ['--b'] },
  )
})

test('DESIGN.md and styles.css name the same tokens', async () => {
  const [css, markdown] = await Promise.all([
    readFile(STYLES_PATH, 'utf8'),
    readFile(DESIGN_PATH, 'utf8'),
  ])
  assert.deepEqual(compareTokens(css, markdown), {
    missingFromStyles: [],
    missingFromDesign: [],
  })
})

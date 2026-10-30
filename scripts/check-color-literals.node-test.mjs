import assert from 'node:assert/strict'
import test from 'node:test'

import {
  colorLiteralViolations,
  sourceViolations,
  tokenFileViolations,
} from './check-color-literals.mjs'

test('flags hex, color functions and Tailwind palette classes in components', () => {
  const source = [
    "const a = '#1c1f26'",
    'className="shadow-[0_2px_rgba(0,0,0,0.4)]"',
    "className='bg-red-500 text-white'",
    "className='bg-black/50'",
    "style={{ color: 'white' }}",
    "className='bg-stone text-accent-red bg-scrim'",
    "const hint = 'Pure black canvas'",
    "const mix = 'color-mix(in_srgb,var(--shadow-color)_40%,transparent)'",
  ].join('\n')
  assert.deepEqual(
    sourceViolations(source).map(({ line }) => line),
    [1, 2, 3, 4, 5],
  )
})

test('flags bare white and black only in CSS', () => {
  assert.equal(sourceViolations('a { color: white; }', true).length, 1)
  assert.equal(sourceViolations('a { white-space: nowrap; }', true).length, 0)
})

test('allows literals in the token file only inside custom property definitions', () => {
  const css = `:root {
  --surface: #ffffff;
  --border: rgba(20, 22, 27, 0.1);
}
/* #000 in a comment */
.a { background: #18181b; mask-image: linear-gradient(transparent, black); }
.b { box-shadow: 0 1px color-mix(in srgb, var(--shadow-color) 20%, transparent); }`
  assert.deepEqual(tokenFileViolations(css), ['background: #18181b'])
})

test('the renderer writes every color through a token', async () => {
  assert.deepEqual(await colorLiteralViolations(), [])
})

import { describe, expect, it } from 'vitest'

import { parseWorkspaceFilePath } from './markdown-file-paths'

describe('parseWorkspaceFilePath', () => {
  it.each([
    ['src/foo.ts', { path: 'src/foo.ts', line: null }],
    ['src/foo.ts:42', { path: 'src/foo.ts', line: 42 }],
    ['./src/foo.ts:42:7', { path: 'src/foo.ts', line: 42 }],
    ['src/foo.ts#L9', { path: 'src/foo.ts', line: 9 }],
    [
      '.github/workflows/ci.yml',
      { path: '.github/workflows/ci.yml', line: null },
    ],
    [
      'packages/@scope/a-b/index.d.ts',
      { path: 'packages/@scope/a-b/index.d.ts', line: null },
    ],
  ])('reads %s', (text, expected) => {
    expect(parseWorkspaceFilePath(text)).toEqual(expected)
  })

  it.each([
    'window.aide',
    'and/or',
    'README.md',
    '/etc/passwd',
    '../secret.ts',
    'src/../../secret.ts',
    'https://example.com/a.ts',
    'src/foo.ts:abc',
    'src/foo bar.ts',
  ])('ignores %s', (text) => {
    expect(parseWorkspaceFilePath(text)).toBeNull()
  })
})

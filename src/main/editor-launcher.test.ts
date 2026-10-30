import { describe, expect, it } from 'vitest'

import { editorFileArguments, openFileInEditor } from './editor-launcher'

describe('editorFileArguments', () => {
  it('opens the file at its line in each editor family', () => {
    expect(editorFileArguments('vscode', '/repo', '/repo/a.ts', 42)).toEqual([
      '/repo',
      '--goto',
      '/repo/a.ts:42',
    ])
    expect(editorFileArguments('zed', '/repo', '/repo/a.ts', 42)).toEqual([
      '/repo',
      '/repo/a.ts:42',
    ])
    expect(editorFileArguments('idea', '/repo', '/repo/a.ts', 42)).toEqual([
      '/repo',
      '--line',
      '42',
      '/repo/a.ts',
    ])
    expect(editorFileArguments('cursor', '/repo', '/repo/a.ts', null)).toEqual([
      '/repo',
      '--goto',
      '/repo/a.ts',
    ])
  })
})

describe('openFileInEditor', () => {
  it.each([
    '../secret.ts',
    '/etc/passwd',
    'src/../../secret.ts',
    '.',
    '',
  ])('refuses %s', async (relativePath) => {
    await expect(openFileInEditor('/repo', relativePath, null)).rejects.toThrow(
      'File is outside the workspace.',
    )
  })
})

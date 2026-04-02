import { describe, expect, it } from 'vitest'

import {
  formatGitChangeKind,
  getGitFileChangeBadges,
  resolveSelectedGitFilePath,
} from './git-pane-state'

describe('resolveSelectedGitFilePath', () => {
  const files = [
    {
      isStaged: true,
      isUnstaged: false,
      originalPath: null,
      path: 'README.md',
      staged: 'modified',
      unstaged: 'unmodified',
    },
    {
      isStaged: false,
      isUnstaged: true,
      originalPath: null,
      path: 'notes.txt',
      staged: 'unmodified',
      unstaged: 'untracked',
    },
  ] as const

  it('preserves the current selection when the file still exists', () => {
    expect(resolveSelectedGitFilePath(files, 'notes.txt')).toBe('notes.txt')
  })

  it('falls back to the first file when the current selection disappears', () => {
    expect(resolveSelectedGitFilePath(files, 'missing.ts')).toBe('README.md')
  })

  it('returns null when there are no changed files', () => {
    expect(resolveSelectedGitFilePath([], 'README.md')).toBeNull()
  })
})

describe('getGitFileChangeBadges', () => {
  it('labels staged and unstaged file changes clearly', () => {
    expect(
      getGitFileChangeBadges({
        isStaged: true,
        isUnstaged: true,
        originalPath: null,
        path: 'README.md',
        staged: 'modified',
        unstaged: 'modified',
      }),
    ).toEqual(['Staged: Modified', 'Unstaged: Modified'])
  })

  it('returns a clean label when no file changes are present', () => {
    expect(
      getGitFileChangeBadges({
        isStaged: false,
        isUnstaged: false,
        originalPath: null,
        path: 'README.md',
        staged: 'unmodified',
        unstaged: 'unmodified',
      }),
    ).toEqual(['Clean'])
  })
})

describe('formatGitChangeKind', () => {
  it('formats change kinds with user-facing labels', () => {
    expect(formatGitChangeKind('untracked')).toBe('Untracked')
    expect(formatGitChangeKind('unmerged')).toBe('Unmerged')
  })
})

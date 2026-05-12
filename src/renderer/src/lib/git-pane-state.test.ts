import { describe, expect, it } from 'vitest'

import type { WorkspaceGitFileStatus } from '../../../shared/git'
import {
  buildGitFileTree,
  collectDirPaths,
  formatGitChangeKind,
  getGitFileChangeBadges,
  resolveSelectedGitFilePath,
} from './git-pane-state'

function fileAt(path: string): WorkspaceGitFileStatus {
  return {
    isStaged: false,
    isUnstaged: true,
    originalPath: null,
    path,
    staged: 'unmodified',
    unstaged: 'modified',
  }
}

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

describe('buildGitFileTree', () => {
  it('returns an empty list for no files', () => {
    expect(buildGitFileTree([])).toEqual([])
  })

  it('keeps top-level files at the root', () => {
    const tree = buildGitFileTree([fileAt('README.md'), fileAt('package.json')])
    expect(tree).toHaveLength(2)
    expect(tree.every((node) => node.kind === 'file')).toBe(true)
  })

  it('sorts directories before files at each level', () => {
    const tree = buildGitFileTree([fileAt('README.md'), fileAt('src/index.ts')])
    expect(tree.map((node) => node.name)).toEqual(['src', 'README.md'])
  })

  it('collapses single-child folder chains onto one row', () => {
    const tree = buildGitFileTree([fileAt('src/main/components/foo/bar.ts')])
    expect(tree).toHaveLength(1)
    const first = tree[0]
    if (!first || first.kind !== 'dir') {
      throw new Error('expected a dir node')
    }
    expect(first.name).toBe('src/main/components/foo')
    expect(first.path).toBe('src/main/components/foo')
    expect(first.children).toHaveLength(1)
    expect(first.children[0]).toMatchObject({ kind: 'file', name: 'bar.ts' })
  })

  it('does not collapse a directory that owns sibling files', () => {
    const tree = buildGitFileTree([
      fileAt('src/main/a.ts'),
      fileAt('src/main/sub/b.ts'),
    ])
    expect(tree).toHaveLength(1)
    const root = tree[0]
    if (!root || root.kind !== 'dir') {
      throw new Error('expected a dir node')
    }
    expect(root.name).toBe('src/main')
    expect(root.children).toHaveLength(2)
    expect(root.children.map((node) => node.name)).toEqual(['sub', 'a.ts'])
  })
})

describe('collectDirPaths', () => {
  it('lists every directory path in document order', () => {
    const tree = buildGitFileTree([
      fileAt('src/main/a.ts'),
      fileAt('src/main/sub/b.ts'),
      fileAt('src/renderer/c.ts'),
    ])
    expect(collectDirPaths(tree)).toEqual([
      'src',
      'src/main',
      'src/main/sub',
      'src/renderer',
    ])
  })
})

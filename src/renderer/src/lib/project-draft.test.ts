import { describe, expect, it } from 'vitest'

import {
  createProjectDraftValues,
  getPathLeaf,
  shouldReplaceProjectName,
} from './project-draft'

describe('project draft helpers', () => {
  it('extracts a project name from a repo path', () => {
    expect(getPathLeaf('/work/aide')).toBe('aide')
  })

  it('creates stable default project draft values', () => {
    expect(createProjectDraftValues('/work/aide')).toEqual({
      defaultBranch: 'main',
      name: 'aide',
      remoteUrl: '',
      repoRoot: '/work/aide',
    })
  })

  it('replaces the project name when it still matches the old path leaf', () => {
    expect(shouldReplaceProjectName('aide', '/work/aide')).toBe(true)
    expect(shouldReplaceProjectName('', '/work/aide')).toBe(true)
  })

  it('keeps a custom project name when the repo root changes', () => {
    expect(shouldReplaceProjectName('Shipping HQ', '/work/aide')).toBe(false)
  })
})

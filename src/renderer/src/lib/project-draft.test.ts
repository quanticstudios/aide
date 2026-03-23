import { describe, expect, it } from 'vitest'

import { createProjectDraftValues, getPathLeaf } from './project-draft'

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
})

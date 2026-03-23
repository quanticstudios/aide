import { describe, expect, it } from 'vitest'

import type { ProjectRecord } from '../../../shared/persistence'
import { resolveProjectShortcutTarget } from './project-shortcuts'

function createProject(id: string, name: string): ProjectRecord {
  return {
    id,
    name,
    repoRoot: `/repo/${name}`,
    remoteUrl: null,
    defaultBranch: 'main',
    createdAt: '2026-03-22T00:00:00Z',
    updatedAt: '2026-03-22T00:00:00Z',
  }
}

describe('resolveProjectShortcutTarget', () => {
  const projects = [
    createProject('project-1', 'aide'),
    createProject('project-2', 'storefront'),
    createProject('project-3', 'infra'),
  ]

  it('maps numeric keys to visible project slots', () => {
    expect(resolveProjectShortcutTarget(projects, '1')?.id).toBe('project-1')
    expect(resolveProjectShortcutTarget(projects, '3')?.id).toBe('project-3')
  })

  it('returns null for out-of-range or non-digit keys', () => {
    expect(resolveProjectShortcutTarget(projects, '4')).toBeNull()
    expect(resolveProjectShortcutTarget(projects, '0')).toBeNull()
    expect(resolveProjectShortcutTarget(projects, 'j')).toBeNull()
  })
})

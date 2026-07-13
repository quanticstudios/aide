import { describe, expect, it } from 'vitest'

import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'
import {
  getOrderedWorkspaces,
  resolveProjectShortcutTarget,
} from './workspace-shortcuts'

function createWorkspace(
  id: string,
  projectId: string,
  name: string,
): WorkspaceRecord {
  return {
    branchName: name,
    createdAt: '2026-03-22T00:00:00Z',
    id,
    name,
    projectId,
    updatedAt: '2026-03-22T00:00:00Z',
    windowId: null,
    worktreePath: `/repo/aide/${name}`,
  }
}

function createProject(id: string): ProjectRecord {
  return {
    createdAt: '2026-03-22T00:00:00Z',
    defaultBranch: 'main',
    id,
    name: id,
    remoteUrl: null,
    repoRoot: `/repo/${id}`,
    updatedAt: '2026-03-22T00:00:00Z',
  }
}

describe('workspace navigation order', () => {
  const projects = [createProject('project-1'), createProject('project-2')]
  const workspaces = [
    createWorkspace('workspace-1', 'project-1', 'main'),
    createWorkspace('workspace-2', 'project-1', 'feature-a'),
    createWorkspace('workspace-3', 'project-2', 'feature-b'),
  ]

  it('keeps canonical persisted workspace order', () => {
    expect(
      getOrderedWorkspaces(projects, workspaces).map(({ id }) => id),
    ).toEqual(['workspace-1', 'workspace-2', 'workspace-3'])
  })

  it('maps numeric keys to projects rather than workspaces', () => {
    expect(resolveProjectShortcutTarget(projects, '1')?.id).toBe('project-1')
    expect(resolveProjectShortcutTarget(projects, '2')?.id).toBe('project-2')
  })

  it('does not let activity affect navigation order', () => {
    const sameOrder = getOrderedWorkspaces(projects, workspaces)
    expect(sameOrder.map(({ id }) => id)).toEqual([
      'workspace-1',
      'workspace-2',
      'workspace-3',
    ])
  })

  it('returns null for out-of-range or non-digit keys', () => {
    expect(resolveProjectShortcutTarget(projects, '3')).toBeNull()
    expect(resolveProjectShortcutTarget(projects, '0')).toBeNull()
    expect(resolveProjectShortcutTarget(projects, 'j')).toBeNull()
  })
})

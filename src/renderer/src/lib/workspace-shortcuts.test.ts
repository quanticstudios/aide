import { describe, expect, it } from 'vitest'

import type { WorkspaceRecord } from '../../../shared/persistence'
import { resolveWorkspaceShortcutTarget } from './workspace-shortcuts'

function createWorkspace(id: string, name: string): WorkspaceRecord {
  return {
    branchName: name,
    createdAt: '2026-03-22T00:00:00Z',
    id,
    name,
    projectId: 'project-1',
    updatedAt: '2026-03-22T00:00:00Z',
    windowId: null,
    worktreePath: `/repo/aide/${name}`,
  }
}

describe('resolveWorkspaceShortcutTarget', () => {
  const workspaces = [
    createWorkspace('workspace-1', 'main'),
    createWorkspace('workspace-2', 'feature-a'),
    createWorkspace('workspace-3', 'feature-b'),
  ]

  it('maps numeric keys to the nth workspace in the global list', () => {
    expect(resolveWorkspaceShortcutTarget(workspaces, '1')?.id).toBe(
      'workspace-1',
    )
    expect(resolveWorkspaceShortcutTarget(workspaces, '3')?.id).toBe(
      'workspace-3',
    )
  })

  it('returns null for out-of-range or non-digit keys', () => {
    expect(resolveWorkspaceShortcutTarget(workspaces, '4')).toBeNull()
    expect(resolveWorkspaceShortcutTarget(workspaces, '0')).toBeNull()
    expect(resolveWorkspaceShortcutTarget(workspaces, 'j')).toBeNull()
  })
})

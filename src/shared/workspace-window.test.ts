import { describe, expect, it } from 'vitest'

import {
  createEmptyPersistenceSnapshot,
  type PersistenceSnapshot,
} from './persistence'
import { scopePersistenceSnapshot } from './workspace-window'

function createSnapshot(): PersistenceSnapshot {
  return {
    ...createEmptyPersistenceSnapshot(),
    projects: [
      {
        createdAt: '2026-07-13T00:00:00.000Z',
        defaultBranch: 'main',
        id: 'project-1',
        name: 'Aide',
        remoteUrl: null,
        repoRoot: '/workspace/aide',
        updatedAt: '2026-07-13T00:00:00.000Z',
      },
    ],
    workspaces: [
      {
        branchName: 'main',
        createdAt: '2026-07-13T00:00:00.000Z',
        id: 'main-workspace',
        name: 'Main',
        projectId: 'project-1',
        updatedAt: '2026-07-13T00:00:00.000Z',
        windowId: null,
        worktreePath: '/workspace/aide',
      },
      {
        branchName: 'feature/detach',
        createdAt: '2026-07-13T00:00:00.000Z',
        id: 'detached-workspace',
        name: 'Detached',
        projectId: 'project-1',
        updatedAt: '2026-07-13T00:00:00.000Z',
        windowId: 'workspace-window-1',
        worktreePath: '/workspace/aide/.worktrees/detach',
      },
    ],
  }
}

describe('scopePersistenceSnapshot', () => {
  it('keeps detached workspaces out of the main window', () => {
    const snapshot = scopePersistenceSnapshot(createSnapshot(), {
      kind: 'main',
      windowId: null,
      workspaceId: null,
    })

    expect(snapshot.workspaces.map((workspace) => workspace.id)).toEqual([
      'main-workspace',
    ])
  })

  it.each([
    'createWorkspace',
    'attachWorkspace',
    'importProject',
  ])('keeps detached metadata out of the main %s response', () => {
    const snapshot = scopePersistenceSnapshot(createSnapshot(), {
      kind: 'main',
      windowId: null,
      workspaceId: null,
    })

    expect(snapshot.workspaces).toEqual([
      expect.objectContaining({ id: 'main-workspace', windowId: null }),
    ])
    expect(snapshot.workspaces).not.toContainEqual(
      expect.objectContaining({ id: 'detached-workspace' }),
    )
  })

  it('gives a dedicated window only its matching owned workspace', () => {
    const snapshot = scopePersistenceSnapshot(createSnapshot(), {
      kind: 'workspace',
      windowId: 'workspace-window-1',
      workspaceId: 'detached-workspace',
    })

    expect(snapshot.workspaces.map((workspace) => workspace.id)).toEqual([
      'detached-workspace',
    ])
    expect(snapshot.projects.map((project) => project.id)).toEqual([
      'project-1',
    ])
  })
})

import { describe, expect, it } from 'vitest'

import {
  createEmptyPersistenceSnapshot,
  type PersistenceSnapshot,
} from '../shared/persistence'
import { scopeActiveSelectionInput } from './workspace-selection'

function createSnapshot(): PersistenceSnapshot {
  return {
    ...createEmptyPersistenceSnapshot(),
    lastActivePaneIdsBySurface: {
      'detached-surface': 'detached-pane',
      'main-surface': 'main-pane',
    },
    lastActivePaneIdsByWorkspace: {
      'detached-workspace': 'detached-pane',
      'main-workspace': 'main-pane',
    },
    lastActiveProjectId: 'main-project',
    lastActiveSurfaceIdsByWorkspace: {
      'detached-workspace': 'detached-surface',
      'main-workspace': 'main-surface',
    },
    lastActiveWorkspaceId: 'main-workspace',
    lastActiveWorkspaceIdsByProject: {
      'detached-project': 'detached-workspace',
      'main-project': 'main-workspace',
    },
    projects: [
      {
        createdAt: '2026-07-13T00:00:00.000Z',
        defaultBranch: 'main',
        id: 'main-project',
        name: 'Main project',
        remoteUrl: null,
        repoRoot: '/workspace/main',
        updatedAt: '2026-07-13T00:00:00.000Z',
      },
      {
        createdAt: '2026-07-13T00:00:00.000Z',
        defaultBranch: 'main',
        id: 'detached-project',
        name: 'Detached project',
        remoteUrl: null,
        repoRoot: '/workspace/detached',
        updatedAt: '2026-07-13T00:00:00.000Z',
      },
    ],
    surfaceLayouts: {
      'detached-surface': {
        nodes: [
          {
            activeViewIndex: 0,
            children: [],
            id: 'detached-node',
            paneId: 'detached-pane',
            parentId: null,
            sizeWeights: [],
            type: 'pane',
            viewIds: [],
            workspaceId: 'detached-workspace',
          },
        ],
        rootNodeId: 'detached-node',
        surfaceId: 'detached-surface',
        workspaceId: 'detached-workspace',
      },
      'main-surface': {
        nodes: [
          {
            activeViewIndex: 0,
            children: [],
            id: 'main-node',
            paneId: 'main-pane',
            parentId: null,
            sizeWeights: [],
            type: 'pane',
            viewIds: [],
            workspaceId: 'main-workspace',
          },
        ],
        rootNodeId: 'main-node',
        surfaceId: 'main-surface',
        workspaceId: 'main-workspace',
      },
    },
    workspaceSurfaces: {
      'detached-workspace': [
        {
          id: 'detached-surface',
          orderIndex: 0,
          rootNodeId: 'detached-node',
          title: 'Detached',
          workspaceId: 'detached-workspace',
        },
      ],
      'main-workspace': [
        {
          id: 'main-surface',
          orderIndex: 0,
          rootNodeId: 'main-node',
          title: 'Main',
          workspaceId: 'main-workspace',
        },
      ],
    },
    workspaces: [
      {
        branchName: 'main',
        createdAt: '2026-07-13T00:00:00.000Z',
        id: 'main-workspace',
        name: 'Main',
        projectId: 'main-project',
        updatedAt: '2026-07-13T00:00:00.000Z',
        windowId: null,
        worktreePath: '/workspace/main',
      },
      {
        branchName: 'detach',
        createdAt: '2026-07-13T00:00:00.000Z',
        id: 'detached-workspace',
        name: 'Detached',
        projectId: 'detached-project',
        updatedAt: '2026-07-13T00:00:00.000Z',
        windowId: 'detached-window',
        worktreePath: '/workspace/detached',
      },
    ],
  }
}

describe('scopeActiveSelectionInput', () => {
  it('drops foreign main-window mappings without changing the dedicated selection', () => {
    const selection = scopeActiveSelectionInput(
      createSnapshot(),
      { kind: 'main', windowId: null, workspaceId: null },
      {
        paneIdsBySurface: {
          'detached-surface': 'main-pane',
          'main-surface': 'main-pane',
        },
        paneIdsByWorkspace: {
          'detached-workspace': 'main-pane',
          'main-workspace': 'main-pane',
        },
        projectId: 'main-project',
        surfaceIdsByWorkspace: {
          'detached-workspace': 'main-surface',
          'main-workspace': 'main-surface',
        },
        workspaceId: 'main-workspace',
        workspaceIdsByProject: {
          'detached-project': 'main-workspace',
          'main-project': 'main-workspace',
        },
      },
    )

    expect(selection).toEqual({
      paneIdsBySurface: {
        'detached-surface': 'detached-pane',
        'main-surface': 'main-pane',
      },
      paneIdsByWorkspace: {
        'detached-workspace': 'detached-pane',
        'main-workspace': 'main-pane',
      },
      projectId: 'main-project',
      surfaceIdsByWorkspace: {
        'detached-workspace': 'detached-surface',
        'main-workspace': 'main-surface',
      },
      workspaceId: 'main-workspace',
      workspaceIdsByProject: {
        'detached-project': 'detached-workspace',
        'main-project': 'main-workspace',
      },
    })
  })

  it('limits a dedicated selection to its own descendants and leaves main selection intact', () => {
    const selection = scopeActiveSelectionInput(
      createSnapshot(),
      {
        kind: 'workspace',
        windowId: 'detached-window',
        workspaceId: 'detached-workspace',
      },
      {
        paneIdsBySurface: {
          'detached-surface': 'main-pane',
          'main-surface': 'main-pane',
        },
        paneIdsByWorkspace: {
          'detached-workspace': 'detached-pane',
          'main-workspace': 'main-pane',
        },
        projectId: 'detached-project',
        surfaceIdsByWorkspace: {
          'detached-workspace': 'detached-surface',
          'main-workspace': 'main-surface',
        },
        workspaceId: 'detached-workspace',
        workspaceIdsByProject: {
          'detached-project': 'detached-workspace',
          'main-project': 'main-workspace',
        },
      },
    )

    expect(selection).toEqual({
      paneIdsBySurface: { 'main-surface': 'main-pane' },
      paneIdsByWorkspace: {
        'detached-workspace': 'detached-pane',
        'main-workspace': 'main-pane',
      },
      projectId: 'main-project',
      surfaceIdsByWorkspace: {
        'detached-workspace': 'detached-surface',
        'main-workspace': 'main-surface',
      },
      workspaceId: 'main-workspace',
      workspaceIdsByProject: {
        'detached-project': 'detached-workspace',
        'main-project': 'main-workspace',
      },
    })
  })

  it('accepts a null dedicated selection but rejects a foreign active workspace', () => {
    const snapshot = createSnapshot()
    const context = {
      kind: 'workspace' as const,
      windowId: 'detached-window',
      workspaceId: 'detached-workspace',
    }

    expect(() =>
      scopeActiveSelectionInput(snapshot, context, {
        projectId: null,
        workspaceId: null,
      }),
    ).not.toThrow()
    expect(() =>
      scopeActiveSelectionInput(snapshot, context, {
        projectId: 'main-project',
        workspaceId: 'main-workspace',
      }),
    ).toThrow('not owned by this window')
    expect(() =>
      scopeActiveSelectionInput(
        snapshot,
        { kind: 'main', windowId: null, workspaceId: null },
        {
          projectId: 'detached-project',
          workspaceId: 'detached-workspace',
        },
      ),
    ).toThrow('not owned by this window')
  })

  it('does not let a dedicated workspace overwrite a shared project mapping', () => {
    const snapshot = createSnapshot()
    const detachedWorkspace = snapshot.workspaces.find(
      (workspace) => workspace.id === 'detached-workspace',
    )

    if (!detachedWorkspace) {
      throw new Error('Expected detached workspace fixture.')
    }

    detachedWorkspace.projectId = 'main-project'
    snapshot.projects = snapshot.projects.filter(
      (project) => project.id === 'main-project',
    )
    snapshot.lastActiveWorkspaceIdsByProject = {
      'main-project': 'main-workspace',
    }

    const selection = scopeActiveSelectionInput(
      snapshot,
      {
        kind: 'workspace',
        windowId: 'detached-window',
        workspaceId: 'detached-workspace',
      },
      {
        projectId: 'main-project',
        workspaceId: 'detached-workspace',
        workspaceIdsByProject: {
          'main-project': 'detached-workspace',
        },
      },
    )

    expect(selection.workspaceIdsByProject).toEqual({
      'main-project': 'main-workspace',
    })
  })
})

import { describe, expect, it } from 'vitest'

import type {
  PersistenceSnapshot,
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'
import {
  applyPaneSelection,
  applyProjectSelection,
  applySurfaceSelection,
  applyWorkspaceSelection,
  createDefaultSpatialNavigationState,
  moveRelativePane,
  moveRelativeWorkspace,
  resolveSpatialNavigationState,
} from './spatial-navigation-state'

function createProject(id: string, name: string): ProjectRecord {
  return {
    id,
    name,
    repoRoot: `/repo/${name}`,
    remoteUrl: null,
    defaultBranch: 'main',
    createdAt: '2026-03-24T00:00:00Z',
    updatedAt: '2026-03-24T00:00:00Z',
  }
}

function createWorkspace(
  id: string,
  projectId: string,
  name: string,
): WorkspaceRecord {
  return {
    id,
    projectId,
    name,
    branchName: `${name}-branch`,
    worktreePath: `/repo/${projectId}/${name}`,
    windowId: null,
    createdAt: '2026-03-24T00:00:00Z',
    updatedAt: '2026-03-24T00:00:00Z',
  }
}

function createSnapshot(): PersistenceSnapshot {
  return {
    databasePath: '.aide.sqlite3',
    lastActivePaneIdsBySurface: {
      'workspace-b2:surface:terminal': 'terminal',
    },
    lastActivePaneIdsByWorkspace: {},
    lastActiveProjectId: 'project-b',
    lastActiveSurfaceIdsByWorkspace: {
      'workspace-a2': 'workspace-a2:surface:preview',
      'workspace-b2': 'workspace-b2:surface:terminal',
    },
    lastActiveWorkspaceIdsByProject: {
      'project-a': 'workspace-a2',
    },
    lastActiveWorkspaceId: 'workspace-b2',
    migrationStrategy: 'test',
    schemaVersion: 5,
    projects: [
      createProject('project-a', 'aide'),
      createProject('project-b', 'storefront'),
    ],
    surfaceLayouts: {},
    workspaceLayouts: {},
    workspaceSurfaces: {
      'workspace-a1': [
        {
          id: 'workspace-a1:surface:chat',
          orderIndex: 0,
          rootNodeId: 'chat-root',
          title: 'Chat',
          workspaceId: 'workspace-a1',
        },
        {
          id: 'workspace-a1:surface:git',
          orderIndex: 1,
          rootNodeId: 'git-root',
          title: 'Git',
          workspaceId: 'workspace-a1',
        },
      ],
      'workspace-a2': [
        {
          id: 'workspace-a2:surface:chat',
          orderIndex: 0,
          rootNodeId: 'a2-chat-root',
          title: 'Chat',
          workspaceId: 'workspace-a2',
        },
        {
          id: 'workspace-a2:surface:preview',
          orderIndex: 1,
          rootNodeId: 'a2-preview-root',
          title: 'Preview',
          workspaceId: 'workspace-a2',
        },
      ],
      'workspace-b1': [
        {
          id: 'workspace-b1:surface:chat',
          orderIndex: 0,
          rootNodeId: 'b1-chat-root',
          title: 'Chat',
          workspaceId: 'workspace-b1',
        },
      ],
      'workspace-b2': [
        {
          id: 'workspace-b2:surface:terminal',
          orderIndex: 0,
          rootNodeId: 'b2-terminal-root',
          title: 'Terminal',
          workspaceId: 'workspace-b2',
        },
        {
          id: 'workspace-b2:surface:git',
          orderIndex: 1,
          rootNodeId: 'b2-git-root',
          title: 'Git',
          workspaceId: 'workspace-b2',
        },
        {
          id: 'workspace-b2:surface:preview',
          orderIndex: 2,
          rootNodeId: 'b2-preview-root',
          title: 'Preview',
          workspaceId: 'workspace-b2',
        },
      ],
    },
    workspaces: [
      createWorkspace('workspace-a1', 'project-a', 'nav'),
      createWorkspace('workspace-a2', 'project-a', 'review'),
      createWorkspace('workspace-b1', 'project-b', 'checkout'),
      createWorkspace('workspace-b2', 'project-b', 'pricing'),
    ],
  }
}

function getSurfaceIdsForWorkspace(workspaceId: string | null): string[] {
  const surfaces = createSnapshot().workspaceSurfaces ?? {}

  return workspaceId
    ? (surfaces[workspaceId] ?? []).map((surface) => surface.id)
    : []
}

function getPaneIdsForSurface(surfaceId: string | null): string[] {
  const panes: Record<string, string[]> = {
    'workspace-a1:surface:chat': ['chat'],
    'workspace-a1:surface:git': ['git'],
    'workspace-a2:surface:chat': ['chat'],
    'workspace-a2:surface:preview': ['preview'],
    'workspace-b1:surface:chat': ['chat'],
    'workspace-b2:surface:terminal': ['terminal', 'logs'],
    'workspace-b2:surface:git': ['git'],
    'workspace-b2:surface:preview': ['preview'],
  }

  return surfaceId ? (panes[surfaceId] ?? []) : []
}

describe('resolveSpatialNavigationState', () => {
  it('restores the snapshot path when no active state exists yet', () => {
    const state = resolveSpatialNavigationState(
      createSnapshot(),
      createDefaultSpatialNavigationState(),
      getSurfaceIdsForWorkspace,
      getPaneIdsForSurface,
    )

    expect(state).toMatchObject({
      activePaneId: 'terminal',
      activeProjectId: 'project-b',
      activeSurfaceId: 'workspace-b2:surface:terminal',
      activeWorkspaceId: 'workspace-b2',
    })
  })

  it('repairs invalid active selections without dropping remembered surface state', () => {
    const state = resolveSpatialNavigationState(
      createSnapshot(),
      {
        activePaneId: 'missing-pane',
        activeProjectId: 'missing-project',
        activeSurfaceId: 'missing-surface',
        activeWorkspaceId: 'missing-workspace',
        rememberedPaneIdsBySurface: {
          'workspace-a2:surface:preview': 'preview',
        },
        rememberedSurfaceIdsByWorkspace: {
          'workspace-a2': 'workspace-a2:surface:preview',
        },
        rememberedWorkspaceIdsByProject: { 'project-a': 'workspace-a2' },
      },
      getSurfaceIdsForWorkspace,
      getPaneIdsForSurface,
    )

    expect(state).toMatchObject({
      activePaneId: 'terminal',
      activeProjectId: 'project-b',
      activeSurfaceId: 'workspace-b2:surface:terminal',
      activeWorkspaceId: 'workspace-b2',
      rememberedPaneIdsBySurface: {
        'workspace-a2:surface:preview': 'preview',
        'workspace-b2:surface:terminal': 'terminal',
      },
      rememberedSurfaceIdsByWorkspace: {
        'workspace-a2': 'workspace-a2:surface:preview',
        'workspace-b2': 'workspace-b2:surface:terminal',
      },
    })
  })
})

describe('spatial navigation transitions', () => {
  it('restores the remembered workspace and surface for a project', () => {
    const snapshot = createSnapshot()
    const baseState = resolveSpatialNavigationState(
      snapshot,
      createDefaultSpatialNavigationState(),
      getSurfaceIdsForWorkspace,
      getPaneIdsForSurface,
    )

    const state = applyProjectSelection(
      snapshot,
      baseState,
      'project-a',
      getSurfaceIdsForWorkspace,
      getPaneIdsForSurface,
    )

    expect(state).toMatchObject({
      activePaneId: 'preview',
      activeProjectId: 'project-a',
      activeSurfaceId: 'workspace-a2:surface:preview',
      activeWorkspaceId: 'workspace-a2',
    })
  })

  it('remembers leaf pane selection inside the current surface', () => {
    const snapshot = createSnapshot()
    const baseState = resolveSpatialNavigationState(
      snapshot,
      createDefaultSpatialNavigationState(),
      getSurfaceIdsForWorkspace,
      getPaneIdsForSurface,
    )

    const changedPane = applyPaneSelection(
      snapshot,
      baseState,
      'logs',
      getSurfaceIdsForWorkspace,
      getPaneIdsForSurface,
    )

    expect(changedPane.rememberedPaneIdsBySurface).toMatchObject({
      'workspace-b2:surface:terminal': 'logs',
    })
  })

  it('remembers surfaces per workspace and restores them when switching back', () => {
    const snapshot = createSnapshot()
    const baseState = resolveSpatialNavigationState(
      snapshot,
      createDefaultSpatialNavigationState(),
      getSurfaceIdsForWorkspace,
      getPaneIdsForSurface,
    )
    const changedSurface = applySurfaceSelection(
      snapshot,
      baseState,
      'workspace-b2:surface:git',
      getSurfaceIdsForWorkspace,
      getPaneIdsForSurface,
    )
    const movedWorkspace = applyWorkspaceSelection(
      snapshot,
      changedSurface,
      'workspace-b1',
      getSurfaceIdsForWorkspace,
      getPaneIdsForSurface,
    )
    const backAgain = applyWorkspaceSelection(
      snapshot,
      movedWorkspace,
      'workspace-b2',
      getSurfaceIdsForWorkspace,
      getPaneIdsForSurface,
    )

    expect(backAgain.activeSurfaceId).toBe('workspace-b2:surface:git')
    expect(backAgain.activePaneId).toBe('git')
  })

  it('wraps surface and workspace movement without resetting to zero first', () => {
    const snapshot = createSnapshot()
    const baseState = resolveSpatialNavigationState(
      snapshot,
      createDefaultSpatialNavigationState(),
      getSurfaceIdsForWorkspace,
      getPaneIdsForSurface,
    )

    expect(
      moveRelativePane(
        snapshot,
        baseState,
        1,
        getSurfaceIdsForWorkspace,
        getPaneIdsForSurface,
      ).activeSurfaceId,
    ).toBe('workspace-b2:surface:git')
    expect(
      moveRelativeWorkspace(
        snapshot,
        baseState,
        1,
        getSurfaceIdsForWorkspace,
        getPaneIdsForSurface,
      ).activeWorkspaceId,
    ).toBe('workspace-b1')
  })
})

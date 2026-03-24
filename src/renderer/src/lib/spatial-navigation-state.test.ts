import { describe, expect, it } from 'vitest'

import type {
  PersistenceSnapshot,
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'
import {
  applyPaneSelection,
  applyProjectSelection,
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
    lastActiveProjectId: 'project-b',
    lastActiveWorkspaceId: 'workspace-b2',
    migrationStrategy: 'test',
    schemaVersion: 2,
    projects: [
      createProject('project-a', 'aide'),
      createProject('project-b', 'storefront'),
    ],
    workspaces: [
      createWorkspace('workspace-a1', 'project-a', 'nav'),
      createWorkspace('workspace-a2', 'project-a', 'review'),
      createWorkspace('workspace-b1', 'project-b', 'checkout'),
      createWorkspace('workspace-b2', 'project-b', 'pricing'),
    ],
  }
}

function getPaneIdsForWorkspace(workspaceId: string | null): string[] {
  const panes: Record<string, string[]> = {
    'workspace-a1': ['chat', 'terminal', 'git'],
    'workspace-a2': ['chat', 'editor', 'preview'],
    'workspace-b1': ['chat', 'preview'],
    'workspace-b2': ['terminal', 'git', 'preview'],
  }

  return workspaceId ? (panes[workspaceId] ?? []) : []
}

describe('resolveSpatialNavigationState', () => {
  it('restores the snapshot path when no active state exists yet', () => {
    const state = resolveSpatialNavigationState(
      createSnapshot(),
      createDefaultSpatialNavigationState(),
      getPaneIdsForWorkspace,
    )

    expect(state).toMatchObject({
      activePaneId: 'terminal',
      activeProjectId: 'project-b',
      activeWorkspaceId: 'workspace-b2',
    })
  })

  it('repairs invalid active selections without resetting valid remembered state', () => {
    const state = resolveSpatialNavigationState(
      createSnapshot(),
      {
        activePaneId: 'missing-pane',
        activeProjectId: 'missing-project',
        activeWorkspaceId: 'missing-workspace',
        rememberedPaneIdsByWorkspace: { 'workspace-a2': 'preview' },
        rememberedWorkspaceIdsByProject: { 'project-a': 'workspace-a2' },
      },
      getPaneIdsForWorkspace,
    )

    expect(state).toMatchObject({
      activePaneId: 'terminal',
      activeProjectId: 'project-b',
      activeWorkspaceId: 'workspace-b2',
      rememberedPaneIdsByWorkspace: {
        'workspace-a2': 'preview',
        'workspace-b2': 'terminal',
      },
      rememberedWorkspaceIdsByProject: {
        'project-a': 'workspace-a2',
        'project-b': 'workspace-b2',
      },
    })
  })
})

describe('spatial navigation transitions', () => {
  it('restores the remembered workspace and pane for a project', () => {
    const baseState = resolveSpatialNavigationState(
      createSnapshot(),
      createDefaultSpatialNavigationState(),
      getPaneIdsForWorkspace,
    )
    const state = applyProjectSelection(
      createSnapshot(),
      {
        ...baseState,
        rememberedPaneIdsByWorkspace: {
          ...baseState.rememberedPaneIdsByWorkspace,
          'workspace-a2': 'preview',
        },
        rememberedWorkspaceIdsByProject: {
          ...baseState.rememberedWorkspaceIdsByProject,
          'project-a': 'workspace-a2',
        },
      },
      'project-a',
      getPaneIdsForWorkspace,
    )

    expect(state).toMatchObject({
      activePaneId: 'preview',
      activeProjectId: 'project-a',
      activeWorkspaceId: 'workspace-a2',
    })
  })

  it('remembers pane changes per workspace and restores them when switching back', () => {
    const snapshot = createSnapshot()
    const baseState = resolveSpatialNavigationState(
      snapshot,
      createDefaultSpatialNavigationState(),
      getPaneIdsForWorkspace,
    )
    const changedPane = applyPaneSelection(
      snapshot,
      baseState,
      'git',
      getPaneIdsForWorkspace,
    )
    const movedWorkspace = applyWorkspaceSelection(
      snapshot,
      changedPane,
      'workspace-b1',
      getPaneIdsForWorkspace,
    )
    const backAgain = applyWorkspaceSelection(
      snapshot,
      movedWorkspace,
      'workspace-b2',
      getPaneIdsForWorkspace,
    )

    expect(backAgain.activePaneId).toBe('git')
  })

  it('wraps pane and workspace movement without resetting to zero first', () => {
    const snapshot = createSnapshot()
    const baseState = resolveSpatialNavigationState(
      snapshot,
      createDefaultSpatialNavigationState(),
      getPaneIdsForWorkspace,
    )

    expect(
      moveRelativePane(snapshot, baseState, 1, getPaneIdsForWorkspace)
        .activePaneId,
    ).toBe('git')
    expect(
      moveRelativeWorkspace(snapshot, baseState, 1, getPaneIdsForWorkspace)
        .activeWorkspaceId,
    ).toBe('workspace-b1')
    expect(
      moveRelativeWorkspace(snapshot, baseState, -1, getPaneIdsForWorkspace)
        .activeWorkspaceId,
    ).toBe('workspace-b1')
  })
})

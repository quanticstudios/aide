import { describe, expect, it } from 'vitest'

import type { PersistenceSnapshot } from '../../../shared/persistence'
import {
  applyWorkspaceSelection,
  createDefaultSpatialNavigationState,
  moveRelativePane,
  resolveSpatialNavigationState,
} from './spatial-navigation-state'
import { createWorkspaceSelectionStore } from './workspace-selection-store'

describe('createWorkspaceSelectionStore', () => {
  it('starts with empty selection state by default', () => {
    const store = createWorkspaceSelectionStore()

    expect(store.getState()).toMatchObject({
      activePaneId: null,
      activeProjectId: null,
      activeSurfaceId: null,
      activeWorkspaceId: null,
      rememberedPaneIdsBySurface: {},
      rememberedSurfaceIdsByWorkspace: {},
      rememberedWorkspaceIdsByProject: {},
    })
  })

  it('updates project, workspace, and pane selection through actions', () => {
    const store = createWorkspaceSelectionStore()

    store.getState().setActiveProjectId('project-1')
    store.getState().setActiveWorkspaceId('workspace-1')
    store.getState().setActivePaneId('pane-1')

    expect(store.getState()).toMatchObject({
      activePaneId: 'pane-1',
      activeProjectId: 'project-1',
      activeSurfaceId: null,
      activeWorkspaceId: 'workspace-1',
      rememberedPaneIdsBySurface: {},
      rememberedSurfaceIdsByWorkspace: {},
      rememberedWorkspaceIdsByProject: {},
    })
  })

  it('remembers the last active pane per surface', () => {
    const store = createWorkspaceSelectionStore()

    store.getState().setActivePaneForSurface('surface-1', 'pane-a')
    store.getState().setActivePaneForSurface('surface-2', 'pane-b')

    expect(store.getState()).toMatchObject({
      activePaneId: 'pane-b',
      rememberedPaneIdsBySurface: {
        'surface-1': 'pane-a',
        'surface-2': 'pane-b',
      },
      rememberedWorkspaceIdsByProject: {},
    })
  })

  it('supports atomic selection updates and reset', () => {
    const store = createWorkspaceSelectionStore({
      activeProjectId: 'project-1',
      activeWorkspaceId: 'workspace-1',
    })

    store.getState().setSelection({
      activePaneId: 'pane-2',
      activeWorkspaceId: 'workspace-2',
    })

    expect(store.getState()).toMatchObject({
      activePaneId: 'pane-2',
      activeProjectId: 'project-1',
      activeWorkspaceId: 'workspace-2',
    })

    store.getState().resetSelection()

    expect(store.getState()).toMatchObject({
      activePaneId: null,
      activeProjectId: null,
      activeSurfaceId: null,
      activeWorkspaceId: null,
      rememberedPaneIdsBySurface: {},
      rememberedSurfaceIdsByWorkspace: {},
      rememberedWorkspaceIdsByProject: {},
    })
  })

  it('keeps a remembered pane when returning through a stale snapshot', () => {
    const snapshot: PersistenceSnapshot = {
      catalogRevision: 0,
      databasePath: '.aide.sqlite3',
      lastActivePaneIdsBySurface: {},
      lastActivePaneIdsByWorkspace: {},
      lastActiveProjectId: 'project',
      lastActiveSurfaceIdsByWorkspace: { main: 'main:terminal' },
      lastActiveWorkspaceIdsByProject: { project: 'main' },
      lastActiveWorkspaceId: 'main',
      migrationStrategy: 'test',
      schemaVersion: 0,
      projects: [
        {
          createdAt: '2026-09-18T00:00:00Z',
          defaultBranch: 'main',
          id: 'project',
          kind: 'git',
          name: 'Aide',
          remoteUrl: null,
          repoRoot: '/repo/aide',
          setupCommand: null,
          updatedAt: '2026-09-18T00:00:00Z',
          worktreeSetupRevision: 0,
        },
      ],
      surfaceLayouts: {},
      workspaceLayoutRevisions: {},
      workspaceLayouts: {},
      workspaceSurfaceRevisions: {},
      workspaceSurfaces: {
        main: [
          {
            id: 'main:terminal',
            orderIndex: 0,
            rootNodeId: 'main-terminal-root',
            title: 'Terminal',
            workspaceId: 'main',
          },
          {
            id: 'main:git',
            orderIndex: 1,
            rootNodeId: 'main-git-root',
            title: 'Git',
            workspaceId: 'main',
          },
        ],
        other: [
          {
            id: 'other:terminal',
            orderIndex: 0,
            rootNodeId: 'other-terminal-root',
            title: 'Terminal',
            workspaceId: 'other',
          },
        ],
      },
      workspaces: [
        {
          branchName: 'main',
          createdAt: '2026-09-18T00:00:00Z',
          id: 'main',
          name: 'main',
          projectId: 'project',
          updatedAt: '2026-09-18T00:00:00Z',
          windowId: null,
          worktreePath: '/repo/aide',
        },
        {
          branchName: 'other',
          createdAt: '2026-09-18T00:00:00Z',
          id: 'other',
          name: 'other',
          projectId: 'project',
          updatedAt: '2026-09-18T00:00:00Z',
          windowId: null,
          worktreePath: '/repo/aide/.worktrees/other',
        },
      ],
    }
    const getSurfaceIds = (workspaceId: string | null) =>
      workspaceId
        ? (snapshot.workspaceSurfaces?.[workspaceId] ?? []).map(
            (surface) => surface.id,
          )
        : []
    const getPaneIds = (surfaceId: string | null) =>
      surfaceId === 'main:terminal'
        ? ['terminal']
        : surfaceId === 'main:git'
          ? ['git']
          : surfaceId === 'other:terminal'
            ? ['terminal']
            : []
    const store = createWorkspaceSelectionStore()
    const mainSelection = applyWorkspaceSelection(
      snapshot,
      resolveSpatialNavigationState(
        snapshot,
        createDefaultSpatialNavigationState(),
        getSurfaceIds,
        getPaneIds,
      ),
      'main',
      getSurfaceIds,
      getPaneIds,
    )
    const gitSelection = moveRelativePane(
      snapshot,
      mainSelection,
      1,
      getSurfaceIds,
      getPaneIds,
    )

    store.getState().setSelection(gitSelection)
    store.getState().setSelection(
      applyWorkspaceSelection(
        snapshot,
        store.getState(),
        'other',
        getSurfaceIds,
        getPaneIds,
      ),
    )
    const returnedToMain = applyWorkspaceSelection(
      snapshot,
      store.getState(),
      'main',
      getSurfaceIds,
      getPaneIds,
    )

    expect(returnedToMain).toMatchObject({
      activePaneId: 'git',
      activeSurfaceId: 'main:git',
      rememberedPaneIdsBySurface: { 'main:git': 'git' },
      rememberedSurfaceIdsByWorkspace: { main: 'main:git' },
    })
  })
})

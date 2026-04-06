import { describe, expect, it } from 'vitest'

import { createWorkspaceSelectionStore } from './workspace-selection-store'

describe('createWorkspaceSelectionStore', () => {
  it('starts with empty selection state by default', () => {
    const store = createWorkspaceSelectionStore()

    expect(store.getState()).toMatchObject({
      activePaneId: null,
      activePaneIdsBySurface: {},
      activeProjectId: null,
      activeSurfaceId: null,
      activeSurfaceIdsByWorkspace: {},
      activeWorkspaceId: null,
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
      activePaneIdsBySurface: {},
      activeProjectId: 'project-1',
      activeSurfaceId: null,
      activeSurfaceIdsByWorkspace: {},
      activeWorkspaceId: 'workspace-1',
      rememberedWorkspaceIdsByProject: {},
    })
  })

  it('remembers the last active pane per surface', () => {
    const store = createWorkspaceSelectionStore()

    store.getState().setActivePaneForSurface('surface-1', 'pane-a')
    store.getState().setActivePaneForSurface('surface-2', 'pane-b')

    expect(store.getState()).toMatchObject({
      activePaneId: 'pane-b',
      activePaneIdsBySurface: {
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
      activePaneIdsBySurface: {},
      activeProjectId: null,
      activeSurfaceId: null,
      activeSurfaceIdsByWorkspace: {},
      activeWorkspaceId: null,
      rememberedWorkspaceIdsByProject: {},
    })
  })
})

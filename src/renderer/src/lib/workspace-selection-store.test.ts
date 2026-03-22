import { describe, expect, it } from 'vitest'

import { createWorkspaceSelectionStore } from './workspace-selection-store'

describe('createWorkspaceSelectionStore', () => {
  it('starts with empty selection state by default', () => {
    const store = createWorkspaceSelectionStore()

    expect(store.getState()).toMatchObject({
      activePaneId: null,
      activeProjectId: null,
      activeWorkspaceId: null,
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
      activeWorkspaceId: 'workspace-1',
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
      activeWorkspaceId: null,
    })
  })
})

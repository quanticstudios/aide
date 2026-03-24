import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

export interface WorkspaceSelectionState {
  activePaneId: string | null
  activePaneIdsByWorkspace: Record<string, string | null>
  activeProjectId: string | null
  activeWorkspaceId: string | null
  rememberedWorkspaceIdsByProject: Record<string, string | null>
}

export interface WorkspaceSelectionActions {
  setActivePaneForWorkspace: (
    workspaceId: string | null,
    paneId: string | null,
  ) => void
  resetSelection: () => void
  setActivePaneId: (paneId: string | null) => void
  setActiveProjectId: (projectId: string | null) => void
  setActiveWorkspaceId: (workspaceId: string | null) => void
  setSelection: (selection: Partial<WorkspaceSelectionState>) => void
}

export type WorkspaceSelectionStore = WorkspaceSelectionState &
  WorkspaceSelectionActions

const defaultSelectionState: WorkspaceSelectionState = {
  activePaneId: null,
  activePaneIdsByWorkspace: {},
  activeProjectId: null,
  activeWorkspaceId: null,
  rememberedWorkspaceIdsByProject: {},
}

export function createWorkspaceSelectionStore(
  initialState: Partial<WorkspaceSelectionState> = {},
) {
  return createStore<WorkspaceSelectionStore>()((set) => ({
    ...defaultSelectionState,
    ...initialState,
    resetSelection: () => set(defaultSelectionState),
    setActivePaneId: (activePaneId) => set({ activePaneId }),
    setActivePaneForWorkspace: (workspaceId, paneId) =>
      set((state) => ({
        activePaneId: paneId,
        activePaneIdsByWorkspace: workspaceId
          ? {
              ...state.activePaneIdsByWorkspace,
              [workspaceId]: paneId,
            }
          : state.activePaneIdsByWorkspace,
      })),
    setActiveProjectId: (activeProjectId) => set({ activeProjectId }),
    setActiveWorkspaceId: (activeWorkspaceId) => set({ activeWorkspaceId }),
    setSelection: (selection) => set((state) => ({ ...state, ...selection })),
  }))
}

const workspaceSelectionStore = createWorkspaceSelectionStore()

export function useWorkspaceSelectionStore<T>(
  selector: (state: WorkspaceSelectionStore) => T,
): T {
  return useStore(workspaceSelectionStore, selector)
}

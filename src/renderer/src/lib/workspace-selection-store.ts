import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'

export interface WorkspaceSelectionState {
  activePaneId: string | null
  activePaneIdsBySurface: Record<string, string | null>
  activeProjectId: string | null
  activeSurfaceId: string | null
  activeSurfaceIdsByWorkspace: Record<string, string | null>
  activeWorkspaceId: string | null
  rememberedWorkspaceIdsByProject: Record<string, string | null>
}

export interface WorkspaceSelectionActions {
  setActivePaneForSurface: (
    surfaceId: string | null,
    paneId: string | null,
  ) => void
  setActiveSurfaceForWorkspace: (
    workspaceId: string | null,
    surfaceId: string | null,
  ) => void
  resetSelection: () => void
  setActivePaneId: (paneId: string | null) => void
  setActiveProjectId: (projectId: string | null) => void
  setActiveSurfaceId: (surfaceId: string | null) => void
  setActiveWorkspaceId: (workspaceId: string | null) => void
  setSelection: (selection: Partial<WorkspaceSelectionState>) => void
}

export type WorkspaceSelectionStore = WorkspaceSelectionState &
  WorkspaceSelectionActions

const defaultSelectionState: WorkspaceSelectionState = {
  activePaneId: null,
  activePaneIdsBySurface: {},
  activeProjectId: null,
  activeSurfaceId: null,
  activeSurfaceIdsByWorkspace: {},
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
    setActivePaneForSurface: (surfaceId, paneId) =>
      set((state) => ({
        activePaneId: paneId,
        activePaneIdsBySurface: surfaceId
          ? {
              ...state.activePaneIdsBySurface,
              [surfaceId]: paneId,
            }
          : state.activePaneIdsBySurface,
      })),
    setActiveProjectId: (activeProjectId) => set({ activeProjectId }),
    setActiveSurfaceForWorkspace: (workspaceId, surfaceId) =>
      set((state) => ({
        activeSurfaceId: surfaceId,
        activeSurfaceIdsByWorkspace: workspaceId
          ? {
              ...state.activeSurfaceIdsByWorkspace,
              [workspaceId]: surfaceId,
            }
          : state.activeSurfaceIdsByWorkspace,
      })),
    setActiveSurfaceId: (activeSurfaceId) => set({ activeSurfaceId }),
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

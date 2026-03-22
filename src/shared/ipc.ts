import type { ProjectTextFile } from './editor'
import type {
  CreateProjectInput,
  CreateWorkspaceInput,
  PersistenceSnapshot,
  SetActiveSelectionInput,
} from './persistence'
import type { RuntimeSnapshot } from './runtime'

export const IPC_CHANNELS = {
  createProject: 'storage:create-project',
  createWorkspace: 'storage:create-workspace',
  getRuntimeSnapshot: 'app:get-runtime-snapshot',
  getStorageSnapshot: 'storage:get-snapshot',
  readProjectFile: 'editor:read-project-file',
  setActiveSelection: 'storage:set-active-selection',
} as const

export interface AideApi {
  createProject: (input: CreateProjectInput) => Promise<PersistenceSnapshot>
  createWorkspace: (input: CreateWorkspaceInput) => Promise<PersistenceSnapshot>
  getRuntimeSnapshot: () => Promise<RuntimeSnapshot>
  getStorageSnapshot: () => Promise<PersistenceSnapshot>
  readProjectFile: (relativePath: string) => Promise<ProjectTextFile>
  setActiveSelection: (input: SetActiveSelectionInput) => Promise<void>
}

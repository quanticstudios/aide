import type { ProjectTextFile } from './editor'
import type {
  ExecutableProbeInput,
  ExecutableProbeResult,
  ExecutableValidationResult,
} from './executable'
import type {
  CreateProjectInput,
  CreateWorkspaceInput,
  PersistenceSnapshot,
  SetActiveSelectionInput,
} from './persistence'
import type { RuntimeSnapshot } from './runtime'
import type {
  TerminalEvent,
  TerminalResizeInput,
  TerminalSessionConfig,
} from './terminal'

export const IPC_CHANNELS = {
  createProject: 'storage:create-project',
  createWorkspace: 'storage:create-workspace',
  executableProbe: 'executables:probe',
  executableValidate: 'executables:validate',
  getRuntimeSnapshot: 'app:get-runtime-snapshot',
  getStorageSnapshot: 'storage:get-snapshot',
  readProjectFile: 'editor:read-project-file',
  setActiveSelection: 'storage:set-active-selection',
  terminalCreate: 'terminal:create-session',
  terminalEvent: 'terminal:event',
  terminalKill: 'terminal:kill-session',
  terminalResize: 'terminal:resize-session',
  terminalWrite: 'terminal:write',
} as const

export interface AideApi {
  createProject: (input: CreateProjectInput) => Promise<PersistenceSnapshot>
  createWorkspace: (input: CreateWorkspaceInput) => Promise<PersistenceSnapshot>
  probeExecutableCommand: (
    input: ExecutableProbeInput,
  ) => Promise<ExecutableProbeResult>
  validateExecutableCommand: (
    command: string,
  ) => Promise<ExecutableValidationResult>
  getRuntimeSnapshot: () => Promise<RuntimeSnapshot>
  getStorageSnapshot: () => Promise<PersistenceSnapshot>
  createTerminalSession: (input: TerminalSessionConfig) => Promise<void>
  killTerminalSession: (sessionId: string) => Promise<void>
  onTerminalEvent: (callback: (event: TerminalEvent) => void) => () => void
  readProjectFile: (relativePath: string) => Promise<ProjectTextFile>
  resizeTerminalSession: (
    sessionId: string,
    size: TerminalResizeInput,
  ) => Promise<void>
  setActiveSelection: (input: SetActiveSelectionInput) => Promise<void>
  writeTerminalInput: (sessionId: string, data: string) => Promise<void>
}

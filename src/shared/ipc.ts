import type { ProjectTextFile } from './editor'
import type {
  ExecutableProbeInput,
  ExecutableProbeResult,
  ExecutableValidationResult,
} from './executable'
import type {
  CreateWorkspaceRequest,
  ImportProjectResult,
  ProjectRefRecord,
  WorkspaceGitDiffResult,
  WorkspaceGitStatusResult,
  WorktreeBranchStatsResult,
} from './git'
import type {
  ManagedSessionConfig,
  ManagedSessionDecision,
  ManagedSessionEvent,
  ManagedSessionSnapshot,
} from './managed-session'
import type {
  PersistenceSnapshot,
  SaveWorkspaceLayoutInput,
  SaveWorkspaceSurfaceStateInput,
  SetActiveSelectionInput,
} from './persistence'
import type { RuntimeSnapshot } from './runtime'
import type { AppShortcutEvent } from './shortcuts'
import type {
  TerminalEvent,
  TerminalResizeInput,
  TerminalSessionConfig,
  TerminalSessionSnapshot,
} from './terminal'
import type {
  WorkspaceActivityEvent,
  WorkspaceActivitySnapshot,
} from './workspace-activity'

export const IPC_CHANNELS = {
  createWorkspace: 'storage:create-workspace',
  editorList: 'app:editor-list',
  editorLaunch: 'app:editor-launch',
  executableProbe: 'executables:probe',
  executableValidate: 'executables:validate',
  appShortcut: 'app:shortcut',
  getRuntimeSnapshot: 'app:get-runtime-snapshot',
  pickProjectRoot: 'app:pick-project-root',
  importProject: 'app:import-project',
  listProjectRefs: 'app:list-project-refs',
  getWorkspaceGitStatus: 'app:get-workspace-git-status',
  getWorkspaceGitDiff: 'app:get-workspace-git-diff',
  getWorktreeBranchStats: 'app:get-worktree-branch-stats',
  saveWorkspaceLayout: 'storage:save-workspace-layout',
  saveWorkspaceSurfaceState: 'storage:save-workspace-surface-state',
  getStorageSnapshot: 'storage:get-snapshot',
  getWorkspaceActivitySnapshot: 'app:get-workspace-activity-snapshot',
  getManagedSessionSnapshots: 'app:get-managed-session-snapshots',
  readProjectFile: 'editor:read-project-file',
  setActiveSelection: 'storage:set-active-selection',
  workspaceActivityEvent: 'app:workspace-activity',
  managedSessionCreate: 'managed-session:create',
  managedSessionClose: 'managed-session:close',
  managedSessionEvent: 'managed-session:event',
  managedSessionInterrupt: 'managed-session:interrupt',
  managedSessionResolveRequest: 'managed-session:resolve-request',
  managedSessionResolveUserInput: 'managed-session:resolve-user-input',
  managedSessionSendInput: 'managed-session:send-input',
  terminalCreate: 'terminal:create-session',
  terminalEvent: 'terminal:event',
  terminalKill: 'terminal:kill-session',
  terminalResize: 'terminal:resize-session',
  terminalWrite: 'terminal:write',
} as const

export interface AvailableEditorDescriptor {
  readonly command: string
  readonly id: string
  readonly label: string
}

export interface AideApi {
  createWorkspace: (
    input: CreateWorkspaceRequest,
  ) => Promise<PersistenceSnapshot>
  importProject: (repoPath: string) => Promise<ImportProjectResult>
  listAvailableEditors: () => Promise<AvailableEditorDescriptor[]>
  launchEditor: (editorId: string, cwd: string) => Promise<void>
  listProjectRefs: (projectId: string) => Promise<ProjectRefRecord[]>
  getWorkspaceGitStatus: (
    workspaceId: string,
  ) => Promise<WorkspaceGitStatusResult>
  getWorkspaceGitDiff: (
    workspaceId: string,
    filePath: string,
  ) => Promise<WorkspaceGitDiffResult>
  getWorktreeBranchStats: (
    workspaceId: string,
  ) => Promise<WorktreeBranchStatsResult>
  pickProjectRoot: (defaultPath?: string | null) => Promise<string | null>
  onAppShortcut: (callback: (event: AppShortcutEvent) => void) => () => void
  probeExecutableCommand: (
    input: ExecutableProbeInput,
  ) => Promise<ExecutableProbeResult>
  validateExecutableCommand: (
    command: string,
  ) => Promise<ExecutableValidationResult>
  getRuntimeSnapshot: () => Promise<RuntimeSnapshot>
  getStorageSnapshot: () => Promise<PersistenceSnapshot>
  getWorkspaceActivitySnapshot: () => Promise<
    Record<string, WorkspaceActivitySnapshot[]>
  >
  getManagedSessionSnapshots: () => Promise<
    Record<string, ManagedSessionSnapshot>
  >
  saveWorkspaceLayout: (
    workspaceId: string,
    input: SaveWorkspaceLayoutInput,
  ) => Promise<PersistenceSnapshot>
  saveWorkspaceSurfaceState: (
    workspaceId: string,
    input: SaveWorkspaceSurfaceStateInput,
  ) => Promise<PersistenceSnapshot>
  createTerminalSession: (
    input: TerminalSessionConfig,
  ) => Promise<TerminalSessionSnapshot>
  createManagedSession: (
    input: ManagedSessionConfig,
  ) => Promise<ManagedSessionSnapshot>
  closeManagedSession: (sessionId: string) => Promise<void>
  interruptManagedSession: (sessionId: string) => Promise<void>
  killTerminalSession: (sessionId: string) => Promise<void>
  onManagedSessionEvent: (
    callback: (event: ManagedSessionEvent) => void,
  ) => () => void
  onTerminalEvent: (callback: (event: TerminalEvent) => void) => () => void
  onWorkspaceActivity: (
    callback: (event: WorkspaceActivityEvent) => void,
  ) => () => void
  readProjectFile: (relativePath: string) => Promise<ProjectTextFile>
  resizeTerminalSession: (
    sessionId: string,
    size: TerminalResizeInput,
  ) => Promise<void>
  setActiveSelection: (input: SetActiveSelectionInput) => Promise<void>
  resolveManagedSessionRequest: (
    sessionId: string,
    requestId: string,
    decision: ManagedSessionDecision,
  ) => Promise<void>
  resolveManagedSessionUserInput: (
    sessionId: string,
    requestId: string,
    answers: Record<string, string | string[]>,
  ) => Promise<void>
  sendManagedSessionInput: (sessionId: string, text: string) => Promise<void>
  writeTerminalInput: (sessionId: string, data: string) => Promise<void>
}

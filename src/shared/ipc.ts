import type { ProjectTextFile } from './editor'
import type {
  ExecutableProbeInput,
  ExecutableProbeResult,
  ExecutableValidationResult,
} from './executable'
import type {
  AttachWorkspaceRequest,
  CreateWorkspaceRequest,
  DetectWorktreeBranchResult,
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
  WorkspacePersistenceEvent,
  WorkspacePersistenceResult,
} from './persistence'
import type {
  PreviewEvent,
  PreviewNavigationReport,
  WorkspacePreviewSnapshot,
} from './preview'
import type { RuntimeSnapshot } from './runtime'
import type { AppShortcutEvent } from './shortcuts'
import type {
  ManagedSessionMode,
  TerminalEvent,
  TerminalResizeInput,
  TerminalSessionConfig,
  TerminalSessionSnapshot,
} from './terminal'
import type {
  WorkspaceActivityCollectionSnapshot,
  WorkspaceActivityEvent,
} from './workspace-activity'

export const IPC_CHANNELS = {
  attachWorkspace: 'storage:attach-workspace',
  createWorkspace: 'storage:create-workspace',
  detectWorktreeBranch: 'app:detect-worktree-branch',
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
  getWorkspacePreviewSnapshot: 'preview:get-workspace-snapshot',
  readProjectFile: 'editor:read-project-file',
  setActiveSelection: 'storage:set-active-selection',
  workspaceActivityEvent: 'app:workspace-activity',
  workspacePersistenceEvent: 'storage:persistence-event',
  managedSessionCreate: 'managed-session:create',
  managedSessionClose: 'managed-session:close',
  managedSessionEvent: 'managed-session:event',
  managedSessionInterrupt: 'managed-session:interrupt',
  managedSessionResolveRequest: 'managed-session:resolve-request',
  managedSessionResolveUserInput: 'managed-session:resolve-user-input',
  managedSessionSendInput: 'managed-session:send-input',
  managedSessionSwitchProvider: 'managed-session:switch-provider',
  previewCloseTab: 'preview:close-tab',
  previewEvent: 'preview:event',
  previewNavigate: 'preview:navigate',
  previewOpenTab: 'preview:open-tab',
  previewReportNavigation: 'preview:report-navigation',
  previewSelectTab: 'preview:select-tab',
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
  attachWorkspace: (
    input: AttachWorkspaceRequest,
  ) => Promise<PersistenceSnapshot>
  createWorkspace: (
    input: CreateWorkspaceRequest,
  ) => Promise<PersistenceSnapshot>
  detectWorktreeBranch: (
    worktreePath: string,
  ) => Promise<DetectWorktreeBranchResult>
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
    Record<string, WorkspaceActivityCollectionSnapshot>
  >
  getManagedSessionSnapshots: () => Promise<
    Record<string, ManagedSessionSnapshot>
  >
  getWorkspacePreviewSnapshot: (
    workspaceId: string,
  ) => Promise<WorkspacePreviewSnapshot>
  saveWorkspaceLayout: (
    workspaceId: string,
    input: SaveWorkspaceLayoutInput,
  ) => Promise<WorkspacePersistenceResult>
  saveWorkspaceSurfaceState: (
    workspaceId: string,
    input: SaveWorkspaceSurfaceStateInput,
  ) => Promise<WorkspacePersistenceResult>
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
  onPreviewEvent: (callback: (event: PreviewEvent) => void) => () => void
  onTerminalEvent: (callback: (event: TerminalEvent) => void) => () => void
  onWorkspaceActivity: (
    callback: (event: WorkspaceActivityEvent) => void,
  ) => () => void
  onWorkspacePersistence: (
    callback: (event: WorkspacePersistenceEvent) => void,
  ) => () => void
  readProjectFile: (relativePath: string) => Promise<ProjectTextFile>
  closePreviewTab: (
    workspaceId: string,
    tabId: string,
  ) => Promise<WorkspacePreviewSnapshot>
  navigatePreviewTab: (
    workspaceId: string,
    tabId: string,
    url: string,
  ) => Promise<WorkspacePreviewSnapshot>
  openPreviewTab: (
    workspaceId: string,
    url: string,
  ) => Promise<WorkspacePreviewSnapshot>
  reportPreviewNavigation: (
    report: PreviewNavigationReport,
  ) => Promise<WorkspacePreviewSnapshot>
  resizeTerminalSession: (
    sessionId: string,
    size: TerminalResizeInput,
  ) => Promise<void>
  setActiveSelection: (input: SetActiveSelectionInput) => Promise<void>
  selectPreviewTab: (
    workspaceId: string,
    tabId: string,
  ) => Promise<WorkspacePreviewSnapshot>
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
  switchManagedSessionProvider: (
    sessionId: string,
    mode: ManagedSessionMode,
    model?: string,
  ) => Promise<ManagedSessionSnapshot>
  writeTerminalInput: (sessionId: string, data: string) => Promise<void>
}

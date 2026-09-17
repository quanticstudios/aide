import type {
  CheckpointRestoreMode,
  TurnCheckpointPreview,
  TurnCheckpointRestoreResult,
  TurnCheckpointSummary,
} from './checkpoints'
import type { ManagedSessionAgentConfig } from './conversation-routing'
import type {
  DiagnosticEventType,
  DiagnosticsSnapshot,
  SupportBundleExportResult,
} from './diagnostics'
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
import type { JevSettingsInput, JevSettingsStatus } from './jev'
import type {
  ManagedSessionConfig,
  ManagedSessionDecision,
  ManagedSessionEvent,
  ManagedSessionInteractionMode,
  ManagedSessionProviderSelection,
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
  PreviewNavigationReport,
  WorkspacePreviewEvent,
  WorkspacePreviewSnapshot,
} from './preview'
import type { ProviderCapabilitiesSnapshot } from './provider-capabilities'
import type { PersistedStateRecovery } from './recovery'
import type { RuntimeSnapshot } from './runtime'
import type { AppShortcutEvent } from './shortcuts'
import type {
  TerminalEvent,
  TerminalResizeInput,
  TerminalSessionConfig,
  TerminalSessionSnapshot,
} from './terminal'
import type {
  UpdateEvent,
  UpdatePreferencesEvent,
  UpdatePreferencesInput,
  UpdatePreferencesSnapshot,
  UpdateRestartStatus,
  UpdateSnapshot,
} from './update'
import type {
  WorkspaceActivityCollectionSnapshot,
  WorkspaceActivityEvent,
} from './workspace-activity'
import type {
  WorkspaceSetupCollectionSnapshot,
  WorkspaceSetupEvent,
  WorkspaceSetupSnapshot,
} from './workspace-setup'

export const IPC_CHANNELS = {
  getPersistedStateRecovery: 'app:get-persisted-state-recovery',
  openPersistedStateDataFolder: 'app:open-persisted-state-data-folder',
  quitPersistedStateRecovery: 'app:quit-persisted-state-recovery',
  resetPersistedState: 'app:reset-persisted-state',
  restoreKnownGoodPersistedState: 'app:restore-known-good-persisted-state',
  getJevSettings: 'jev:get-settings',
  updateJevSettings: 'jev:update-settings',
  attachWorkspace: 'storage:attach-workspace',
  diagnosticsEvent: 'diagnostics:event',
  exportSupportBundle: 'diagnostics:export-support-bundle',
  getDiagnosticsSnapshot: 'diagnostics:get-snapshot',
  reportRendererFault: 'diagnostics:report-renderer-fault',
  createWorkspace: 'storage:create-workspace',
  detectWorktreeBranch: 'app:detect-worktree-branch',
  editorList: 'app:editor-list',
  editorLaunch: 'app:editor-launch',
  executableProbe: 'executables:probe',
  executableValidate: 'executables:validate',
  appShortcut: 'app:shortcut',
  getRuntimeSnapshot: 'app:get-runtime-snapshot',
  getUpdatePreferences: 'update:get-preferences',
  getUpdateSnapshot: 'update:get-snapshot',
  checkForUpdates: 'update:check',
  downloadUpdate: 'update:download',
  retryUpdate: 'update:retry',
  restartUpdate: 'update:restart',
  updateEvent: 'update:event',
  updatePreferences: 'update:set-preferences',
  updatePreferencesEvent: 'update:preferences-event',
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
  getProviderCapabilities: 'app:get-provider-capabilities',
  getWorkspacePreviewSnapshot: 'preview:get-workspace-snapshot',
  getWorkspacePreviewSnapshots: 'preview:get-workspace-snapshots',
  getWorkspaceSetupSnapshot: 'workspace-setup:get-snapshot',
  readProjectFile: 'editor:read-project-file',
  setActiveSelection: 'storage:set-active-selection',
  workspaceActivityEvent: 'app:workspace-activity',
  workspacePersistenceEvent: 'storage:persistence-event',
  workspaceSetupEvent: 'workspace-setup:event',
  updateProjectSetupCommand: 'storage:update-project-setup-command',
  runWorkspaceSetup: 'workspace-setup:run',
  cancelWorkspaceSetup: 'workspace-setup:cancel',
  managedSessionCreate: 'managed-session:create',
  managedSessionClose: 'managed-session:close',
  managedSessionConfigureAgents: 'managed-session:configure-agents',
  managedSessionConfigureMode: 'managed-session:set-interaction-mode',
  managedSessionEvent: 'managed-session:event',
  managedSessionInterrupt: 'managed-session:interrupt',
  managedSessionResolveRequest: 'managed-session:resolve-request',
  managedSessionResolveUserInput: 'managed-session:resolve-user-input',
  managedSessionSendInput: 'managed-session:send-input',
  managedSessionSwitchProvider: 'managed-session:switch-provider',
  turnCheckpointList: 'turn-checkpoint:list',
  turnCheckpointPreviewRestore: 'turn-checkpoint:preview-restore',
  turnCheckpointRestore: 'turn-checkpoint:restore',
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
  getPersistedStateRecovery: () => Promise<PersistedStateRecovery | null>
  openPersistedStateDataFolder: () => Promise<void>
  quitPersistedStateRecovery: () => Promise<void>
  resetPersistedState: () => Promise<void>
  restoreKnownGoodPersistedState: () => Promise<void>
  getJevSettings: (workspaceId: string) => Promise<JevSettingsStatus>
  updateJevSettings: (
    workspaceId: string,
    input: JevSettingsInput,
  ) => Promise<JevSettingsStatus>
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
  onDiagnosticsEvent: (
    callback: (snapshot: DiagnosticsSnapshot) => void,
  ) => () => void
  onUpdateEvent: (callback: (event: UpdateEvent) => void) => () => void
  onUpdatePreferences: (
    callback: (event: UpdatePreferencesEvent) => void,
  ) => () => void
  probeExecutableCommand: (
    input: ExecutableProbeInput,
  ) => Promise<ExecutableProbeResult>
  validateExecutableCommand: (
    command: string,
  ) => Promise<ExecutableValidationResult>
  getRuntimeSnapshot: () => Promise<RuntimeSnapshot>
  getUpdatePreferences: () => Promise<UpdatePreferencesSnapshot>
  getUpdateSnapshot: () => Promise<UpdateSnapshot>
  checkForUpdates: () => Promise<UpdateSnapshot>
  downloadUpdate: () => Promise<UpdateSnapshot>
  retryUpdate: () => Promise<UpdateSnapshot>
  restartUpdate: (confirmed: boolean) => Promise<UpdateRestartStatus>
  updatePreferences: (
    input: UpdatePreferencesInput,
  ) => Promise<UpdatePreferencesSnapshot>
  getDiagnosticsSnapshot: () => Promise<DiagnosticsSnapshot>
  exportSupportBundle: () => Promise<SupportBundleExportResult>
  reportRendererFault: (
    type: Extract<
      DiagnosticEventType,
      'renderer-exception' | 'renderer-unhandled-rejection'
    >,
  ) => Promise<void>
  getStorageSnapshot: () => Promise<PersistenceSnapshot>
  getWorkspaceActivitySnapshot: () => Promise<WorkspaceActivityCollectionSnapshot>
  getWorkspaceSetupSnapshot: () => Promise<WorkspaceSetupCollectionSnapshot>
  getManagedSessionSnapshots: () => Promise<
    Record<string, ManagedSessionSnapshot>
  >
  getProviderCapabilities: () => Promise<ProviderCapabilitiesSnapshot>
  getWorkspacePreviewSnapshot: (
    workspaceId: string,
  ) => Promise<WorkspacePreviewSnapshot>
  getWorkspacePreviewSnapshots: () => Promise<
    Record<string, WorkspacePreviewSnapshot>
  >
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
  configureManagedSessionAgents: (
    sessionId: string,
    agents: readonly ManagedSessionAgentConfig[],
  ) => Promise<ManagedSessionSnapshot>
  configureManagedSessionMode: (
    sessionId: string,
    interactionMode: ManagedSessionInteractionMode,
  ) => Promise<ManagedSessionSnapshot>
  updateProjectSetupCommand: (
    projectId: string,
    command: string | null,
  ) => Promise<PersistenceSnapshot>
  runWorkspaceSetup: (workspaceId: string) => Promise<WorkspaceSetupSnapshot>
  cancelWorkspaceSetup: (workspaceId: string) => Promise<WorkspaceSetupSnapshot>
  closeManagedSession: (sessionId: string) => Promise<void>
  interruptManagedSession: (
    sessionId: string,
    recipientAlias?: string,
  ) => Promise<void>
  killTerminalSession: (sessionId: string) => Promise<void>
  onManagedSessionEvent: (
    callback: (event: ManagedSessionEvent) => void,
  ) => () => void
  onPreviewEvent: (
    callback: (event: WorkspacePreviewEvent) => void,
  ) => () => void
  onTerminalEvent: (callback: (event: TerminalEvent) => void) => () => void
  onWorkspaceActivity: (
    callback: (event: WorkspaceActivityEvent) => void,
  ) => () => void
  onWorkspacePersistence: (
    callback: (event: WorkspacePersistenceEvent) => void,
  ) => () => void
  onWorkspaceSetup: (
    callback: (event: WorkspaceSetupEvent) => void,
  ) => () => void
  readProjectFile: (
    workspaceId: string,
    relativePath: string,
  ) => Promise<ProjectTextFile>
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
  sendManagedSessionInput: (
    sessionId: string,
    text: string,
    recipients?: readonly string[],
  ) => Promise<void>
  listTurnCheckpoints: (sessionId: string) => Promise<TurnCheckpointSummary[]>
  previewTurnCheckpointRestore: (
    sessionId: string,
    checkpointId: string,
  ) => Promise<TurnCheckpointPreview>
  restoreTurnCheckpoint: (
    previewId: string,
    mode: CheckpointRestoreMode,
  ) => Promise<TurnCheckpointRestoreResult>
  switchManagedSessionProvider: (
    sessionId: string,
    selection: ManagedSessionProviderSelection,
  ) => Promise<ManagedSessionSnapshot>
  writeTerminalInput: (sessionId: string, data: string) => Promise<void>
}

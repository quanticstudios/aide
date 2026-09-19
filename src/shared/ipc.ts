import type {
  CheckpointRestoreMode,
  TurnCheckpointPreview,
  TurnCheckpointRestoreResult,
  TurnCheckpointSummary,
} from './checkpoints'
import type { ComposerDefaults } from './composer-defaults'
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
  WorkspaceGitCommitInput,
  WorkspaceGitDiffResult,
  WorkspaceGitFileMutationInput,
  WorkspaceGitMutationResult,
  WorkspaceGitPullRequestInput,
  WorkspaceGitPullRequestResult,
  WorkspaceGitRevertInput,
  WorkspaceGitStatusResult,
  WorktreeBranchStatsResult,
} from './git'
import type { JevSettingsInput, JevSettingsStatus } from './jev'
import type {
  ManagedSessionAttachment,
  ManagedSessionConfig,
  ManagedSessionDecision,
  ManagedSessionEvent,
  ManagedSessionInteractionMode,
  ManagedSessionProviderSelection,
  ManagedSessionSnapshot,
} from './managed-session'
import type {
  PersistenceSnapshot,
  ProjectAppearance,
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
import type {
  ProviderSkillSelection,
  ProviderSkillsSnapshot,
} from './provider-skills'
import type { PersistedStateRecovery } from './recovery'
import type { RuntimeSnapshot } from './runtime'
import type { AppShortcutEvent } from './shortcuts'
import type { TaskLibrarySnapshot, TaskMetadataUpdate } from './task-library'
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
  getComposerDefaults: 'composer:get-defaults',
  setComposerDefaults: 'composer:set-defaults',
  getJevSettings: 'jev:get-settings',
  updateJevSettings: 'jev:update-settings',
  attachWorkspace: 'storage:attach-workspace',
  diagnosticsEvent: 'diagnostics:event',
  exportSupportBundle: 'diagnostics:export-support-bundle',
  getDiagnosticsSnapshot: 'diagnostics:get-snapshot',
  reportRendererFault: 'diagnostics:report-renderer-fault',
  createWorkspace: 'storage:create-workspace',
  renameWorkspace: 'storage:rename-workspace',
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
  stageWorkspaceGitFile: 'app:stage-workspace-git-file',
  unstageWorkspaceGitFile: 'app:unstage-workspace-git-file',
  revertWorkspaceGitFile: 'app:revert-workspace-git-file',
  commitWorkspaceGitIndex: 'app:commit-workspace-git-index',
  pushWorkspaceGitBranch: 'app:push-workspace-git-branch',
  createWorkspaceGitPullRequest: 'app:create-workspace-git-pull-request',
  getWorkspaceGitPullRequest: 'app:get-workspace-git-pull-request',
  getWorktreeBranchStats: 'app:get-worktree-branch-stats',
  saveWorkspaceLayout: 'storage:save-workspace-layout',
  saveWorkspaceSurfaceState: 'storage:save-workspace-surface-state',
  getStorageSnapshot: 'storage:get-snapshot',
  getWorkspaceActivitySnapshot: 'app:get-workspace-activity-snapshot',
  getManagedSessionSnapshots: 'app:get-managed-session-snapshots',
  getTaskLibrary: 'tasks:list',
  getTaskTranscript: 'tasks:transcript',
  updateTaskMetadata: 'tasks:update',
  setTaskNotifications: 'tasks:notifications',
  taskLibraryChanged: 'tasks:changed',
  taskOpen: 'tasks:open',
  openTask: 'tasks:open-request',
  getProviderCapabilities: 'app:get-provider-capabilities',
  getProviderSkills: 'app:get-provider-skills',
  getWorkspacePreviewSnapshot: 'preview:get-workspace-snapshot',
  getWorkspacePreviewSnapshots: 'preview:get-workspace-snapshots',
  getWorkspaceSetupSnapshot: 'workspace-setup:get-snapshot',
  readProjectFile: 'editor:read-project-file',
  setActiveSelection: 'storage:set-active-selection',
  workspaceActivityEvent: 'app:workspace-activity',
  workspacePersistenceEvent: 'storage:persistence-event',
  workspaceSetupEvent: 'workspace-setup:event',
  updateProjectSetupCommand: 'storage:update-project-setup-command',
  updateProjectAppearance: 'storage:update-project-appearance',
  runWorkspaceSetup: 'workspace-setup:run',
  cancelWorkspaceSetup: 'workspace-setup:cancel',
  managedSessionCreate: 'managed-session:create',
  managedSessionBranch: 'managed-session:branch',
  managedFleetAcceptNode: 'managed-session:accept-fleet-node',
  managedSessionClose: 'managed-session:close',
  managedSessionConfigureAgents: 'managed-session:configure-agents',
  managedSessionConfigureMode: 'managed-session:set-interaction-mode',
  managedSessionEvent: 'managed-session:event',
  managedSessionInterrupt: 'managed-session:interrupt',
  managedSessionCancelQueuedInput: 'managed-session:cancel-queued-input',
  managedSessionPickFiles: 'managed-session:pick-files',
  managedSessionSearchFiles: 'managed-session:search-files',
  managedSessionResumeQueue: 'managed-session:resume-queue',
  managedSessionResolveRequest: 'managed-session:resolve-request',
  managedSessionResolveUserInput: 'managed-session:resolve-user-input',
  managedSessionSendInput: 'managed-session:send-input',
  managedSessionSendQueuedInputNow: 'managed-session:send-queued-input-now',
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
  acceptManagedFleetNode: (input: {
    sessionId: string
    nodeId: string
    accepted: boolean
  }) => Promise<void>
  getPersistedStateRecovery: () => Promise<PersistedStateRecovery | null>
  openPersistedStateDataFolder: () => Promise<void>
  quitPersistedStateRecovery: () => Promise<void>
  resetPersistedState: () => Promise<void>
  restoreKnownGoodPersistedState: () => Promise<void>
  getComposerDefaults: (workspaceId: string) => Promise<ComposerDefaults | null>
  setComposerDefaults: (
    workspaceId: string,
    defaults: ComposerDefaults,
  ) => Promise<ComposerDefaults>
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
  renameWorkspace: (
    workspaceId: string,
    name: string,
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
  stageWorkspaceGitFile: (
    input: WorkspaceGitFileMutationInput,
  ) => Promise<WorkspaceGitMutationResult>
  unstageWorkspaceGitFile: (
    input: WorkspaceGitFileMutationInput,
  ) => Promise<WorkspaceGitMutationResult>
  revertWorkspaceGitFile: (
    input: WorkspaceGitRevertInput,
  ) => Promise<WorkspaceGitMutationResult>
  commitWorkspaceGitIndex: (
    input: WorkspaceGitCommitInput,
  ) => Promise<WorkspaceGitMutationResult>
  pushWorkspaceGitBranch: (
    workspaceId: string,
  ) => Promise<WorkspaceGitMutationResult>
  createWorkspaceGitPullRequest: (
    input: WorkspaceGitPullRequestInput,
  ) => Promise<WorkspaceGitPullRequestResult>
  getWorkspaceGitPullRequest: (
    workspaceId: string,
  ) => Promise<WorkspaceGitPullRequestResult>
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
  getTaskLibrary: (query?: string) => Promise<TaskLibrarySnapshot>
  getTaskTranscript: (
    sessionId: string,
  ) => Promise<ManagedSessionSnapshot | null>
  updateTaskMetadata: (
    sessionId: string,
    input: TaskMetadataUpdate,
  ) => Promise<TaskLibrarySnapshot>
  setTaskNotifications: (enabled: boolean) => Promise<TaskLibrarySnapshot>
  onTaskLibraryChanged: (callback: () => void) => () => void
  onTaskOpen: (callback: (sessionId: string) => void) => () => void
  openTask: (sessionId: string) => Promise<void>
  getProviderCapabilities: () => Promise<ProviderCapabilitiesSnapshot>
  getProviderSkills: (
    workspaceId: string,
    forceReload?: boolean,
  ) => Promise<ProviderSkillsSnapshot>
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
  branchManagedSession: (
    sessionId: string,
    responseContentItemId: string,
  ) => Promise<void>
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
  updateProjectAppearance: (
    projectId: string,
    input: ProjectAppearance,
  ) => Promise<PersistenceSnapshot>
  runWorkspaceSetup: (workspaceId: string) => Promise<WorkspaceSetupSnapshot>
  cancelWorkspaceSetup: (workspaceId: string) => Promise<WorkspaceSetupSnapshot>
  closeManagedSession: (sessionId: string) => Promise<void>
  interruptManagedSession: (
    sessionId: string,
    recipientAlias?: string,
  ) => Promise<void>
  cancelManagedSessionQueuedInput: (
    sessionId: string,
    queuedInputId: string,
  ) => Promise<void>
  pickManagedSessionFiles: (workspaceId: string) => Promise<string[]>
  searchManagedSessionFiles: (
    workspaceId: string,
    query: string,
  ) => Promise<string[]>
  resumeManagedSessionQueue: (sessionId: string) => Promise<void>
  sendManagedSessionQueuedInputNow: (
    sessionId: string,
    queuedInputId: string,
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
    attachments?: readonly ManagedSessionAttachment[],
    selectedSkill?: ProviderSkillSelection,
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

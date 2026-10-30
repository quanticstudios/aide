import type {
  CheckpointRestoreMode,
  TurnCheckpointDiff,
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
  WorkspaceDiffScope,
  WorkspaceGitDiffResult,
  WorkspaceGitFileMutationInput,
  WorkspaceGitMessageInput,
  WorkspaceGitMessageResult,
  WorkspaceGitMutationResult,
  WorkspaceGitPullRequestInput,
  WorkspaceGitPullRequestResult,
  WorkspaceGitPullResult,
  WorkspaceGitRevertInput,
  WorkspaceGitStatusResult,
  WorkspaceScopeDiffResult,
  WorktreeBranchStatsResult,
} from './git'
import type { JevSettingsInput, JevSettingsStatus } from './jev'
import type {
  JevGateOverrides,
  JevGateScope,
  JevGateSnapshot,
} from './jev-gates'
import type {
  ManagedSessionAttachment,
  ManagedSessionConfig,
  ManagedSessionDecision,
  ManagedSessionInteractionMode,
  ManagedSessionPermissionMode,
  ManagedSessionProviderSelection,
  ManagedSessionQueueAction,
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
import type { SessionDelta, SessionDeltaState } from './session-delta'
import type { AppShortcutEvent } from './shortcuts'
import type { TaskLibrarySnapshot, TaskMetadataUpdate } from './task-library'
import type { TaskNotificationEvent } from './task-notification'
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

/** What main sends on `managedSessionEvent`: one frame's deltas for a session, or its removal. */
export type ManagedSessionIpcEvent =
  | { deltas: SessionDelta[]; sessionId: string; type: 'deltas' }
  | { revision: number; sessionId: string; type: 'removed' }

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
  getJevGates: 'jev:get-gates',
  updateJevGates: 'jev:update-gates',
  attachWorkspace: 'storage:attach-workspace',
  diagnosticsEvent: 'diagnostics:event',
  exportSupportBundle: 'diagnostics:export-support-bundle',
  getDiagnosticsSnapshot: 'diagnostics:get-snapshot',
  reportRendererFault: 'diagnostics:report-renderer-fault',
  createWorkspace: 'storage:create-workspace',
  renameWorkspace: 'storage:rename-workspace',
  updateWorkspaceSidebar: 'storage:update-workspace-sidebar',
  archiveWorkspace: 'storage:archive-workspace',
  deleteWorkspace: 'storage:delete-workspace',
  detectWorktreeBranch: 'app:detect-worktree-branch',
  editorList: 'app:editor-list',
  editorLaunch: 'app:editor-launch',
  editorOpenFile: 'app:editor-open-file',
  openExternal: 'app:open-external',
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
  commitAllAndPushWorkspaceGit: 'app:commit-all-and-push-workspace-git',
  pushWorkspaceGitBranch: 'app:push-workspace-git-branch',
  pullWorkspaceGitBranch: 'app:pull-workspace-git-branch',
  abortWorkspaceGitPull: 'app:abort-workspace-git-pull',
  startWorkspaceGitFeatureBranch: 'app:start-workspace-git-feature-branch',
  generateWorkspaceGitMessage: 'app:generate-workspace-git-message',
  createWorkspaceGitPullRequest: 'app:create-workspace-git-pull-request',
  getWorkspaceGitPullRequest: 'app:get-workspace-git-pull-request',
  getWorktreeBranchStats: 'app:get-worktree-branch-stats',
  getWorkspaceScopeDiff: 'app:get-workspace-scope-diff',
  saveWorkspaceLayout: 'storage:save-workspace-layout',
  saveWorkspaceSurfaceState: 'storage:save-workspace-surface-state',
  getStorageSnapshot: 'storage:get-snapshot',
  getWorkspaceActivitySnapshot: 'app:get-workspace-activity-snapshot',
  getManagedSessionSnapshots: 'app:get-managed-session-snapshots',
  getTaskLibrary: 'tasks:list',
  getTaskTranscript: 'tasks:transcript',
  updateTaskMetadata: 'tasks:update',
  setTaskNotifications: 'tasks:notifications',
  setTaskNotificationSounds: 'tasks:notification-sounds',
  taskNotification: 'tasks:notification',
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
  managedSessionImplementPlanInNewThread:
    'managed-session:implement-plan-in-new-thread',
  managedSessionSavePlan: 'managed-session:save-plan',
  managedFleetAcceptNode: 'managed-session:accept-fleet-node',
  managedSessionClose: 'managed-session:close',
  managedSessionConfigureAgents: 'managed-session:configure-agents',
  managedSessionConfigureJevGates: 'managed-session:configure-jev-gates',
  managedSessionConfigureMode: 'managed-session:set-interaction-mode',
  managedSessionConfigurePermissionMode: 'managed-session:set-permission-mode',
  managedSessionEvent: 'managed-session:event',
  managedSessionSync: 'managed-session:sync',
  managedSessionInterrupt: 'managed-session:interrupt',
  managedSessionPickFiles: 'managed-session:pick-files',
  managedSessionSearchFiles: 'managed-session:search-files',
  managedSessionResolveRequest: 'managed-session:resolve-request',
  managedSessionResolveUserInput: 'managed-session:resolve-user-input',
  managedSessionQueueInput: 'managed-session:queue-input',
  managedSessionSendInput: 'managed-session:send-input',
  managedSessionUpdateQueue: 'managed-session:update-queue',
  managedSessionSwitchProvider: 'managed-session:switch-provider',
  turnCheckpointDiff: 'turn-checkpoint:diff',
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
  getJevGates: (workspaceId: string | null) => Promise<JevGateSnapshot>
  updateJevGates: (
    scope: JevGateScope,
    workspaceId: string | null,
    overrides: JevGateOverrides,
  ) => Promise<JevGateSnapshot>
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
  updateWorkspaceSidebar: (
    workspaceId: string,
    isOpen: boolean,
  ) => Promise<PersistenceSnapshot>
  archiveWorkspace: (
    workspaceId: string,
    archived: boolean,
  ) => Promise<PersistenceSnapshot>
  deleteWorkspace: (
    workspaceId: string,
    removeWorktree: boolean,
  ) => Promise<PersistenceSnapshot>
  detectWorktreeBranch: (
    worktreePath: string,
  ) => Promise<DetectWorktreeBranchResult>
  importProject: (repoPath: string) => Promise<ImportProjectResult>
  listAvailableEditors: () => Promise<AvailableEditorDescriptor[]>
  launchEditor: (editorId: string, cwd: string) => Promise<void>
  openWorkspaceFile: (
    workspaceId: string,
    relativePath: string,
    line: number | null,
  ) => Promise<void>
  openExternal: (url: string) => Promise<void>
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
  commitAllAndPushWorkspaceGit: (
    input: WorkspaceGitCommitInput,
  ) => Promise<WorkspaceGitMutationResult>
  pushWorkspaceGitBranch: (
    workspaceId: string,
  ) => Promise<WorkspaceGitMutationResult>
  pullWorkspaceGitBranch: (
    workspaceId: string,
  ) => Promise<WorkspaceGitPullResult>
  abortWorkspaceGitPull: (
    workspaceId: string,
  ) => Promise<WorkspaceGitMutationResult>
  startWorkspaceGitFeatureBranch: (
    input: WorkspaceGitCommitInput,
  ) => Promise<WorkspaceGitMutationResult>
  generateWorkspaceGitMessage: (
    input: WorkspaceGitMessageInput,
  ) => Promise<WorkspaceGitMessageResult>
  createWorkspaceGitPullRequest: (
    input: WorkspaceGitPullRequestInput,
  ) => Promise<WorkspaceGitPullRequestResult>
  getWorkspaceGitPullRequest: (
    workspaceId: string,
  ) => Promise<WorkspaceGitPullRequestResult>
  getWorktreeBranchStats: (
    workspaceId: string,
  ) => Promise<WorktreeBranchStatsResult>
  getWorkspaceScopeDiff: (
    workspaceId: string,
    scope: Exclude<WorkspaceDiffScope, 'turn'>,
  ) => Promise<WorkspaceScopeDiffResult>
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
  syncManagedSession: (sessionId: string) => Promise<SessionDeltaState | null>
  getTaskLibrary: (query?: string) => Promise<TaskLibrarySnapshot>
  getTaskTranscript: (
    sessionId: string,
  ) => Promise<ManagedSessionSnapshot | null>
  updateTaskMetadata: (
    sessionId: string,
    input: TaskMetadataUpdate,
  ) => Promise<TaskLibrarySnapshot>
  setTaskNotifications: (enabled: boolean) => Promise<TaskLibrarySnapshot>
  setTaskNotificationSounds: (enabled: boolean) => Promise<TaskLibrarySnapshot>
  onTaskNotification: (
    callback: (event: TaskNotificationEvent) => void,
  ) => () => void
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
  implementManagedSessionPlanInNewThread: (
    sessionId: string,
    requestId: string,
  ) => Promise<void>
  /** Asks where to save the plan inside the workspace; resolves to the saved path, or null if cancelled. */
  saveManagedSessionPlan: (
    workspaceId: string,
    plan: string,
  ) => Promise<string | null>
  configureManagedSessionAgents: (
    sessionId: string,
    agents: readonly ManagedSessionAgentConfig[],
  ) => Promise<ManagedSessionSnapshot>
  configureManagedSessionJevGates: (
    sessionId: string,
    overrides: JevGateOverrides | null,
  ) => Promise<ManagedSessionSnapshot>
  configureManagedSessionMode: (
    sessionId: string,
    interactionMode: ManagedSessionInteractionMode,
  ) => Promise<ManagedSessionSnapshot>
  configureManagedSessionPermissionMode: (
    sessionId: string,
    permissionMode: ManagedSessionPermissionMode,
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
  pickManagedSessionFiles: (workspaceId: string) => Promise<string[]>
  searchManagedSessionFiles: (
    workspaceId: string,
    query: string,
  ) => Promise<string[]>
  killTerminalSession: (sessionId: string) => Promise<void>
  onManagedSessionEvent: (
    callback: (event: ManagedSessionIpcEvent) => void,
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
    reason?: string,
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
  queueManagedSessionInput: AideApi['sendManagedSessionInput']
  updateManagedSessionQueue: (
    sessionId: string,
    action: ManagedSessionQueueAction,
  ) => Promise<void>
  getTurnCheckpointDiff: (
    sessionId: string,
    checkpointId: string,
  ) => Promise<TurnCheckpointDiff>
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

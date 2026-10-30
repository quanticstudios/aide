import { contextBridge, ipcRenderer } from 'electron'
import type { CheckpointRestoreMode } from '../shared/checkpoints'
import type { ManagedSessionAgentConfig } from '../shared/conversation-routing'
import type { DiagnosticsSnapshot } from '../shared/diagnostics'
import type { ExecutableProbeInput } from '../shared/executable'
import {
  type AideApi,
  IPC_CHANNELS,
  type ManagedSessionIpcEvent,
} from '../shared/ipc'
import type {
  ManagedSessionAttachment,
  ManagedSessionConfig,
  ManagedSessionDecision,
  ManagedSessionInteractionMode,
  ManagedSessionPermissionMode,
  ManagedSessionProviderSelection,
} from '../shared/managed-session'
import type {
  ProjectAppearance,
  WorkspacePersistenceEvent,
} from '../shared/persistence'
import type { PreviewNavigationReport } from '../shared/preview'
import type { ProviderSkillSelection } from '../shared/provider-skills'
import type { AppShortcutEvent } from '../shared/shortcuts'
import type { TaskNotificationEvent } from '../shared/task-notification'
import type {
  TerminalEvent,
  TerminalResizeInput,
  TerminalSessionConfig,
} from '../shared/terminal'
import type { UpdateEvent, UpdatePreferencesEvent } from '../shared/update'
import type { WorkspaceActivityEvent } from '../shared/workspace-activity'
import type { WorkspaceSetupEvent } from '../shared/workspace-setup'

const aideApi: AideApi = {
  getTaskLibrary: (query) =>
    ipcRenderer.invoke(IPC_CHANNELS.getTaskLibrary, query),
  getTaskTranscript: (sessionId) =>
    ipcRenderer.invoke(IPC_CHANNELS.getTaskTranscript, sessionId),
  openTask: (sessionId) => ipcRenderer.invoke(IPC_CHANNELS.openTask, sessionId),
  updateTaskMetadata: (sessionId, input) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateTaskMetadata, sessionId, input),
  setTaskNotifications: (enabled) =>
    ipcRenderer.invoke(IPC_CHANNELS.setTaskNotifications, enabled),
  setTaskNotificationSounds: (enabled) =>
    ipcRenderer.invoke(IPC_CHANNELS.setTaskNotificationSounds, enabled),
  onTaskNotification: (callback) => {
    const listener = (_event: unknown, notification: TaskNotificationEvent) =>
      callback(notification)
    ipcRenderer.on(IPC_CHANNELS.taskNotification, listener)
    return () => {
      ipcRenderer.off(IPC_CHANNELS.taskNotification, listener)
    }
  },
  onTaskLibraryChanged: (callback) => {
    const listener = () => callback()
    ipcRenderer.on(IPC_CHANNELS.taskLibraryChanged, listener)
    return () => {
      ipcRenderer.off(IPC_CHANNELS.taskLibraryChanged, listener)
    }
  },
  onTaskOpen: (callback) => {
    const listener = (_event: unknown, sessionId: string) => callback(sessionId)
    ipcRenderer.on(IPC_CHANNELS.taskOpen, listener)
    return () => {
      ipcRenderer.off(IPC_CHANNELS.taskOpen, listener)
    }
  },
  getPersistedStateRecovery: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getPersistedStateRecovery),
  openPersistedStateDataFolder: () =>
    ipcRenderer.invoke(IPC_CHANNELS.openPersistedStateDataFolder),
  quitPersistedStateRecovery: () =>
    ipcRenderer.invoke(IPC_CHANNELS.quitPersistedStateRecovery),
  resetPersistedState: () =>
    ipcRenderer.invoke(IPC_CHANNELS.resetPersistedState),
  restoreKnownGoodPersistedState: () =>
    ipcRenderer.invoke(IPC_CHANNELS.restoreKnownGoodPersistedState),
  getComposerDefaults: (workspaceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.getComposerDefaults, workspaceId),
  setComposerDefaults: (workspaceId, defaults) =>
    ipcRenderer.invoke(IPC_CHANNELS.setComposerDefaults, workspaceId, defaults),
  getJevSettings: (workspaceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.getJevSettings, workspaceId),
  updateJevSettings: (workspaceId, input) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateJevSettings, workspaceId, input),
  getJevGates: (workspaceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.getJevGates, workspaceId),
  updateJevGates: (scope, workspaceId, overrides) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.updateJevGates,
      scope,
      workspaceId,
      overrides,
    ),
  attachWorkspace: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.attachWorkspace, input),
  createTerminalSession: (input: TerminalSessionConfig) =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalCreate, input),
  createManagedSession: (input: ManagedSessionConfig) =>
    ipcRenderer.invoke(IPC_CHANNELS.managedSessionCreate, input),
  branchManagedSession: (sessionId: string, responseContentItemId: string) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.managedSessionBranch,
      sessionId,
      responseContentItemId,
    ),
  implementManagedSessionPlanInNewThread: (sessionId, requestId) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.managedSessionImplementPlanInNewThread,
      sessionId,
      requestId,
    ),
  saveManagedSessionPlan: (workspaceId, plan) =>
    ipcRenderer.invoke(IPC_CHANNELS.managedSessionSavePlan, workspaceId, plan),
  acceptManagedFleetNode: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.managedFleetAcceptNode, input),
  configureManagedSessionJevGates: (sessionId: string, overrides) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.managedSessionConfigureJevGates,
      sessionId,
      overrides,
    ),
  configureManagedSessionAgents: (
    sessionId: string,
    agents: readonly ManagedSessionAgentConfig[],
  ) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.managedSessionConfigureAgents,
      sessionId,
      agents,
    ),
  configureManagedSessionMode: (
    sessionId: string,
    interactionMode: ManagedSessionInteractionMode,
  ) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.managedSessionConfigureMode,
      sessionId,
      interactionMode,
    ),
  configureManagedSessionPermissionMode: (
    sessionId: string,
    permissionMode: ManagedSessionPermissionMode,
  ) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.managedSessionConfigurePermissionMode,
      sessionId,
      permissionMode,
    ),
  createWorkspace: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.createWorkspace, input),
  renameWorkspace: (workspaceId, name) =>
    ipcRenderer.invoke(IPC_CHANNELS.renameWorkspace, workspaceId, name),
  updateWorkspaceSidebar: (workspaceId, isOpen) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.updateWorkspaceSidebar,
      workspaceId,
      isOpen,
    ),
  archiveWorkspace: (workspaceId, archived) =>
    ipcRenderer.invoke(IPC_CHANNELS.archiveWorkspace, workspaceId, archived),
  deleteWorkspace: (workspaceId, removeWorktree) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.deleteWorkspace,
      workspaceId,
      removeWorktree,
    ),
  detectWorktreeBranch: (worktreePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.detectWorktreeBranch, worktreePath),
  closeManagedSession: (sessionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.managedSessionClose, sessionId),
  exportSupportBundle: () =>
    ipcRenderer.invoke(IPC_CHANNELS.exportSupportBundle),
  getDiagnosticsSnapshot: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getDiagnosticsSnapshot),
  getRuntimeSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getRuntimeSnapshot),
  getUpdatePreferences: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getUpdatePreferences),
  getUpdateSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getUpdateSnapshot),
  checkForUpdates: () => ipcRenderer.invoke(IPC_CHANNELS.checkForUpdates),
  downloadUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.downloadUpdate),
  retryUpdate: () => ipcRenderer.invoke(IPC_CHANNELS.retryUpdate),
  restartUpdate: (confirmed: boolean) =>
    ipcRenderer.invoke(IPC_CHANNELS.restartUpdate, confirmed),
  updatePreferences: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.updatePreferences, input),
  getStorageSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getStorageSnapshot),
  getManagedSessionSnapshots: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getManagedSessionSnapshots),
  syncManagedSession: (sessionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.managedSessionSync, sessionId),
  getProviderCapabilities: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getProviderCapabilities),
  getProviderSkills: (workspaceId: string, forceReload?: boolean) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.getProviderSkills,
      workspaceId,
      forceReload,
    ),
  getWorkspacePreviewSnapshot: (workspaceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.getWorkspacePreviewSnapshot, workspaceId),
  getWorkspacePreviewSnapshots: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getWorkspacePreviewSnapshots),
  getWorkspaceActivitySnapshot: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getWorkspaceActivitySnapshot),
  getWorkspaceSetupSnapshot: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getWorkspaceSetupSnapshot),
  importProject: (repoPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.importProject, repoPath),
  launchEditor: (editorId: string, cwd: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.editorLaunch, editorId, cwd),
  listAvailableEditors: () => ipcRenderer.invoke(IPC_CHANNELS.editorList),
  openWorkspaceFile: (workspaceId, relativePath, line) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.editorOpenFile,
      workspaceId,
      relativePath,
      line,
    ),
  openExternal: (url) => ipcRenderer.invoke(IPC_CHANNELS.openExternal, url),
  listProjectRefs: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listProjectRefs, projectId),
  getWorkspaceGitStatus: (workspaceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.getWorkspaceGitStatus, workspaceId),
  getWorkspaceGitDiff: (workspaceId: string, filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.getWorkspaceGitDiff, workspaceId, filePath),
  stageWorkspaceGitFile: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.stageWorkspaceGitFile, input),
  unstageWorkspaceGitFile: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.unstageWorkspaceGitFile, input),
  revertWorkspaceGitFile: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.revertWorkspaceGitFile, input),
  commitWorkspaceGitIndex: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.commitWorkspaceGitIndex, input),
  commitAllAndPushWorkspaceGit: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.commitAllAndPushWorkspaceGit, input),
  pushWorkspaceGitBranch: (workspaceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.pushWorkspaceGitBranch, workspaceId),
  pullWorkspaceGitBranch: (workspaceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.pullWorkspaceGitBranch, workspaceId),
  abortWorkspaceGitPull: (workspaceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.abortWorkspaceGitPull, workspaceId),
  startWorkspaceGitFeatureBranch: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.startWorkspaceGitFeatureBranch, input),
  generateWorkspaceGitMessage: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.generateWorkspaceGitMessage, input),
  createWorkspaceGitPullRequest: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.createWorkspaceGitPullRequest, input),
  getWorkspaceGitPullRequest: (workspaceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.getWorkspaceGitPullRequest, workspaceId),
  getWorktreeBranchStats: (workspaceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.getWorktreeBranchStats, workspaceId),
  pickProjectRoot: (defaultPath?: string | null) =>
    ipcRenderer.invoke(IPC_CHANNELS.pickProjectRoot, defaultPath ?? null),
  interruptManagedSession: (sessionId: string, recipientAlias?: string) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.managedSessionInterrupt,
      sessionId,
      recipientAlias,
    ),
  pickManagedSessionFiles: (workspaceId) =>
    ipcRenderer.invoke(IPC_CHANNELS.managedSessionPickFiles, workspaceId),
  searchManagedSessionFiles: (workspaceId, query) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.managedSessionSearchFiles,
      workspaceId,
      query,
    ),
  killTerminalSession: (sessionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalKill, sessionId),
  onAppShortcut: (callback: (event: AppShortcutEvent) => void) => {
    const listener = (_event: unknown, payload: AppShortcutEvent) =>
      callback(payload)

    ipcRenderer.on(IPC_CHANNELS.appShortcut, listener)

    return () => {
      ipcRenderer.off(IPC_CHANNELS.appShortcut, listener)
    }
  },
  onDiagnosticsEvent: (callback: (snapshot: DiagnosticsSnapshot) => void) => {
    const listener = (_event: unknown, payload: DiagnosticsSnapshot) =>
      callback(payload)

    ipcRenderer.on(IPC_CHANNELS.diagnosticsEvent, listener)

    return () => {
      ipcRenderer.off(IPC_CHANNELS.diagnosticsEvent, listener)
    }
  },
  onUpdateEvent: (callback: (event: UpdateEvent) => void) => {
    const listener = (_event: unknown, payload: UpdateEvent) =>
      callback(payload)

    ipcRenderer.on(IPC_CHANNELS.updateEvent, listener)

    return () => {
      ipcRenderer.off(IPC_CHANNELS.updateEvent, listener)
    }
  },
  onUpdatePreferences: (callback: (event: UpdatePreferencesEvent) => void) => {
    const listener = (_event: unknown, payload: UpdatePreferencesEvent) =>
      callback(payload)

    ipcRenderer.on(IPC_CHANNELS.updatePreferencesEvent, listener)

    return () => {
      ipcRenderer.off(IPC_CHANNELS.updatePreferencesEvent, listener)
    }
  },
  onManagedSessionEvent: (callback) => {
    const listener = (_event: unknown, payload: ManagedSessionIpcEvent) =>
      callback(payload)

    ipcRenderer.on(IPC_CHANNELS.managedSessionEvent, listener)

    return () => {
      ipcRenderer.off(IPC_CHANNELS.managedSessionEvent, listener)
    }
  },
  onPreviewEvent: (callback) => {
    const listener = (
      _event: unknown,
      payload: Parameters<typeof callback>[0],
    ) => callback(payload)

    ipcRenderer.on(IPC_CHANNELS.previewEvent, listener)

    return () => {
      ipcRenderer.off(IPC_CHANNELS.previewEvent, listener)
    }
  },
  onTerminalEvent: (callback: (event: TerminalEvent) => void) => {
    const listener = (_event: unknown, payload: TerminalEvent) =>
      callback(payload)

    ipcRenderer.on(IPC_CHANNELS.terminalEvent, listener)

    return () => {
      ipcRenderer.off(IPC_CHANNELS.terminalEvent, listener)
    }
  },
  onWorkspaceActivity: (callback: (event: WorkspaceActivityEvent) => void) => {
    const listener = (_event: unknown, payload: WorkspaceActivityEvent) =>
      callback(payload)

    ipcRenderer.on(IPC_CHANNELS.workspaceActivityEvent, listener)

    return () => {
      ipcRenderer.off(IPC_CHANNELS.workspaceActivityEvent, listener)
    }
  },
  onWorkspacePersistence: (
    callback: (event: WorkspacePersistenceEvent) => void,
  ) => {
    const listener = (_event: unknown, payload: WorkspacePersistenceEvent) =>
      callback(payload)

    ipcRenderer.on(IPC_CHANNELS.workspacePersistenceEvent, listener)

    return () => {
      ipcRenderer.off(IPC_CHANNELS.workspacePersistenceEvent, listener)
    }
  },
  onWorkspaceSetup: (callback: (event: WorkspaceSetupEvent) => void) => {
    const listener = (_event: unknown, payload: WorkspaceSetupEvent) =>
      callback(payload)

    ipcRenderer.on(IPC_CHANNELS.workspaceSetupEvent, listener)

    return () => {
      ipcRenderer.off(IPC_CHANNELS.workspaceSetupEvent, listener)
    }
  },
  probeExecutableCommand: (input: ExecutableProbeInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.executableProbe, input),
  readProjectFile: (workspaceId, relativePath) =>
    ipcRenderer.invoke(IPC_CHANNELS.readProjectFile, workspaceId, relativePath),
  closePreviewTab: (workspaceId: string, tabId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.previewCloseTab, workspaceId, tabId),
  navigatePreviewTab: (workspaceId: string, tabId: string, url: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.previewNavigate, workspaceId, tabId, url),
  openPreviewTab: (workspaceId: string, url: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.previewOpenTab, workspaceId, url),
  reportPreviewNavigation: (report: PreviewNavigationReport) =>
    ipcRenderer.invoke(IPC_CHANNELS.previewReportNavigation, report),
  reportRendererFault: (type) =>
    ipcRenderer.invoke(IPC_CHANNELS.reportRendererFault, type),
  resizeTerminalSession: (sessionId: string, size: TerminalResizeInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalResize, sessionId, size),
  saveWorkspaceLayout: (workspaceId, input) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveWorkspaceLayout, workspaceId, input),
  saveWorkspaceSurfaceState: (workspaceId, input) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.saveWorkspaceSurfaceState,
      workspaceId,
      input,
    ),
  resolveManagedSessionRequest: (
    sessionId: string,
    requestId: string,
    decision: ManagedSessionDecision,
    reason?: string,
  ) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.managedSessionResolveRequest,
      sessionId,
      requestId,
      decision,
      reason,
    ),
  resolveManagedSessionUserInput: (
    sessionId: string,
    requestId: string,
    answers: Record<string, string | string[]>,
  ) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.managedSessionResolveUserInput,
      sessionId,
      requestId,
      answers,
    ),
  setActiveSelection: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.setActiveSelection, input),
  updateProjectSetupCommand: (projectId: string, command: string | null) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.updateProjectSetupCommand,
      projectId,
      command,
    ),
  updateProjectAppearance: (projectId: string, input: ProjectAppearance) =>
    ipcRenderer.invoke(IPC_CHANNELS.updateProjectAppearance, projectId, input),
  runWorkspaceSetup: (workspaceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.runWorkspaceSetup, workspaceId),
  cancelWorkspaceSetup: (workspaceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.cancelWorkspaceSetup, workspaceId),
  selectPreviewTab: (workspaceId: string, tabId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.previewSelectTab, workspaceId, tabId),
  sendManagedSessionInput: (
    sessionId: string,
    text: string,
    recipients?: readonly string[],
    attachments?: readonly ManagedSessionAttachment[],
    selectedSkill?: ProviderSkillSelection,
  ) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.managedSessionSendInput,
      sessionId,
      text,
      recipients,
      attachments,
      selectedSkill,
    ),
  getTurnCheckpointDiff: (sessionId: string, checkpointId: string) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.turnCheckpointDiff,
      sessionId,
      checkpointId,
    ),
  listTurnCheckpoints: (sessionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.turnCheckpointList, sessionId),
  previewTurnCheckpointRestore: (sessionId: string, checkpointId: string) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.turnCheckpointPreviewRestore,
      sessionId,
      checkpointId,
    ),
  restoreTurnCheckpoint: (previewId: string, mode: CheckpointRestoreMode) =>
    ipcRenderer.invoke(IPC_CHANNELS.turnCheckpointRestore, previewId, mode),
  switchManagedSessionProvider: (
    sessionId: string,
    selection: ManagedSessionProviderSelection,
  ) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.managedSessionSwitchProvider,
      sessionId,
      selection,
    ),
  validateExecutableCommand: (command: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.executableValidate, command),
  writeTerminalInput: (sessionId: string, data: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalWrite, sessionId, data),
}

contextBridge.exposeInMainWorld('aide', aideApi)

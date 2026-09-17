import { contextBridge, ipcRenderer } from 'electron'
import type { ManagedSessionAgentConfig } from '../shared/conversation-routing'
import type { DiagnosticsSnapshot } from '../shared/diagnostics'
import type { ExecutableProbeInput } from '../shared/executable'
import { type AideApi, IPC_CHANNELS } from '../shared/ipc'
import type {
  ManagedSessionConfig,
  ManagedSessionDecision,
  ManagedSessionEvent,
  ManagedSessionProviderSelection,
} from '../shared/managed-session'
import type { WorkspacePersistenceEvent } from '../shared/persistence'
import type { PreviewNavigationReport } from '../shared/preview'
import type { AppShortcutEvent } from '../shared/shortcuts'
import type {
  TerminalEvent,
  TerminalResizeInput,
  TerminalSessionConfig,
} from '../shared/terminal'
import type { UpdateEvent, UpdatePreferencesEvent } from '../shared/update'
import type { WorkspaceActivityEvent } from '../shared/workspace-activity'
import type { WorkspaceSetupEvent } from '../shared/workspace-setup'

const aideApi: AideApi = {
  attachWorkspace: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.attachWorkspace, input),
  createTerminalSession: (input: TerminalSessionConfig) =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalCreate, input),
  createManagedSession: (input: ManagedSessionConfig) =>
    ipcRenderer.invoke(IPC_CHANNELS.managedSessionCreate, input),
  configureManagedSessionAgents: (
    sessionId: string,
    agents: readonly ManagedSessionAgentConfig[],
  ) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.managedSessionConfigureAgents,
      sessionId,
      agents,
    ),
  createWorkspace: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.createWorkspace, input),
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
  getProviderCapabilities: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getProviderCapabilities),
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
  listProjectRefs: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listProjectRefs, projectId),
  getWorkspaceGitStatus: (workspaceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.getWorkspaceGitStatus, workspaceId),
  getWorkspaceGitDiff: (workspaceId: string, filePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.getWorkspaceGitDiff, workspaceId, filePath),
  getWorktreeBranchStats: (workspaceId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.getWorktreeBranchStats, workspaceId),
  pickProjectRoot: (defaultPath?: string | null) =>
    ipcRenderer.invoke(IPC_CHANNELS.pickProjectRoot, defaultPath ?? null),
  interruptManagedSession: (sessionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.managedSessionInterrupt, sessionId),
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
  onManagedSessionEvent: (callback: (event: ManagedSessionEvent) => void) => {
    const listener = (_event: unknown, payload: ManagedSessionEvent) =>
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
  readProjectFile: (relativePath) =>
    ipcRenderer.invoke(IPC_CHANNELS.readProjectFile, relativePath),
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
  ) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.managedSessionResolveRequest,
      sessionId,
      requestId,
      decision,
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
  ) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.managedSessionSendInput,
      sessionId,
      text,
      recipients,
    ),
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

import { contextBridge, ipcRenderer } from 'electron'

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
import type { WorkspaceActivityEvent } from '../shared/workspace-activity'

const aideApi: AideApi = {
  attachWorkspace: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.attachWorkspace, input),
  createTerminalSession: (input: TerminalSessionConfig) =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalCreate, input),
  createManagedSession: (input: ManagedSessionConfig) =>
    ipcRenderer.invoke(IPC_CHANNELS.managedSessionCreate, input),
  createWorkspace: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.createWorkspace, input),
  detectWorktreeBranch: (worktreePath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.detectWorktreeBranch, worktreePath),
  closeManagedSession: (sessionId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.managedSessionClose, sessionId),
  getRuntimeSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getRuntimeSnapshot),
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
  selectPreviewTab: (workspaceId: string, tabId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.previewSelectTab, workspaceId, tabId),
  sendManagedSessionInput: (sessionId: string, text: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.managedSessionSendInput, sessionId, text),
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

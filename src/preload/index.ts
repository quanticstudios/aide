import { contextBridge, ipcRenderer } from 'electron'

import type { ExecutableProbeInput } from '../shared/executable'
import { type AideApi, IPC_CHANNELS } from '../shared/ipc'
import type { AppShortcutEvent } from '../shared/shortcuts'
import type {
  TerminalEvent,
  TerminalResizeInput,
  TerminalSessionConfig,
} from '../shared/terminal'

const aideApi: AideApi = {
  createTerminalSession: (input: TerminalSessionConfig) =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalCreate, input),
  createWorkspace: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.createWorkspace, input),
  getRuntimeSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getRuntimeSnapshot),
  getStorageSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getStorageSnapshot),
  importProject: (repoPath: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.importProject, repoPath),
  listProjectRefs: (projectId: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.listProjectRefs, projectId),
  pickProjectRoot: (defaultPath?: string | null) =>
    ipcRenderer.invoke(IPC_CHANNELS.pickProjectRoot, defaultPath ?? null),
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
  onTerminalEvent: (callback: (event: TerminalEvent) => void) => {
    const listener = (_event: unknown, payload: TerminalEvent) =>
      callback(payload)

    ipcRenderer.on(IPC_CHANNELS.terminalEvent, listener)

    return () => {
      ipcRenderer.off(IPC_CHANNELS.terminalEvent, listener)
    }
  },
  probeExecutableCommand: (input: ExecutableProbeInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.executableProbe, input),
  readProjectFile: (relativePath) =>
    ipcRenderer.invoke(IPC_CHANNELS.readProjectFile, relativePath),
  resizeTerminalSession: (sessionId: string, size: TerminalResizeInput) =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalResize, sessionId, size),
  saveWorkspaceLayout: (workspaceId, input) =>
    ipcRenderer.invoke(IPC_CHANNELS.saveWorkspaceLayout, workspaceId, input),
  setActiveSelection: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.setActiveSelection, input),
  validateExecutableCommand: (command: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.executableValidate, command),
  writeTerminalInput: (sessionId: string, data: string) =>
    ipcRenderer.invoke(IPC_CHANNELS.terminalWrite, sessionId, data),
}

contextBridge.exposeInMainWorld('aide', aideApi)

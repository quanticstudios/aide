import { contextBridge, ipcRenderer } from 'electron'

import { type AideApi, IPC_CHANNELS } from '../shared/ipc'

const aideApi: AideApi = {
  createProject: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.createProject, input),
  createWorkspace: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.createWorkspace, input),
  getRuntimeSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getRuntimeSnapshot),
  getStorageSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getStorageSnapshot),
  readProjectFile: (relativePath) =>
    ipcRenderer.invoke(IPC_CHANNELS.readProjectFile, relativePath),
  setActiveSelection: (input) =>
    ipcRenderer.invoke(IPC_CHANNELS.setActiveSelection, input),
}

contextBridge.exposeInMainWorld('aide', aideApi)

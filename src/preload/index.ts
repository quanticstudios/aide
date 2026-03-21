import { contextBridge, ipcRenderer } from 'electron'

import { type AideApi, IPC_CHANNELS } from '../shared/ipc'

const aideApi: AideApi = {
  getRuntimeSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getRuntimeSnapshot),
  readProjectFile: (relativePath) =>
    ipcRenderer.invoke(IPC_CHANNELS.readProjectFile, relativePath),
}

contextBridge.exposeInMainWorld('aide', aideApi)

import { contextBridge, ipcRenderer } from 'electron'

import { type AideApi, IPC_CHANNELS } from '../shared/ipc'

const aideApi: AideApi = {
  getRuntimeSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.getRuntimeSnapshot),
}

contextBridge.exposeInMainWorld('aide', aideApi)

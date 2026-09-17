import type { IpcMain, IpcMainInvokeEvent } from 'electron'

type IpcListener = Parameters<IpcMain['handle']>[1]

interface IpcHandleRegistrar {
  handle(channel: string, listener: IpcListener): void
}

export function createTrustedIpcRegistrar(
  ipcMain: IpcHandleRegistrar,
  assertTrustedRenderer: (event: IpcMainInvokeEvent) => void,
): IpcHandleRegistrar {
  return {
    handle(channel, listener) {
      ipcMain.handle(channel, (event, ...argumentsList) => {
        assertTrustedRenderer(event)
        return listener(event, ...argumentsList)
      })
    },
  }
}

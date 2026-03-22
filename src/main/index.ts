import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { BrowserWindow, app, ipcMain } from 'electron'

import { IPC_CHANNELS } from '../shared/ipc'
import type {
  CreateProjectInput,
  CreateWorkspaceInput,
} from '../shared/persistence'
import type { RuntimeSnapshot } from '../shared/runtime'
import { createAideDatabase } from './database'
import { readProjectFile } from './project-files'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const database = createAideDatabase(path.join(process.cwd(), '.aide.sqlite3'))

function createRuntimeSnapshot(): RuntimeSnapshot {
  return {
    appName: app.getName(),
    appVersion: app.getVersion(),
    chromeVersion: process.versions.chrome,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    platform: process.platform,
    arch: process.arch,
    workingDirectory: process.cwd(),
  }
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 720,
    show: false,
    backgroundColor: '#18181b',
    title: 'aide',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, '../preload/index.mjs'),
    },
  })

  window.on('ready-to-show', () => {
    window.show()
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(path.join(__dirname, '../renderer/index.html'))
  }

  return window
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getStorageSnapshot, () => database.getSnapshot())
  ipcMain.handle(IPC_CHANNELS.getRuntimeSnapshot, () => createRuntimeSnapshot())
  ipcMain.handle(
    IPC_CHANNELS.createProject,
    (_event, input: CreateProjectInput) => {
      database.createProject(input)
      return database.getSnapshot()
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.createWorkspace,
    (_event, input: CreateWorkspaceInput) => {
      database.createWorkspace(input)
      return database.getSnapshot()
    },
  )
  ipcMain.handle(IPC_CHANNELS.readProjectFile, (_event, relativePath: string) =>
    readProjectFile(process.cwd(), relativePath),
  )
}

app.whenReady().then(() => {
  registerIpcHandlers()
  createMainWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    database.close()
    app.quit()
  }
})

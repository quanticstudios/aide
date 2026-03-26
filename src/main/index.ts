import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { BrowserWindow, Menu, app, ipcMain } from 'electron'

import { IPC_CHANNELS } from '../shared/ipc'
import type {
  CreateProjectInput,
  CreateWorkspaceInput,
  SetActiveSelectionInput,
} from '../shared/persistence'
import type { RuntimeSnapshot } from '../shared/runtime'
import type {
  TerminalResizeInput,
  TerminalSessionConfig,
} from '../shared/terminal'
import { createAideDatabase } from './database'
import {
  probeExecutable,
  validateExecutablePath,
} from './executable-resolution'
import { focusHyprlandStartupWorkspace } from './hyprland'
import { readProjectFile } from './project-files'
import { TerminalSessionManager } from './terminal-session-manager'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const database = createAideDatabase(path.join(process.cwd(), '.aide.sqlite3'))
const terminalSessionManager = new TerminalSessionManager({
  onEvent: (event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.terminalEvent, event)
    }
  },
})

if (process.platform === 'linux') {
  process.env.LIBGL_ALWAYS_SOFTWARE ??= '1'
  process.env.MESA_LOADER_DRIVER_OVERRIDE ??= 'llvmpipe'
  app.disableHardwareAcceleration()
  app.commandLine.appendSwitch('disable-gpu')
  app.commandLine.appendSwitch('disable-gpu-compositing')
  app.commandLine.appendSwitch('disable-gpu-sandbox')
  app.commandLine.appendSwitch('use-angle', 'swiftshader')
  app.commandLine.appendSwitch('use-gl', 'swiftshader')
}

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
    autoHideMenuBar: true,
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
      preload: path.join(__dirname, '../preload/index.js'),
    },
  })

  let didRevealWindow = false

  const revealWindow = () => {
    if (didRevealWindow || window.isDestroyed()) {
      return
    }

    didRevealWindow = true

    void (async () => {
      try {
        await focusHyprlandStartupWorkspace()
      } catch (error) {
        console.warn(
          'Unable to switch to the configured Hyprland workspace.',
          error,
        )
      }

      if (window.isDestroyed()) {
        return
      }

      if (!window.isVisible()) {
        window.show()
      }

      window.focus()
    })()
  }

  window.once('ready-to-show', revealWindow)

  window.webContents.on('did-finish-load', () => {
    revealWindow()
  })

  window.webContents.on(
    'did-fail-load',
    (_event, errorCode, errorDescription) => {
      console.error('Renderer failed to load', errorCode, errorDescription)

      if (!window.isVisible()) {
        window.show()
      }
    },
  )

  setTimeout(() => {
    revealWindow()
  }, 1500)

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
  ipcMain.handle(IPC_CHANNELS.executableValidate, (_event, command: string) =>
    validateExecutablePath(command),
  )
  ipcMain.handle(
    IPC_CHANNELS.executableProbe,
    (_event, input: { args?: string[]; command: string }) =>
      probeExecutable(input.command, { args: input.args }),
  )
  ipcMain.handle(
    IPC_CHANNELS.setActiveSelection,
    (_event, input: SetActiveSelectionInput) => {
      database.setActiveSelection(input)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.terminalCreate,
    (_event, input: TerminalSessionConfig) =>
      terminalSessionManager.createSession(input),
  )
  ipcMain.handle(IPC_CHANNELS.terminalKill, (_event, sessionId: string) => {
    terminalSessionManager.killSession(sessionId)
  })
  ipcMain.handle(
    IPC_CHANNELS.terminalResize,
    (_event, sessionId: string, size: TerminalResizeInput) => {
      terminalSessionManager.resizeSession(sessionId, size)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.terminalWrite,
    (_event, sessionId: string, data: string) => {
      terminalSessionManager.writeToSession(sessionId, data)
    },
  )
  ipcMain.handle(IPC_CHANNELS.readProjectFile, (_event, relativePath: string) =>
    readProjectFile(process.cwd(), relativePath),
  )
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
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
    terminalSessionManager.killAll()
    database.close()
    app.quit()
  }
})

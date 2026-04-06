import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { BrowserWindow, Menu, app, dialog, ipcMain } from 'electron'

import type { CreateWorkspaceRequest } from '../shared/git'
import { IPC_CHANNELS } from '../shared/ipc'
import type {
  SaveWorkspaceLayoutInput,
  SetActiveSelectionInput,
} from '../shared/persistence'
import type { RuntimeSnapshot } from '../shared/runtime'
import type {
  TerminalResizeInput,
  TerminalSessionConfig,
} from '../shared/terminal'
import { mapInputToShortcutEvent } from './app-shortcuts'
import { createAideDatabase } from './database'
import {
  probeExecutable,
  validateExecutablePath,
} from './executable-resolution'
import { GitWorkspaceService } from './git-service'
import { focusHyprlandStartupWorkspace } from './hyprland'
import { readProjectFile } from './project-files'
import { pickProjectRoot } from './project-picker'
import { TerminalSessionManager } from './terminal-session-manager'
import { WorkspaceActivityService } from './workspace-activity-service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const database = createAideDatabase(
  process.env.AIDE_DATABASE_PATH ?? path.join(process.cwd(), '.aide.sqlite3'),
)
const gitWorkspaceService = new GitWorkspaceService(database)
const workspaceActivityService = new WorkspaceActivityService({
  onUpdate: (event) => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.workspaceActivityEvent, event)
    }
  },
})
const terminalSessionManager = new TerminalSessionManager({
  onEvent: (event) => {
    workspaceActivityService.handleTerminalEvent(event)
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
    useNavigationPoc: process.env.AIDE_USE_NAVIGATION_POC === '1',
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

  window.webContents.on('before-input-event', (event, input) => {
    const shortcut = mapInputToShortcutEvent(input)

    if (shortcut?.type !== 'overview-open') {
      return
    }

    event.preventDefault()
    window.webContents.send(IPC_CHANNELS.appShortcut, shortcut)
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
  ipcMain.handle(IPC_CHANNELS.getWorkspaceActivitySnapshot, () =>
    workspaceActivityService.getSnapshot(),
  )
  ipcMain.handle(IPC_CHANNELS.getRuntimeSnapshot, () => createRuntimeSnapshot())
  ipcMain.handle(
    IPC_CHANNELS.pickProjectRoot,
    async (event, defaultPath: string | null) => {
      const browserWindow = BrowserWindow.fromWebContents(event.sender)

      if (!browserWindow) {
        return null
      }

      return pickProjectRoot(browserWindow, dialog, defaultPath)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.createWorkspace,
    (_event, input: CreateWorkspaceRequest) =>
      gitWorkspaceService.createWorkspace(input),
  )
  ipcMain.handle(IPC_CHANNELS.importProject, (_event, repoPath: string) =>
    gitWorkspaceService.importProject(repoPath),
  )
  ipcMain.handle(IPC_CHANNELS.listProjectRefs, (_event, projectId: string) =>
    gitWorkspaceService.listProjectRefs(projectId),
  )
  ipcMain.handle(
    IPC_CHANNELS.getWorkspaceGitStatus,
    (_event, workspaceId: string) =>
      gitWorkspaceService.getWorkspaceStatus(workspaceId),
  )
  ipcMain.handle(
    IPC_CHANNELS.getWorkspaceGitDiff,
    (_event, workspaceId: string, filePath: string) =>
      gitWorkspaceService.getWorkspaceFileDiff(workspaceId, filePath),
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
      if (input.workspaceId) {
        workspaceActivityService.markWorkspaceVisited(input.workspaceId)
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.saveWorkspaceLayout,
    (_event, workspaceId: string, input: SaveWorkspaceLayoutInput) => {
      database.saveWorkspaceLayout(workspaceId, input)
      return database.getSnapshot()
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.terminalCreate,
    (_event, input: TerminalSessionConfig) => {
      workspaceActivityService.trackSession(input)
      return terminalSessionManager.createSession(input)
    },
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
      workspaceActivityService.handleTerminalInput(sessionId, data)
      terminalSessionManager.writeToSession(sessionId, data)
    },
  )
  ipcMain.handle(IPC_CHANNELS.readProjectFile, (_event, relativePath: string) =>
    readProjectFile(process.cwd(), relativePath),
  )
  ipcMain.handle(
    IPC_CHANNELS.getWorktreeBranchStats,
    (_event, workspaceId: string) =>
      gitWorkspaceService.getWorktreeBranchStats(workspaceId),
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

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { BrowserWindow, Menu, app, dialog, ipcMain } from 'electron'

import type {
  AttachWorkspaceRequest,
  CreateWorkspaceRequest,
} from '../shared/git'
import { IPC_CHANNELS } from '../shared/ipc'
import type {
  ManagedSessionConfig,
  ManagedSessionDecision,
} from '../shared/managed-session'
import type {
  SaveWorkspaceLayoutInput,
  SaveWorkspaceSurfaceStateInput,
  SetActiveSelectionInput,
} from '../shared/persistence'
import { isAllowedPreviewUrl } from '../shared/preview'
import type { RuntimeSnapshot } from '../shared/runtime'
import type {
  TerminalResizeInput,
  TerminalSessionConfig,
} from '../shared/terminal'
import { mapInputToShortcutEvent } from './app-shortcuts'
import { getAideDatabasePath, migrateLegacyDatabase } from './app-storage'
import { createAideDatabase } from './database'
import { launchEditor, listAvailableEditors } from './editor-launcher'
import {
  probeExecutable,
  validateExecutablePath,
} from './executable-resolution'
import { GitWorkspaceService } from './git-service'
import { ManagedSessionManager } from './managed-session-manager'
import { PreviewManager } from './preview-manager'
import { readProjectFile } from './project-files'
import { pickProjectRoot } from './project-picker'
import { TerminalSessionManager } from './terminal-session-manager'
import { WorkspaceActivityService } from './workspace-activity-service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PREVIEW_PARTITION = 'persist:aide-preview'

let database: ReturnType<typeof createAideDatabase>
let gitWorkspaceService: GitWorkspaceService
let workspaceActivityService: WorkspaceActivityService
let managedSessionManager: ManagedSessionManager
let previewManager: PreviewManager
let terminalSessionManager: TerminalSessionManager

function initializeServices(): void {
  const databasePath = getAideDatabasePath({
    databasePathOverride: process.env.AIDE_DATABASE_PATH,
    userDataPath: app.getPath('userData'),
  })

  if (!process.env.AIDE_DATABASE_PATH) {
    migrateLegacyDatabase({
      databasePath,
      legacyPath: path.join(process.cwd(), '.aide.sqlite3'),
    })
  }

  database = createAideDatabase(databasePath)
  gitWorkspaceService = new GitWorkspaceService(database)
  workspaceActivityService = new WorkspaceActivityService({
    onWorkspaceVisited: (workspaceId, processedThrough) => {
      database.setWorkspaceActivityVisitWatermark(workspaceId, processedThrough)
    },
    onUpdate: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.workspaceActivityEvent, event)
      }
    },
    visitWatermarks: database.getWorkspaceActivityVisitWatermarks(),
  })
  managedSessionManager = new ManagedSessionManager({
    onRuntimeEvent: () => undefined,
    onUpdate: (event) => {
      if (event.type === 'snapshot') {
        workspaceActivityService.handleManagedSessionSnapshot(event.snapshot)
      } else {
        workspaceActivityService.handleManagedSessionRemoved(event.sessionId)
      }
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.managedSessionEvent, event)
      }
    },
  })
  previewManager = new PreviewManager(database, {
    onUpdate: (event) => {
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.previewEvent, event)
      }
    },
  })
  terminalSessionManager = new TerminalSessionManager({
    onEvent: (event) => {
      workspaceActivityService.handleTerminalEvent(event)
      for (const window of BrowserWindow.getAllWindows()) {
        window.webContents.send(IPC_CHANNELS.terminalEvent, event)
      }
    },
  })
}

let shutdownInProgress = false
let shutdownComplete = false

async function shutdownRuntime(): Promise<void> {
  if (shutdownComplete || shutdownInProgress) {
    return
  }

  shutdownInProgress = true
  try {
    await managedSessionManager.closeAll(2_000)
    await terminalSessionManager.closeAll(1_000)
  } finally {
    database.close()
    shutdownComplete = true
    shutdownInProgress = false
  }
}

app.setName('aide')
app.setAppUserModelId('aide')

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
      webviewTag: true,
    },
  })

  window.webContents.on(
    'will-attach-webview',
    (event, webPreferences, params) => {
      if (
        !params.src ||
        !isAllowedPreviewUrl(params.src) ||
        (params.partition !== undefined &&
          params.partition !== PREVIEW_PARTITION)
      ) {
        event.preventDefault()
        return
      }

      // biome-ignore lint/performance/noDelete: remove untrusted renderer preload
      delete params.preload
      // biome-ignore lint/performance/noDelete: remove untrusted guest preload
      delete webPreferences.preload
      params.partition = PREVIEW_PARTITION
      params.allowpopups = 'false'
      webPreferences.contextIsolation = true
      webPreferences.nodeIntegration = false
      webPreferences.sandbox = true
      webPreferences.webSecurity = true
    },
  )
  window.webContents.on('did-attach-webview', (_event, guestWebContents) => {
    guestWebContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    guestWebContents.session.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    )
    guestWebContents.on('will-navigate', (event, url) => {
      if (!isAllowedPreviewUrl(url)) {
        event.preventDefault()
      }
    })
    guestWebContents.on('will-redirect', (event, url) => {
      if (!isAllowedPreviewUrl(url)) {
        event.preventDefault()
      }
    })
  })

  let didRevealWindow = false

  const revealWindow = () => {
    if (didRevealWindow || window.isDestroyed()) {
      return
    }

    didRevealWindow = true

    if (!window.isVisible()) {
      window.show()
    }

    window.focus()
  }

  window.once('ready-to-show', revealWindow)

  window.webContents.on('did-finish-load', () => {
    revealWindow()
  })

  window.webContents.on('before-input-event', (event, input) => {
    const shortcut = mapInputToShortcutEvent(input)

    if (
      shortcut?.type !== 'overview-open' &&
      shortcut?.type !== 'command-palette-open'
    ) {
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
  const publishPersistenceSnapshot = () => {
    const snapshot = database.getSnapshot()
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(IPC_CHANNELS.workspacePersistenceEvent, {
        revision: snapshot.catalogRevision,
        snapshot,
      })
    }
    return snapshot
  }

  ipcMain.handle(IPC_CHANNELS.getStorageSnapshot, () => database.getSnapshot())
  ipcMain.handle(IPC_CHANNELS.getWorkspaceActivitySnapshot, () =>
    workspaceActivityService.getSnapshot(),
  )
  ipcMain.handle(IPC_CHANNELS.getManagedSessionSnapshots, () =>
    managedSessionManager.getSnapshots(),
  )
  ipcMain.handle(
    IPC_CHANNELS.getWorkspacePreviewSnapshot,
    (_event, workspaceId) => previewManager.ensure(workspaceId),
  )
  ipcMain.handle(IPC_CHANNELS.getWorkspacePreviewSnapshots, () =>
    previewManager.list(),
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
  ipcMain.handle(IPC_CHANNELS.previewOpenTab, (_event, workspaceId, url) =>
    previewManager.openTab(workspaceId, url),
  )
  ipcMain.handle(IPC_CHANNELS.previewSelectTab, (_event, workspaceId, tabId) =>
    previewManager.selectTab(workspaceId, tabId),
  )
  ipcMain.handle(IPC_CHANNELS.previewCloseTab, (_event, workspaceId, tabId) =>
    previewManager.closeTab(workspaceId, tabId),
  )
  ipcMain.handle(
    IPC_CHANNELS.previewNavigate,
    (_event, workspaceId, tabId, url) =>
      previewManager.navigate(workspaceId, tabId, url),
  )
  ipcMain.handle(IPC_CHANNELS.previewReportNavigation, (_event, report) =>
    previewManager.reportNavigation(report),
  )
  ipcMain.handle(
    IPC_CHANNELS.createWorkspace,
    async (_event, input: CreateWorkspaceRequest) => {
      const snapshot = await gitWorkspaceService.createWorkspace(input)
      publishPersistenceSnapshot()
      return snapshot
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.attachWorkspace,
    async (_event, input: AttachWorkspaceRequest) => {
      const snapshot = await gitWorkspaceService.attachWorkspace(input)
      publishPersistenceSnapshot()
      return snapshot
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.detectWorktreeBranch,
    (_event, worktreePath: string) =>
      gitWorkspaceService.detectWorktreeBranch(worktreePath),
  )
  ipcMain.handle(IPC_CHANNELS.editorList, () => listAvailableEditors())
  ipcMain.handle(
    IPC_CHANNELS.editorLaunch,
    (_event, editorId: string, cwd: string) => launchEditor(editorId, cwd),
  )
  ipcMain.handle(
    IPC_CHANNELS.importProject,
    async (_event, repoPath: string) => {
      const result = await gitWorkspaceService.importProject(repoPath)
      publishPersistenceSnapshot()
      return result
    },
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
      workspaceActivityService.setVisibleWorkspace(input.workspaceId)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.saveWorkspaceLayout,
    (_event, workspaceId: string, input: SaveWorkspaceLayoutInput) => {
      const snapshot = database.getSnapshot()
      const currentRevision =
        snapshot.workspaceLayoutRevisions?.[workspaceId] ?? 0
      if (
        input.expectedRevision !== undefined &&
        input.expectedRevision !== currentRevision
      ) {
        return {
          code: 'stale-workspace-revision' as const,
          currentRevision,
          ok: false as const,
          snapshot,
          workspaceId,
        }
      }
      database.saveWorkspaceLayout(workspaceId, input)
      const nextSnapshot = publishPersistenceSnapshot()
      return {
        ok: true as const,
        snapshot: nextSnapshot,
        workspaceId,
        workspaceRevision:
          nextSnapshot.workspaceLayoutRevisions?.[workspaceId] ??
          currentRevision + 1,
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.saveWorkspaceSurfaceState,
    (_event, workspaceId: string, input: SaveWorkspaceSurfaceStateInput) => {
      const snapshot = database.getSnapshot()
      const currentRevision =
        snapshot.workspaceSurfaceRevisions?.[workspaceId] ?? 0
      if (
        input.expectedRevision !== undefined &&
        input.expectedRevision !== currentRevision
      ) {
        return {
          code: 'stale-workspace-revision' as const,
          currentRevision,
          ok: false as const,
          snapshot,
          workspaceId,
        }
      }
      database.saveWorkspaceSurfaceState(workspaceId, input)
      const nextSnapshot = publishPersistenceSnapshot()
      return {
        ok: true as const,
        snapshot: nextSnapshot,
        workspaceId,
        workspaceRevision:
          nextSnapshot.workspaceSurfaceRevisions?.[workspaceId] ??
          currentRevision + 1,
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.terminalCreate,
    (_event, input: TerminalSessionConfig) => {
      if (input.mode !== 'shell') {
        throw new Error(
          `Managed provider mode "${input.mode}" must use managed-session:create.`,
        )
      }

      workspaceActivityService.trackSession(input)

      try {
        return terminalSessionManager.createSession(input)
      } catch (error) {
        workspaceActivityService.handleSessionLaunchFailure(input, error)
        throw error
      }
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
      terminalSessionManager.writeToSession(sessionId, data)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionCreate,
    (_event, input: ManagedSessionConfig) => {
      return managedSessionManager.createSession(input)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionClose,
    (_event, sessionId: string) =>
      managedSessionManager.closeSession(sessionId),
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionInterrupt,
    (_event, sessionId: string) =>
      managedSessionManager.interruptSession(sessionId),
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionSendInput,
    (_event, sessionId: string, text: string) =>
      managedSessionManager.sendInput(sessionId, text),
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionResolveRequest,
    (
      _event,
      sessionId: string,
      requestId: string,
      decision: ManagedSessionDecision,
    ) => managedSessionManager.resolveRequest(sessionId, requestId, decision),
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionResolveUserInput,
    (
      _event,
      sessionId: string,
      requestId: string,
      answers: Record<string, string | string[]>,
    ) => managedSessionManager.resolveUserInput(sessionId, requestId, answers),
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionSwitchProvider,
    (_event, sessionId: string, mode: string, model?: string) => {
      if (mode !== 'claude' && mode !== 'codex') {
        throw new Error(`Invalid provider mode: ${mode}`)
      }
      return managedSessionManager.switchSessionProvider(sessionId, mode, model)
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
  initializeServices()
  registerIpcHandlers()
  createMainWindow()

  const reaper = setInterval(() => {
    void managedSessionManager.reapSessions(
      (snapshot) => snapshot.sessionState === 'stopped',
    )
  }, 5 * 60_000)
  reaper.unref()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  if (shutdownComplete) {
    return
  }

  event.preventDefault()
  if (shutdownInProgress) {
    return
  }

  void shutdownRuntime().finally(() => app.quit())
})

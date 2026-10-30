import { randomUUID } from 'node:crypto'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain,
  Menu,
} from 'electron'

import type {
  AttachWorkspaceRequest,
  CreateWorkspaceRequest,
} from '../shared/git'
import { IPC_CHANNELS } from '../shared/ipc'
import type { ManagedSessionDecision } from '../shared/managed-session'
import type {
  SaveWorkspaceLayoutInput,
  SaveWorkspaceSurfaceStateInput,
  SetActiveSelectionInput,
} from '../shared/persistence'
import type { RuntimeSnapshot } from '../shared/runtime'
import type {
  TerminalResizeInput,
  TerminalSessionConfig,
} from '../shared/terminal'
import {
  scopePersistenceSnapshot,
  type WorkspaceWindowContext,
} from '../shared/workspace-window'
import { getAideDatabasePath, migrateLegacyDatabase } from './app-storage'
import { ApplicationRuntime } from './application-runtime'
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
import { ProviderCapabilityService } from './provider-capability-service'
import {
  applyRenderingConfiguration,
  resolveRenderingConfiguration,
} from './rendering'
import { TerminalSessionManager } from './terminal-session-manager'
import { WindowManager } from './window-manager'
import {
  canAccessWorkspace,
  getAccessibleWorkspaceIds,
  requireMainWindowAccess,
  requireSessionAccess,
  requireWorkspaceAccess,
  scopeManagedSessionSnapshots,
  scopeWorkspaceActivitySnapshot,
  scopeWorkspacePreviewSnapshots,
} from './workspace-access'
import { WorkspaceActivityService } from './workspace-activity-service'
import { scopeActiveSelectionInput } from './workspace-selection'
import { WorkspaceWindowManager } from './workspace-window-manager'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let database: ReturnType<typeof createAideDatabase>
let gitWorkspaceService: GitWorkspaceService
let workspaceActivityService: WorkspaceActivityService
let managedSessionManager: ManagedSessionManager
let providerCapabilityService: ProviderCapabilityService
let previewManager: PreviewManager
let terminalSessionManager: TerminalSessionManager
let workspaceWindowManager: WorkspaceWindowManager
const managedSessionWorkspaceIds = new Map<string, string>()
const terminalSessionWorkspaceIds = new Map<string, string>()

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
  managedSessionWorkspaceIds.clear()
  terminalSessionWorkspaceIds.clear()
  workspaceWindowManager = new WorkspaceWindowManager({
    createWindowId: randomUUID,
    onOwnershipChanged: () => {
      publishPersistenceSnapshot()
    },
    store: database,
    windows: windowManager,
  })
  workspaceWindowManager.repairStaleOwnership()
  gitWorkspaceService = new GitWorkspaceService(database)
  workspaceActivityService = new WorkspaceActivityService({
    onWorkspaceVisited: (workspaceId, processedThrough) => {
      database.setWorkspaceActivityVisitWatermark(workspaceId, processedThrough)
    },
    onUpdate: (event) => {
      broadcastWorkspaceScopedEvent(
        IPC_CHANNELS.workspaceActivityEvent,
        event.workspaceId,
        event,
      )
    },
    visitWatermarks: database.getWorkspaceActivityVisitWatermarks(),
  })
  managedSessionManager = new ManagedSessionManager({
    onRuntimeEvent: () => undefined,
    onUpdate: (event) => {
      const workspaceId =
        event.type === 'snapshot'
          ? event.snapshot.workspaceId
          : managedSessionWorkspaceIds.get(event.sessionId)

      if (event.type === 'snapshot') {
        rememberSessionWorkspace(
          managedSessionWorkspaceIds,
          event.snapshot.sessionId,
          event.snapshot.workspaceId,
        )
        workspaceActivityService.handleManagedSessionSnapshot(event.snapshot)
      } else {
        workspaceActivityService.handleManagedSessionRemoved(event.sessionId)
      }

      if (workspaceId) {
        broadcastWorkspaceScopedEvent(
          IPC_CHANNELS.managedSessionEvent,
          workspaceId,
          event,
        )
      }

      if (event.type === 'removed') {
        managedSessionWorkspaceIds.delete(event.sessionId)
      }
    },
  })
  providerCapabilityService = new ProviderCapabilityService()
  previewManager = new PreviewManager(database, {
    onUpdate: (event) => {
      broadcastWorkspaceScopedEvent(
        IPC_CHANNELS.previewEvent,
        event.snapshot.workspaceId,
        event,
      )
    },
  })
  terminalSessionManager = new TerminalSessionManager({
    onEvent: (event) => {
      workspaceActivityService.handleTerminalEvent(event)
      const workspaceId = terminalSessionWorkspaceIds.get(event.sessionId)

      if (workspaceId) {
        broadcastWorkspaceScopedEvent(
          IPC_CHANNELS.terminalEvent,
          workspaceId,
          event,
        )
      }
    },
  })
}

app.setName('aide')
app.setAppUserModelId('aide')

const renderingConfiguration = resolveRenderingConfiguration({
  argv: process.argv,
  env: process.env,
  platform: process.platform,
})
applyRenderingConfiguration(app, renderingConfiguration, process.env)

const windowManager = new WindowManager({
  createBrowserWindow: (options) => new BrowserWindow(options),
  fromWebContents: (webContents) => BrowserWindow.fromWebContents(webContents),
  getAllWindows: () => BrowserWindow.getAllWindows(),
  loadRendererUrl: process.env.ELECTRON_RENDERER_URL,
  mainPreloadPath: path.join(__dirname, '../preload/index.js'),
  rendererHtmlPath: path.join(__dirname, '../renderer/index.html'),
  setTimeout,
})

function getWindowContext(event: IpcMainInvokeEvent): WorkspaceWindowContext {
  const context = windowManager.getWindowContext(event.sender)

  if (!context) {
    throw new Error('Unrecognized renderer window.')
  }

  return context
}

function getScopedPersistenceSnapshot(event: IpcMainInvokeEvent) {
  return scopePersistenceSnapshot(
    database.getSnapshot(),
    getWindowContext(event),
  )
}

function getAccessibleWorkspaceIdsForContext(
  context: WorkspaceWindowContext,
): Set<string> {
  return getAccessibleWorkspaceIds(database, context)
}

function broadcastWorkspaceScopedEvent(
  channel: string,
  workspaceId: string,
  payload: unknown,
): void {
  windowManager.broadcastForWindowContext(channel, (context) => {
    const workspace = database.getWorkspace(workspaceId)

    return workspace && canAccessWorkspace(context, workspace)
      ? payload
      : undefined
  })
}

function requireWorkspaceFromEvent(
  event: IpcMainInvokeEvent,
  workspaceId: unknown,
): string {
  const requestedWorkspaceId = requireWorkspaceId(workspaceId)
  requireWorkspaceAccess(
    database,
    getWindowContext(event),
    requestedWorkspaceId,
  )
  return requestedWorkspaceId
}

function requireMainWindowFromEvent(event: IpcMainInvokeEvent): void {
  requireMainWindowAccess(getWindowContext(event))
}

function requireManagedSessionFromEvent(
  event: IpcMainInvokeEvent,
  sessionId: unknown,
): string {
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    throw new Error('Invalid managed-session id.')
  }

  return requireSessionAccess(
    getWindowContext(event),
    sessionId,
    managedSessionWorkspaceIds,
    database,
  )
}

function requireTerminalSessionFromEvent(
  event: IpcMainInvokeEvent,
  sessionId: unknown,
): string {
  if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
    throw new Error('Invalid terminal session id.')
  }

  return requireSessionAccess(
    getWindowContext(event),
    sessionId,
    terminalSessionWorkspaceIds,
    database,
  )
}

function rememberSessionWorkspace(
  sessionWorkspaceIds: Map<string, string>,
  sessionId: string,
  workspaceId: string,
): void {
  const existingWorkspaceId = sessionWorkspaceIds.get(sessionId)

  if (existingWorkspaceId && existingWorkspaceId !== workspaceId) {
    throw new Error('Session is already owned by another workspace.')
  }

  sessionWorkspaceIds.set(sessionId, workspaceId)
}

function publishPersistenceSnapshot() {
  const snapshot = database.getSnapshot()
  windowManager.broadcastForWindowContext(
    IPC_CHANNELS.workspacePersistenceEvent,
    (context) => ({
      revision: snapshot.catalogRevision,
      snapshot: scopePersistenceSnapshot(snapshot, context),
    }),
  )
  return snapshot
}

function requireWorkspaceId(input: unknown): string {
  if (typeof input !== 'string' || input.trim().length === 0) {
    throw new Error('Invalid workspace id.')
  }

  return input
}

function createRuntimeSnapshot(): RuntimeSnapshot {
  return {
    appName: app.getName(),
    appVersion: app.getVersion(),
    chromeVersion: process.versions.chrome,
    electronVersion: process.versions.electron,
    nodeVersion: process.versions.node,
    platform: process.platform,
    renderingMode: renderingConfiguration.mode,
    renderingModeSource: renderingConfiguration.source,
    arch: process.arch,
    workingDirectory: process.cwd(),
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.getStorageSnapshot, getScopedPersistenceSnapshot)
  ipcMain.handle(IPC_CHANNELS.getWindowContext, (event) =>
    getWindowContext(event),
  )
  ipcMain.handle(
    IPC_CHANNELS.detachWorkspace,
    (event, workspaceId: unknown) => {
      const context = getWindowContext(event)
      requireMainWindowAccess(context)
      const requestedWorkspaceId = requireWorkspaceId(workspaceId)

      const outcome =
        workspaceWindowManager.detachWorkspace(requestedWorkspaceId)
      const snapshot = database.getSnapshot()

      return {
        ...outcome,
        snapshot: scopePersistenceSnapshot(snapshot, context),
      }
    },
  )
  ipcMain.handle(IPC_CHANNELS.getWorkspaceActivitySnapshot, (event) =>
    scopeWorkspaceActivitySnapshot(
      workspaceActivityService.getSnapshot(),
      getAccessibleWorkspaceIdsForContext(getWindowContext(event)),
    ),
  )
  ipcMain.handle(IPC_CHANNELS.getManagedSessionSnapshots, (event) =>
    scopeManagedSessionSnapshots(
      managedSessionManager.getSnapshots(),
      getAccessibleWorkspaceIdsForContext(getWindowContext(event)),
    ),
  )
  ipcMain.handle(IPC_CHANNELS.getProviderCapabilities, (event) => {
    requireMainWindowFromEvent(event)
    return providerCapabilityService.getSnapshot()
  })
  ipcMain.handle(
    IPC_CHANNELS.getWorkspacePreviewSnapshot,
    (event, workspaceId) =>
      previewManager.ensure(requireWorkspaceFromEvent(event, workspaceId)),
  )
  ipcMain.handle(IPC_CHANNELS.getWorkspacePreviewSnapshots, (event) =>
    scopeWorkspacePreviewSnapshots(
      previewManager.list(),
      getAccessibleWorkspaceIdsForContext(getWindowContext(event)),
    ),
  )
  ipcMain.handle(IPC_CHANNELS.getRuntimeSnapshot, (event) => {
    requireMainWindowFromEvent(event)
    return createRuntimeSnapshot()
  })
  ipcMain.handle(
    IPC_CHANNELS.pickProjectRoot,
    async (event, defaultPath: string | null) => {
      requireMainWindowFromEvent(event)
      const browserWindow = windowManager.getWindowForWebContents(event.sender)

      if (!browserWindow) {
        return null
      }

      return pickProjectRoot(browserWindow, dialog, defaultPath)
    },
  )
  ipcMain.handle(IPC_CHANNELS.previewOpenTab, (event, workspaceId, url) =>
    previewManager.openTab(requireWorkspaceFromEvent(event, workspaceId), url),
  )
  ipcMain.handle(IPC_CHANNELS.previewSelectTab, (event, workspaceId, tabId) =>
    previewManager.selectTab(
      requireWorkspaceFromEvent(event, workspaceId),
      tabId,
    ),
  )
  ipcMain.handle(IPC_CHANNELS.previewCloseTab, (event, workspaceId, tabId) =>
    previewManager.closeTab(
      requireWorkspaceFromEvent(event, workspaceId),
      tabId,
    ),
  )
  ipcMain.handle(
    IPC_CHANNELS.previewNavigate,
    (event, workspaceId, tabId, url) =>
      previewManager.navigate(
        requireWorkspaceFromEvent(event, workspaceId),
        tabId,
        url,
      ),
  )
  ipcMain.handle(IPC_CHANNELS.previewReportNavigation, (event, report) => {
    requireWorkspaceFromEvent(event, report.workspaceId)
    return previewManager.reportNavigation(report)
  })
  ipcMain.handle(
    IPC_CHANNELS.createWorkspace,
    async (event, input: CreateWorkspaceRequest) => {
      const context = getWindowContext(event)
      requireMainWindowAccess(context)
      const snapshot = await gitWorkspaceService.createWorkspace({
        ...input,
        windowId: null,
      })
      publishPersistenceSnapshot()
      return scopePersistenceSnapshot(snapshot, context)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.attachWorkspace,
    async (event, input: AttachWorkspaceRequest) => {
      const context = getWindowContext(event)
      requireMainWindowAccess(context)
      const snapshot = await gitWorkspaceService.attachWorkspace({
        ...input,
        windowId: null,
      })
      publishPersistenceSnapshot()
      return scopePersistenceSnapshot(snapshot, context)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.detectWorktreeBranch,
    (event, worktreePath: string) => {
      requireMainWindowFromEvent(event)
      return gitWorkspaceService.detectWorktreeBranch(worktreePath)
    },
  )
  ipcMain.handle(IPC_CHANNELS.editorList, (event) => {
    requireMainWindowFromEvent(event)
    return listAvailableEditors()
  })
  ipcMain.handle(
    IPC_CHANNELS.editorLaunch,
    (event, editorId: string, cwd: string) => {
      requireMainWindowFromEvent(event)
      return launchEditor(editorId, cwd)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.importProject,
    async (event, repoPath: string) => {
      const context = getWindowContext(event)
      requireMainWindowAccess(context)
      const result = await gitWorkspaceService.importProject(repoPath)
      publishPersistenceSnapshot()
      return {
        ...result,
        snapshot: scopePersistenceSnapshot(result.snapshot, context),
      }
    },
  )
  ipcMain.handle(IPC_CHANNELS.listProjectRefs, (event, projectId: string) => {
    requireMainWindowFromEvent(event)
    return gitWorkspaceService.listProjectRefs(projectId)
  })
  ipcMain.handle(
    IPC_CHANNELS.getWorkspaceGitStatus,
    (event, workspaceId: string) =>
      gitWorkspaceService.getWorkspaceStatus(
        requireWorkspaceFromEvent(event, workspaceId),
      ),
  )
  ipcMain.handle(
    IPC_CHANNELS.getWorkspaceGitDiff,
    (event, workspaceId: string, filePath: string) =>
      gitWorkspaceService.getWorkspaceFileDiff(
        requireWorkspaceFromEvent(event, workspaceId),
        filePath,
      ),
  )
  ipcMain.handle(IPC_CHANNELS.executableValidate, (event, command: string) => {
    requireMainWindowFromEvent(event)
    return validateExecutablePath(command)
  })
  ipcMain.handle(
    IPC_CHANNELS.executableProbe,
    (event, input: { args?: string[]; command: string }) => {
      requireMainWindowFromEvent(event)
      return probeExecutable(input.command, { args: input.args })
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.setActiveSelection,
    (event, input: SetActiveSelectionInput) => {
      const context = getWindowContext(event)
      const selection = scopeActiveSelectionInput(
        database.getSnapshot(),
        context,
        input,
      )

      database.setActiveSelection(selection)

      if (context.kind === 'main') {
        workspaceActivityService.setVisibleWorkspace(selection.workspaceId)
      } else if (input.workspaceId === context.workspaceId) {
        workspaceActivityService.setVisibleWorkspace(context.workspaceId)
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.saveWorkspaceLayout,
    (event, workspaceId: string, input: SaveWorkspaceLayoutInput) => {
      const context = getWindowContext(event)
      const requestedWorkspaceId = requireWorkspaceFromEvent(event, workspaceId)
      const snapshot = database.getSnapshot()
      const currentRevision =
        snapshot.workspaceLayoutRevisions?.[requestedWorkspaceId] ?? 0
      if (
        input.expectedRevision !== undefined &&
        input.expectedRevision !== currentRevision
      ) {
        return {
          code: 'stale-workspace-revision' as const,
          currentRevision,
          ok: false as const,
          snapshot: scopePersistenceSnapshot(snapshot, context),
          workspaceId: requestedWorkspaceId,
        }
      }
      database.saveWorkspaceLayout(requestedWorkspaceId, input)
      const nextSnapshot = publishPersistenceSnapshot()
      return {
        ok: true as const,
        snapshot: scopePersistenceSnapshot(nextSnapshot, context),
        workspaceId: requestedWorkspaceId,
        workspaceRevision:
          nextSnapshot.workspaceLayoutRevisions?.[requestedWorkspaceId] ??
          currentRevision + 1,
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.saveWorkspaceSurfaceState,
    (event, workspaceId: string, input: SaveWorkspaceSurfaceStateInput) => {
      const context = getWindowContext(event)
      const requestedWorkspaceId = requireWorkspaceFromEvent(event, workspaceId)
      const snapshot = database.getSnapshot()
      const currentRevision =
        snapshot.workspaceSurfaceRevisions?.[requestedWorkspaceId] ?? 0
      if (
        input.expectedRevision !== undefined &&
        input.expectedRevision !== currentRevision
      ) {
        return {
          code: 'stale-workspace-revision' as const,
          currentRevision,
          ok: false as const,
          snapshot: scopePersistenceSnapshot(snapshot, context),
          workspaceId: requestedWorkspaceId,
        }
      }
      database.saveWorkspaceSurfaceState(requestedWorkspaceId, input)
      const nextSnapshot = publishPersistenceSnapshot()
      return {
        ok: true as const,
        snapshot: scopePersistenceSnapshot(nextSnapshot, context),
        workspaceId: requestedWorkspaceId,
        workspaceRevision:
          nextSnapshot.workspaceSurfaceRevisions?.[requestedWorkspaceId] ??
          currentRevision + 1,
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.terminalCreate,
    (event, input: TerminalSessionConfig) => {
      if (input.mode !== 'shell') {
        throw new Error(
          `Managed provider mode "${input.mode}" must use managed-session:create.`,
        )
      }

      requireWorkspaceFromEvent(event, input.workspaceId)
      rememberSessionWorkspace(
        terminalSessionWorkspaceIds,
        input.sessionId,
        input.workspaceId,
      )
      workspaceActivityService.trackSession(input)

      try {
        return terminalSessionManager.createSession(input)
      } catch (error) {
        workspaceActivityService.handleSessionLaunchFailure(input, error)
        terminalSessionWorkspaceIds.delete(input.sessionId)
        throw error
      }
    },
  )
  ipcMain.handle(IPC_CHANNELS.terminalKill, (event, sessionId: string) => {
    requireTerminalSessionFromEvent(event, sessionId)
    terminalSessionManager.killSession(sessionId)
  })
  ipcMain.handle(
    IPC_CHANNELS.terminalResize,
    (event, sessionId: string, size: TerminalResizeInput) => {
      requireTerminalSessionFromEvent(event, sessionId)
      terminalSessionManager.resizeSession(sessionId, size)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.terminalWrite,
    (event, sessionId: string, data: string) => {
      requireTerminalSessionFromEvent(event, sessionId)
      terminalSessionManager.writeToSession(sessionId, data)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionCreate,
    async (event, input: unknown) => {
      const config =
        await providerCapabilityService.resolveManagedSessionConfig(input)
      requireWorkspaceFromEvent(event, config.workspaceId)
      rememberSessionWorkspace(
        managedSessionWorkspaceIds,
        config.sessionId,
        config.workspaceId,
      )

      try {
        return await managedSessionManager.createSession(config)
      } catch (error) {
        managedSessionWorkspaceIds.delete(config.sessionId)
        throw error
      }
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionClose,
    async (event, sessionId: string) => {
      requireManagedSessionFromEvent(event, sessionId)
      await managedSessionManager.closeSession(sessionId)
      managedSessionWorkspaceIds.delete(sessionId)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionInterrupt,
    (event, sessionId: string) => {
      requireManagedSessionFromEvent(event, sessionId)
      return managedSessionManager.interruptSession(sessionId)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionSendInput,
    (event, sessionId: string, text: string) => {
      requireManagedSessionFromEvent(event, sessionId)
      return managedSessionManager.sendInput(sessionId, text)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionResolveRequest,
    (
      event,
      sessionId: string,
      requestId: string,
      decision: ManagedSessionDecision,
    ) => {
      requireManagedSessionFromEvent(event, sessionId)
      return managedSessionManager.resolveRequest(
        sessionId,
        requestId,
        decision,
      )
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionResolveUserInput,
    (
      event,
      sessionId: string,
      requestId: string,
      answers: Record<string, string | string[]>,
    ) => {
      requireManagedSessionFromEvent(event, sessionId)
      return managedSessionManager.resolveUserInput(
        sessionId,
        requestId,
        answers,
      )
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionSwitchProvider,
    async (event, sessionId: unknown, input: unknown) => {
      requireManagedSessionFromEvent(event, sessionId)
      const requestedSessionId = sessionId as string
      const selection =
        await providerCapabilityService.resolveManagedSessionProviderSelection(
          input,
        )
      return managedSessionManager.switchSessionProvider(
        requestedSessionId,
        selection,
      )
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.readProjectFile,
    (event, relativePath: string) => {
      requireMainWindowFromEvent(event)
      return readProjectFile(process.cwd(), relativePath)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.getWorktreeBranchStats,
    (event, workspaceId: string) =>
      gitWorkspaceService.getWorktreeBranchStats(
        requireWorkspaceFromEvent(event, workspaceId),
      ),
  )
}

const applicationRuntime = new ApplicationRuntime({
  createMainWindow: () => windowManager.createMainWindow(),
  hasWindows: () => windowManager.hasWindows(),
  initializeServices,
  reapStoppedManagedSessions: () => {
    void managedSessionManager.reapSessions(
      (snapshot) => snapshot.sessionState === 'stopped',
    )
  },
  registerIpcHandlers,
  shutdownServices: async () => {
    try {
      workspaceWindowManager.prepareForShutdown()
      await managedSessionManager.closeAll(2_000)
      await terminalSessionManager.closeAll(1_000)
    } finally {
      database.close()
    }
  },
  startReaper: setInterval,
})

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  applicationRuntime.start()

  app.on('activate', () => {
    applicationRuntime.ensureMainWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', (event) => {
  if (applicationRuntime.isShutdownComplete()) {
    return
  }

  event.preventDefault()
  void applicationRuntime.shutdown().finally(() => app.quit())
})

import path from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  app,
  BrowserWindow,
  dialog,
  type IpcMainInvokeEvent,
  ipcMain as electronIpcMain,
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
import type { UpdateEvent } from '../shared/update'
import { normalizeProjectSetupCommand } from '../shared/workspace-setup'
import { getAideDatabasePath, migrateLegacyDatabase } from './app-storage'
import { ApplicationRuntime } from './application-runtime'
import { createAideDatabase } from './database'
import { DiagnosticsService } from './diagnostics-service'
import { launchEditor, listAvailableEditors } from './editor-launcher'
import {
  probeExecutable,
  validateExecutablePath,
} from './executable-resolution'
import {
  FakeUpdateService,
  isFakeUpdateServiceEnabled,
} from './fake-update-service'
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
import { createTrustedIpcRegistrar } from './trusted-ipc'
import { isTrustedRendererUrl } from './trusted-renderer'
import { configuredUpdateHealthEndpoint } from './update-health-config'
import { configuredUpdateRelease } from './update-release-config'
import { UpdateHealthReporter } from './update-health-reporter'
import { UpdateManager, type UpdateReleaseOptions } from './update-manager'
import { requireUpdatePreferencesInput } from './update-preferences'
import { UpdateRestartCoordinator } from './update-restart-coordinator'
import { WindowManager } from './window-manager'
import { WorkspaceActivityService } from './workspace-activity-service'
import { WorkspaceSetupManager } from './workspace-setup-manager'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let database: ReturnType<typeof createAideDatabase>
let gitWorkspaceService: GitWorkspaceService
let workspaceActivityService: WorkspaceActivityService
let managedSessionManager: ManagedSessionManager
let providerCapabilityService: ProviderCapabilityService
let previewManager: PreviewManager
let terminalSessionManager: TerminalSessionManager
let diagnosticsService: DiagnosticsService
let workspaceSetupManager: WorkspaceSetupManager
let updateManager: UpdateManager | FakeUpdateService
let updateHealthReporter: UpdateHealthReporter
let updateRestartCoordinator: UpdateRestartCoordinator | FakeUpdateService
const rendererLocation = {
  loadRendererUrl: process.env.ELECTRON_RENDERER_URL,
  rendererHtmlPath: path.join(__dirname, '../renderer/index.html'),
}
const lastRendererFaultAt = new Map<string, number>()

function releaseConfiguration(): UpdateReleaseOptions | null {
  return configuredUpdateRelease()
}

function readNonNegativeInteger(value: string | undefined): number {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0
}

function requireTrustedRenderer(event: IpcMainInvokeEvent): void {
  const window = windowManager.getWindowForWebContents(event.sender)

  if (
    !window ||
    event.senderFrame !== event.sender.mainFrame ||
    !isTrustedRendererUrl(event.senderFrame.url, rendererLocation)
  ) {
    throw new Error('This request is not permitted from the current renderer.')
  }
}

function requireRuntimeId(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > 200
  ) {
    throw new Error(`Invalid ${label}.`)
  }

  return value
}

function requireWorkspaceForSetup(event: IpcMainInvokeEvent, value: unknown) {
  requireTrustedRenderer(event)
  const workspaceId = requireRuntimeId(value, 'workspace id')
  const workspace = database.getWorkspace(workspaceId)
  if (!workspace) {
    throw new Error('Workspace does not exist.')
  }
  return workspace
}

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
  if (
    (process.platform === 'linux' || process.platform === 'darwin') &&
    (process.arch === 'x64' || process.arch === 'arm64') &&
    !(process.platform === 'linux' && process.arch !== 'x64')
  ) {
    database.reconcilePendingUpdateInstall({
      arch: process.arch,
      currentVersion: app.getVersion(),
      now: new Date().toISOString(),
      platform: process.platform,
    })
  }
  gitWorkspaceService = new GitWorkspaceService(database)
  workspaceSetupManager = new WorkspaceSetupManager({
    onUpdate: (event) => {
      windowManager.broadcast(IPC_CHANNELS.workspaceSetupEvent, event)
    },
    store: database,
  })
  workspaceActivityService = new WorkspaceActivityService({
    onWorkspaceVisited: (workspaceId, processedThrough) => {
      database.setWorkspaceActivityVisitWatermark(workspaceId, processedThrough)
    },
    onUpdate: (event) => {
      windowManager.broadcast(IPC_CHANNELS.workspaceActivityEvent, event)
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
      windowManager.broadcast(IPC_CHANNELS.managedSessionEvent, event)
    },
  })
  providerCapabilityService = new ProviderCapabilityService()
  previewManager = new PreviewManager(database, {
    onUpdate: (event) => {
      windowManager.broadcast(IPC_CHANNELS.previewEvent, event)
    },
  })
  terminalSessionManager = new TerminalSessionManager({
    onEvent: (event) => {
      workspaceActivityService.handleTerminalEvent(event)
      windowManager.broadcast(IPC_CHANNELS.terminalEvent, event)
    },
  })
  diagnosticsService = new DiagnosticsService({
    logDirectory: path.join(app.getPath('logs'), 'aide'),
    onUpdate: (snapshot) =>
      windowManager.broadcast(IPC_CHANNELS.diagnosticsEvent, snapshot),
    runtime: {
      appName: app.getName(),
      appVersion: app.getVersion(),
      arch: process.arch,
      chromeVersion: process.versions.chrome,
      electronVersion: process.versions.electron,
      nodeVersion: process.versions.node,
      platform: process.platform,
    },
  })
  updateHealthReporter = new UpdateHealthReporter({
    endpoint: configuredUpdateHealthEndpoint(),
    isPackaged: app.isPackaged,
    store: database,
  })
  const onUpdate = (event: UpdateEvent) =>
    windowManager.broadcast(IPC_CHANNELS.updateEvent, event)
  const useFakeUpdates = isFakeUpdateServiceEnabled(
    app.isPackaged,
    process.env.AIDE_FAKE_UPDATE_SERVICE,
  )
  updateManager = useFakeUpdates
    ? new FakeUpdateService({
        activeManagedSessions: readNonNegativeInteger(
          process.env.AIDE_FAKE_UPDATE_ACTIVE_MANAGED,
        ),
        activeTerminalSessions: readNonNegativeInteger(
          process.env.AIDE_FAKE_UPDATE_ACTIVE_TERMINALS,
        ),
        activeWorkspaceSetups: readNonNegativeInteger(
          process.env.AIDE_FAKE_UPDATE_ACTIVE_SETUPS,
        ),
        checkFailures: readNonNegativeInteger(
          process.env.AIDE_FAKE_UPDATE_CHECK_FAILURES,
        ),
        currentVersion: app.getVersion(),
        downloadFailures: readNonNegativeInteger(
          process.env.AIDE_FAKE_UPDATE_DOWNLOAD_FAILURES,
        ),
        initialUpdateAvailable:
          process.env.AIDE_FAKE_UPDATE_INITIAL_AVAILABLE === '1',
        onUpdate,
        preferenceFailures: readNonNegativeInteger(
          process.env.AIDE_FAKE_UPDATE_PREFERENCE_FAILURES,
        ),
        restartFailures: readNonNegativeInteger(
          process.env.AIDE_FAKE_UPDATE_RESTART_FAILURES,
        ),
        snapshotFailures: readNonNegativeInteger(
          process.env.AIDE_FAKE_UPDATE_SNAPSHOT_FAILURES,
        ),
        store: database,
        urgency:
          process.env.AIDE_FAKE_UPDATE_URGENCY === 'critical'
            ? 'critical'
            : 'normal',
      })
    : new UpdateManager({
        app: {
          getVersion: () => app.getVersion(),
          isPackaged: app.isPackaged,
        },
        onUpdateHealthEventQueued: () => updateHealthReporter.flush(),
        onUpdate,
        release: releaseConfiguration(),
        store: database,
      })
  updateManager.subscribePreferences((event) => {
    windowManager.broadcast(IPC_CHANNELS.updatePreferencesEvent, event)
    if (!useFakeUpdates) updateHealthReporter.handlePreferencesChanged()
  })
  if (useFakeUpdates) {
    updateRestartCoordinator = updateManager as FakeUpdateService
  } else {
    updateRestartCoordinator = new UpdateRestartCoordinator({
      applicationRuntime,
      managedSessions: managedSessionManager,
      terminals: terminalSessionManager,
      terminateAfterShutdownFailure: () => {
        // Shutdown has already closed the database and child services. Relaunching
        // the current signed app is safer than attempting an unverified install.
        app.relaunch()
        app.exit(1)
      },
      updates: updateManager as UpdateManager,
      workspaceSetups: workspaceSetupManager,
    })
  }
}

function recordDiagnosticEvent(
  type:
    | 'main-uncaught-exception'
    | 'main-unhandled-rejection'
    | 'renderer-crashed',
): void {
  try {
    diagnosticsService.record(type)
  } catch {
    // Diagnostics must never replace or suppress the failure being observed.
  }
}

function registerDiagnosticsHandlers(): void {
  process.on('uncaughtExceptionMonitor', (_error, origin) => {
    recordDiagnosticEvent(
      origin === 'unhandledRejection'
        ? 'main-unhandled-rejection'
        : 'main-uncaught-exception',
    )
  })
  app.on('render-process-gone', () => {
    recordDiagnosticEvent('renderer-crashed')
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
  rendererHtmlPath: rendererLocation.rendererHtmlPath,
  setTimeout,
})

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
  const ipcMain = createTrustedIpcRegistrar(
    electronIpcMain,
    requireTrustedRenderer,
  )
  const publishPersistenceSnapshot = () => {
    const snapshot = database.getSnapshot()
    windowManager.broadcast(IPC_CHANNELS.workspacePersistenceEvent, {
      revision: snapshot.catalogRevision,
      snapshot,
    })
    return snapshot
  }

  ipcMain.handle(IPC_CHANNELS.getStorageSnapshot, (event) => {
    requireTrustedRenderer(event)
    return database.getSnapshot()
  })
  ipcMain.handle(IPC_CHANNELS.getDiagnosticsSnapshot, () =>
    diagnosticsService.getSnapshot(),
  )
  ipcMain.handle(IPC_CHANNELS.reportRendererFault, (_event, type: unknown) => {
    if (
      type !== 'renderer-exception' &&
      type !== 'renderer-unhandled-rejection'
    ) {
      throw new Error('Invalid renderer diagnostics event.')
    }

    const now = Date.now()
    if (now - (lastRendererFaultAt.get(type) ?? 0) < 250) return
    lastRendererFaultAt.set(type, now)
    diagnosticsService.record(type)
  })
  ipcMain.handle(IPC_CHANNELS.exportSupportBundle, async (event) => {
    const window = windowManager.getWindowForWebContents(event.sender)
    if (
      !window ||
      event.senderFrame !== event.sender.mainFrame ||
      !isTrustedRendererUrl(event.senderFrame.url, rendererLocation)
    ) {
      return { status: 'cancelled' as const }
    }

    const result = await dialog.showSaveDialog(window, {
      defaultPath: `aide-support-${new Date().toISOString().slice(0, 10)}.zip`,
      filters: [{ extensions: ['zip'], name: 'Support bundle' }],
      properties: ['showOverwriteConfirmation'],
    })
    if (result.canceled || !result.filePath) {
      return { status: 'cancelled' as const }
    }

    diagnosticsService.exportSupportBundle(result.filePath)
    return { status: 'exported' as const }
  })
  ipcMain.handle(IPC_CHANNELS.getWorkspaceActivitySnapshot, () =>
    workspaceActivityService.getSnapshot(),
  )
  ipcMain.handle(IPC_CHANNELS.getWorkspaceSetupSnapshot, (event) => {
    requireTrustedRenderer(event)
    return workspaceSetupManager.getCollectionSnapshot()
  })
  ipcMain.handle(IPC_CHANNELS.getManagedSessionSnapshots, () =>
    managedSessionManager.getSnapshots(),
  )
  ipcMain.handle(IPC_CHANNELS.getProviderCapabilities, () =>
    providerCapabilityService.getSnapshot(),
  )
  ipcMain.handle(
    IPC_CHANNELS.getWorkspacePreviewSnapshot,
    (_event, workspaceId) => previewManager.ensure(workspaceId),
  )
  ipcMain.handle(IPC_CHANNELS.getWorkspacePreviewSnapshots, () =>
    previewManager.list(),
  )
  ipcMain.handle(IPC_CHANNELS.getRuntimeSnapshot, () => createRuntimeSnapshot())
  ipcMain.handle(IPC_CHANNELS.getUpdateSnapshot, (event) => {
    requireTrustedRenderer(event)
    return updateManager.getSnapshot()
  })
  ipcMain.handle(IPC_CHANNELS.getUpdatePreferences, (event) => {
    requireTrustedRenderer(event)
    return updateManager.getPreferences()
  })
  ipcMain.handle(IPC_CHANNELS.checkForUpdates, (event) => {
    requireTrustedRenderer(event)
    return updateManager.checkForUpdates()
  })
  ipcMain.handle(IPC_CHANNELS.downloadUpdate, (event) => {
    requireTrustedRenderer(event)
    return updateManager.downloadUpdate()
  })
  ipcMain.handle(IPC_CHANNELS.retryUpdate, (event) => {
    requireTrustedRenderer(event)
    return updateManager.checkForUpdates()
  })
  ipcMain.handle(IPC_CHANNELS.restartUpdate, (event, confirmed: unknown) => {
    requireTrustedRenderer(event)
    if (typeof confirmed !== 'boolean') {
      throw new Error('Invalid update restart confirmation.')
    }
    return updateRestartCoordinator.requestRestart(confirmed)
  })
  ipcMain.handle(IPC_CHANNELS.updatePreferences, (event, input: unknown) => {
    requireTrustedRenderer(event)
    return updateManager.updatePreferences(requireUpdatePreferencesInput(input))
  })
  ipcMain.handle(
    IPC_CHANNELS.pickProjectRoot,
    async (event, defaultPath: string | null) => {
      const browserWindow = windowManager.getWindowForWebContents(event.sender)

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
    async (event, input: CreateWorkspaceRequest) => {
      requireTrustedRenderer(event)
      const result = await gitWorkspaceService.createWorkspaceWithResult(input)
      // The Git worktree and workspace record are already durable here. Setup
      // is deliberately outside Git's rollback transaction so failures retain
      // a repairable workspace and terminal.
      workspaceSetupManager.run(result.workspaceId)
      publishPersistenceSnapshot()
      return result.snapshot
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.attachWorkspace,
    async (event, input: AttachWorkspaceRequest) => {
      requireTrustedRenderer(event)
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
    async (event, repoPath: string) => {
      requireTrustedRenderer(event)
      const result = await gitWorkspaceService.importProject(repoPath)
      publishPersistenceSnapshot()
      return result
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.updateProjectSetupCommand,
    (event, projectId: unknown, command: unknown) => {
      requireTrustedRenderer(event)
      const validProjectId = requireRuntimeId(projectId, 'project id')
      const setupCommand = normalizeProjectSetupCommand(command)
      const project = database.updateProject(validProjectId, { setupCommand })
      if (!project) {
        throw new Error('Project does not exist.')
      }
      const snapshot = publishPersistenceSnapshot()
      workspaceSetupManager.publishProjectSnapshots(project.id)
      return snapshot
    },
  )
  ipcMain.handle(IPC_CHANNELS.runWorkspaceSetup, (event, workspaceId) => {
    const workspace = requireWorkspaceForSetup(event, workspaceId)
    return workspaceSetupManager.run(workspace.id)
  })
  ipcMain.handle(IPC_CHANNELS.cancelWorkspaceSetup, (event, workspaceId) => {
    const workspace = requireWorkspaceForSetup(event, workspaceId)
    return workspaceSetupManager.cancel(workspace.id)
  })
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
    async (event, input: unknown) => {
      requireTrustedRenderer(event)
      const config =
        await providerCapabilityService.resolveManagedSessionConfig(input)
      requireWorkspaceForSetup(event, config.workspaceId)
      if (!managedSessionManager.getSnapshots()[config.sessionId]) {
        workspaceSetupManager.assertManagedSessionAllowed(config.workspaceId)
      }
      return managedSessionManager.createSession(config)
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
    async (_event, sessionId: unknown, input: unknown) => {
      if (typeof sessionId !== 'string' || sessionId.trim().length === 0) {
        throw new Error('Invalid managed-session id.')
      }
      const selection =
        await providerCapabilityService.resolveManagedSessionProviderSelection(
          input,
        )
      return managedSessionManager.switchSessionProvider(sessionId, selection)
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
  shutdownServices: async (reason) => {
    try {
      updateManager.stop({
        preserveVerifiedDownload: reason === 'update-install',
      })
      updateHealthReporter.stop()
      await Promise.all([
        workspaceSetupManager.shutdown(),
        managedSessionManager.closeAll(2_000),
        terminalSessionManager.closeAll(1_000),
      ])
    } finally {
      database.close()
    }
  },
  startReaper: setInterval,
})

app.whenReady().then(() => {
  Menu.setApplicationMenu(null)
  applicationRuntime.start()
  updateHealthReporter.start()
  updateManager.startAutomaticChecks()
  registerDiagnosticsHandlers()

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

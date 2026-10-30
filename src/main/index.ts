import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'

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
import type { PersistedStateRecovery } from '../shared/recovery'
import type { RuntimeSnapshot } from '../shared/runtime'
import type {
  TerminalResizeInput,
  TerminalSessionConfig,
} from '../shared/terminal'
import { getAideDatabasePath, migrateLegacyDatabase } from './app-storage'
import { ApplicationRuntime } from './application-runtime'
import type { AideDatabase } from './database'
import { launchEditor, listAvailableEditors } from './editor-launcher'
import {
  probeExecutable,
  validateExecutablePath,
} from './executable-resolution'
import { GitWorkspaceService } from './git-service'
import { ManagedSessionManager } from './managed-session-manager'
import { PersistenceOperationGate } from './persistence-operation-gate'
import {
  createInitialKnownGoodPersistedStateBackup,
  createPersistedStateBootstrapFailure,
  type PersistedStateRecoveryState,
  preparePersistedState,
  reconcilePersistedStateRecovery,
  refreshKnownGoodPersistedStateBackup,
  resetPersistedState,
  restorePersistedStateBackup,
  toRendererPersistedStateRecovery,
} from './persistence-recovery'
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
import { WorkspaceActivityService } from './workspace-activity-service'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
let database: AideDatabase
let gitWorkspaceService: GitWorkspaceService
let workspaceActivityService: WorkspaceActivityService
let managedSessionManager: ManagedSessionManager
let providerCapabilityService: ProviderCapabilityService
let previewManager: PreviewManager
let terminalSessionManager: TerminalSessionManager
let persistedStateRecovery: PersistedStateRecoveryState | null = null
let activeDatabasePath: string | null = null
let runtimeInitialized = false
let ipcHandlersRegistered = false
const persistenceOperationGate = new PersistenceOperationGate()

function runPersistenceMutation<T>(mutation: () => Promise<T> | T): Promise<T> {
  return persistenceOperationGate.run(mutation)
}

function quiescePersistenceWrites(): Promise<void> {
  return persistenceOperationGate.quiesce()
}

function resumePersistenceWrites(): void {
  persistenceOperationGate.resume()
}

function initializeServices(): boolean {
  const databasePath = getAideDatabasePath({
    databasePathOverride: process.env.AIDE_DATABASE_PATH,
    userDataPath: app.getPath('userData'),
  })

  let resetRecoveryCommitted = false
  if (!process.env.AIDE_DATABASE_PATH) {
    try {
      resetRecoveryCommitted = reconcilePersistedStateRecovery(databasePath)
    } catch {
      const preparedState = preparePersistedState(databasePath)
      if (preparedState.status === 'recovery') {
        persistedStateRecovery = preparedState.recovery
        return false
      }
      preparedState.database.close()
      throw new Error('Recovery reconciliation unexpectedly completed.')
    }
    if (!resetRecoveryCommitted) {
      migrateLegacyDatabase({
        databasePath,
        legacyPath: path.join(process.cwd(), '.aide.sqlite3'),
      })
    }
  }

  resumePersistenceWrites()
  const preparedState = preparePersistedState(databasePath)
  if (preparedState.status === 'recovery') {
    persistedStateRecovery = preparedState.recovery
    return false
  }

  database = preparedState.database
  activeDatabasePath = databasePath
  try {
    gitWorkspaceService = new GitWorkspaceService(database)
    workspaceActivityService = new WorkspaceActivityService({
      onWorkspaceVisited: (workspaceId, processedThrough) => {
        void runPersistenceMutation(() =>
          database.setWorkspaceActivityVisitWatermark(
            workspaceId,
            processedThrough,
          ),
        ).catch(() => undefined)
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
    createInitialKnownGoodPersistedStateBackup(databasePath)
    persistedStateRecovery = null
    runtimeInitialized = true
    return true
  } catch (error) {
    database.close()
    activeDatabasePath = null
    runtimeInitialized = false
    const failedBootstrap = createPersistedStateBootstrapFailure(
      databasePath,
      error,
      preparedState.preMigrationBackupPath,
    )
    if (failedBootstrap.status === 'recovery') {
      persistedStateRecovery = failedBootstrap.recovery
    }
    return false
  }
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
  if (ipcHandlersRegistered) {
    return
  }

  ipcHandlersRegistered = true
  const publishPersistenceSnapshot = () => {
    const snapshot = database.getSnapshot()
    windowManager.broadcast(IPC_CHANNELS.workspacePersistenceEvent, {
      revision: snapshot.catalogRevision,
      snapshot,
    })
    return snapshot
  }

  ipcMain.handle(IPC_CHANNELS.getStorageSnapshot, () => database.getSnapshot())
  ipcMain.handle(IPC_CHANNELS.getWorkspaceActivitySnapshot, () =>
    workspaceActivityService.getSnapshot(),
  )
  ipcMain.handle(IPC_CHANNELS.getManagedSessionSnapshots, () =>
    managedSessionManager.getSnapshots(),
  )
  ipcMain.handle(IPC_CHANNELS.getProviderCapabilities, () =>
    providerCapabilityService.getSnapshot(),
  )
  ipcMain.handle(
    IPC_CHANNELS.getWorkspacePreviewSnapshot,
    (_event, workspaceId) =>
      runPersistenceMutation(() => previewManager.ensure(workspaceId)),
  )
  ipcMain.handle(IPC_CHANNELS.getWorkspacePreviewSnapshots, () =>
    previewManager.list(),
  )
  ipcMain.handle(IPC_CHANNELS.getRuntimeSnapshot, () => createRuntimeSnapshot())
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
    runPersistenceMutation(() => previewManager.openTab(workspaceId, url)),
  )
  ipcMain.handle(IPC_CHANNELS.previewSelectTab, (_event, workspaceId, tabId) =>
    runPersistenceMutation(() => previewManager.selectTab(workspaceId, tabId)),
  )
  ipcMain.handle(IPC_CHANNELS.previewCloseTab, (_event, workspaceId, tabId) =>
    runPersistenceMutation(() => previewManager.closeTab(workspaceId, tabId)),
  )
  ipcMain.handle(
    IPC_CHANNELS.previewNavigate,
    (_event, workspaceId, tabId, url) =>
      runPersistenceMutation(() =>
        previewManager.navigate(workspaceId, tabId, url),
      ),
  )
  ipcMain.handle(IPC_CHANNELS.previewReportNavigation, (_event, report) =>
    runPersistenceMutation(() => previewManager.reportNavigation(report)),
  )
  ipcMain.handle(
    IPC_CHANNELS.createWorkspace,
    (_event, input: CreateWorkspaceRequest) =>
      runPersistenceMutation(async () => {
        const snapshot = await gitWorkspaceService.createWorkspace(input)
        publishPersistenceSnapshot()
        return snapshot
      }),
  )
  ipcMain.handle(
    IPC_CHANNELS.attachWorkspace,
    (_event, input: AttachWorkspaceRequest) =>
      runPersistenceMutation(async () => {
        const snapshot = await gitWorkspaceService.attachWorkspace(input)
        publishPersistenceSnapshot()
        return snapshot
      }),
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
  ipcMain.handle(IPC_CHANNELS.importProject, (_event, repoPath: string) =>
    runPersistenceMutation(async () => {
      const result = await gitWorkspaceService.importProject(repoPath)
      publishPersistenceSnapshot()
      return result
    }),
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
    (_event, input: SetActiveSelectionInput) =>
      runPersistenceMutation(() => {
        database.setActiveSelection(input)
        workspaceActivityService.setVisibleWorkspace(input.workspaceId)
      }),
  )
  ipcMain.handle(
    IPC_CHANNELS.saveWorkspaceLayout,
    (_event, workspaceId: string, input: SaveWorkspaceLayoutInput) =>
      runPersistenceMutation(() => {
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
      }),
  )
  ipcMain.handle(
    IPC_CHANNELS.saveWorkspaceSurfaceState,
    (_event, workspaceId: string, input: SaveWorkspaceSurfaceStateInput) =>
      runPersistenceMutation(() => {
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
      }),
  )
  ipcMain.handle(
    IPC_CHANNELS.terminalCreate,
    (_event, input: TerminalSessionConfig) =>
      runPersistenceMutation(() => {
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
      }),
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
  ipcMain.handle(IPC_CHANNELS.managedSessionCreate, (_event, input: unknown) =>
    runPersistenceMutation(async () => {
      const config =
        await providerCapabilityService.resolveManagedSessionConfig(input)
      return managedSessionManager.createSession(config)
    }),
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

function reloadOpenWindows(): void {
  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.reload()
  }
}

function resumeFromPersistedStateRecovery(): void {
  if (!applicationRuntime.resume()) {
    throw new Error(
      'The database is still unavailable after the recovery action.',
    )
  }

  reloadOpenWindows()
}

function runPersistedStateRecoveryAction(action: () => void): void {
  try {
    action()
  } catch {
    throw new Error('The recovery action could not be completed safely.')
  }
}

function getRecommendedRecoveryBackupPath(
  recovery: PersistedStateRecoveryState,
): string {
  if (
    recovery.recommendedBackup === 'pre-migration' &&
    recovery.preMigrationBackupPath
  ) {
    return recovery.preMigrationBackupPath
  }

  if (
    recovery.recommendedBackup === 'known-good' &&
    recovery.knownGoodBackupPath
  ) {
    return recovery.knownGoodBackupPath
  }

  throw new Error('No recovery backup is available to restore.')
}

function registerPersistedStateRecoveryIpcHandlers(): void {
  ipcMain.handle(
    IPC_CHANNELS.getPersistedStateRecovery,
    (): PersistedStateRecovery | null => {
      const recovery = persistedStateRecovery
      if (!recovery) {
        return null
      }

      return toRendererPersistedStateRecovery(recovery)
    },
  )
  ipcMain.handle(IPC_CHANNELS.openPersistedStateDataFolder, async () => {
    const recovery = persistedStateRecovery
    if (!recovery) {
      throw new Error('Persisted-state recovery is not active.')
    }

    try {
      const error = await shell.openPath(recovery.dataDirectory)
      if (error) {
        throw new Error(error)
      }
    } catch {
      throw new Error('The saved-data folder could not be opened.')
    }
  })
  ipcMain.handle(IPC_CHANNELS.quitPersistedStateRecovery, () => {
    app.quit()
  })
  ipcMain.handle(IPC_CHANNELS.retryPersistedStateRecovery, () => {
    runPersistedStateRecoveryAction(() => resumeFromPersistedStateRecovery())
  })
  ipcMain.handle(IPC_CHANNELS.restorePersistedStateBackup, () => {
    const recovery = persistedStateRecovery
    if (!recovery) {
      throw new Error('Persisted-state recovery is not active.')
    }

    runPersistedStateRecoveryAction(() => {
      restorePersistedStateBackup(
        recovery.databasePath,
        getRecommendedRecoveryBackupPath(recovery),
      )
      resumeFromPersistedStateRecovery()
    })
  })
  ipcMain.handle(IPC_CHANNELS.resetPersistedState, () => {
    const recovery = persistedStateRecovery
    if (!recovery) {
      throw new Error('Persisted-state recovery is not active.')
    }

    runPersistedStateRecoveryAction(() => {
      resetPersistedState(recovery.databasePath)
      resumeFromPersistedStateRecovery()
    })
  })
}

const applicationRuntime = new ApplicationRuntime({
  closeDatabase: () => {
    if (!runtimeInitialized) {
      return
    }

    database.close()
    activeDatabasePath = null
    runtimeInitialized = false
  },
  createMainWindow: () => windowManager.createMainWindow(),
  hasWindows: () => windowManager.hasWindows(),
  initializeServices,
  quiescePersistenceWrites,
  reapStoppedManagedSessions: () => {
    if (!runtimeInitialized) {
      return
    }

    void managedSessionManager.reapSessions(
      (snapshot) => snapshot.sessionState === 'stopped',
    )
  },
  registerIpcHandlers,
  registerRecoveryIpcHandlers: registerPersistedStateRecoveryIpcHandlers,
  refreshKnownGoodBackup: () => {
    if (runtimeInitialized && activeDatabasePath) {
      refreshKnownGoodPersistedStateBackup(activeDatabasePath)
    }
  },
  shutdownServices: async () => {
    if (!runtimeInitialized) {
      return
    }

    await managedSessionManager.closeAll(2_000)
    await terminalSessionManager.closeAll(1_000)
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

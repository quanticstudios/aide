import { randomUUID } from 'node:crypto'
import { appendFileSync, mkdirSync } from 'node:fs'
import path from 'node:path'

import {
  app,
  BrowserWindow,
  dialog,
  ipcMain as electronIpcMain,
  type IpcMainInvokeEvent,
  Menu,
  Notification,
  safeStorage,
  shell,
} from 'electron'
import type { CheckpointRestoreMode } from '../shared/checkpoints'
import type { ManagedSessionAgentConfig } from '../shared/conversation-routing'
import type {
  AttachWorkspaceRequest,
  CreateWorkspaceRequest,
  WorkspaceGitCommitInput,
  WorkspaceGitFileMutationInput,
  WorkspaceGitMessageInput,
  WorkspaceGitPullRequestInput,
  WorkspaceGitRevertInput,
} from '../shared/git'
import { IPC_CHANNELS } from '../shared/ipc'
import { JevGateOverridesSchema } from '../shared/jev-gates'
import type { ManagedSessionDecision } from '../shared/managed-session'
import type {
  ProjectColor,
  ProjectIcon,
  SaveWorkspaceLayoutInput,
  SaveWorkspaceSurfaceStateInput,
  SetActiveSelectionInput,
} from '../shared/persistence'
import { PROJECT_COLOR_IDS } from '../shared/persistence'
import type { PersistedStateRecovery } from '../shared/recovery'
import type { RuntimeSnapshot } from '../shared/runtime'
import type { TaskMetadataUpdate } from '../shared/task-library'
import type { TaskNotification } from '../shared/task-notification'
import type {
  TerminalResizeInput,
  TerminalSessionConfig,
} from '../shared/terminal'
import type { UpdateEvent } from '../shared/update'
import { normalizeProjectSetupCommand } from '../shared/workspace-setup'
import { getAideDatabasePath, migrateLegacyDatabase } from './app-storage'
import { ApplicationRuntime } from './application-runtime'
import { ContextPreparation } from './context-preparation'
import type { AideDatabase } from './database'
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
import { JevGateSettings } from './jev-gate-settings'
import { JevGates } from './jev-gates'
import { JevSettings } from './jev-settings'
import { validateManagedSessionAttachments } from './managed-session-attachments'
import { ManagedSessionIpcBroadcaster } from './managed-session-ipc'
import { ManagedSessionManager } from './managed-session-manager'
import {
  preparePersistedState,
  resetPersistedState,
  restoreKnownGoodPersistedState,
} from './persistence-recovery'
import { PreviewManager } from './preview-manager'
import { readProjectFile, searchProjectFiles } from './project-files'
import { pickProjectRoot } from './project-picker'
import { ProviderCapabilityService } from './provider-capability-service'
import {
  applyRenderingConfiguration,
  resolveRenderingConfiguration,
} from './rendering'
import { TaskLibrary } from './task-library'
import { TerminalSessionManager } from './terminal-session-manager'
import { createTrustedIpcRegistrar } from './trusted-ipc'
import { isTrustedRendererUrl } from './trusted-renderer'
import { TurnCheckpointService } from './turn-checkpoints'
import { configuredUpdateHealthEndpoint } from './update-health-config'
import { UpdateHealthReporter } from './update-health-reporter'
import { UpdateManager, type UpdateReleaseOptions } from './update-manager'
import { requireUpdatePreferencesInput } from './update-preferences'
import { configuredUpdateRelease } from './update-release-config'
import { UpdateRestartCoordinator } from './update-restart-coordinator'
import { WindowManager } from './window-manager'
import { WorkspaceActivityService } from './workspace-activity-service'
import { WorkspaceSetupManager } from './workspace-setup-manager'
import {
  generateWorkspaceTitleWithCodex,
  lunaModelId,
  WorkspaceTitleService,
} from './workspace-title-service'

if (process.platform === 'linux') app.setDesktopName('aide.desktop')
if (process.env.AIDE_DATABASE_PATH) {
  const userDataPath = path.dirname(
    path.resolve(process.env.AIDE_DATABASE_PATH),
  )
  mkdirSync(userDataPath, { recursive: true })
  app.setPath('userData', userDataPath)
}
const hasInstanceLock = app.requestSingleInstanceLock()
if (!hasInstanceLock) app.exit(0)
let database: AideDatabase
let persistedStateRecovery: PersistedStateRecovery | null = null
let runtimeInitialized = false
let gitWorkspaceService: GitWorkspaceService
let workspaceActivityService: WorkspaceActivityService
let managedSessionManager: ManagedSessionManager
let managedSessionBroadcaster: ManagedSessionIpcBroadcaster
let taskLibrary: TaskLibrary
let turnCheckpoints: TurnCheckpointService
const restoringWorkspaces = new Set<string>()
const checkpointPreviews = new Map<string, string>()
let jevSettings: JevSettings
let jevGateSettings: JevGateSettings
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
  rendererHtmlPath: path.join(import.meta.dirname, '../renderer/index.html'),
}
const lastRendererFaultAt = new Map<string, number>()
const AGENT_ALIAS_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const MAX_CONFIGURED_AGENTS = 2

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

function requireProjectAppearance(input: unknown): {
  color: ProjectColor
  icon: ProjectIcon
} {
  if (
    !isRecord(input) ||
    !PROJECT_COLOR_IDS.includes(input.color as ProjectColor) ||
    typeof input.icon !== 'string' ||
    !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(input.icon) ||
    input.icon.length > 80
  ) {
    throw new Error('Invalid project appearance.')
  }

  return { color: input.color as ProjectColor, icon: input.icon as ProjectIcon }
}

function requireWorkspaceGitMutationId(input: unknown): string {
  if (!isRecord(input)) {
    throw new Error('Invalid workspace Git request.')
  }

  return requireRuntimeId(input.workspaceId, 'workspace id')
}

function requireTerminalSize(value: unknown): TerminalResizeInput {
  if (
    !isRecord(value) ||
    !Number.isInteger(value.cols) ||
    !Number.isInteger(value.rows) ||
    typeof value.cols !== 'number' ||
    typeof value.rows !== 'number' ||
    value.cols < 1 ||
    value.rows < 1 ||
    value.cols > 1_000 ||
    value.rows > 1_000
  )
    throw new Error('Invalid terminal dimensions.')
  return { cols: value.cols, rows: value.rows }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

async function resolveConfiguredAgents(
  value: unknown,
): Promise<readonly ManagedSessionAgentConfig[]> {
  if (!Array.isArray(value) || value.length > MAX_CONFIGURED_AGENTS) {
    throw new Error('Invalid configured agents.')
  }

  const aliases = new Set<string>()
  return await Promise.all(
    value.map(async (entry) => {
      if (!isRecord(entry) || !isRecord(entry.selection)) {
        throw new Error('Invalid configured agent.')
      }

      const alias = requireRuntimeId(entry.alias, 'agent alias')
      const normalizedAlias = alias.toLowerCase()
      if (!AGENT_ALIAS_PATTERN.test(alias) || aliases.has(normalizedAlias)) {
        throw new Error('Configured agent aliases must be unique.')
      }
      aliases.add(normalizedAlias)

      const requestedModel = entry.selection.model
      if (typeof requestedModel !== 'string' || requestedModel.trim() === '') {
        throw new Error(`Configured agent @${alias} requires a model.`)
      }

      const selection =
        await providerCapabilityService.resolveManagedSessionProviderSelection(
          entry.selection,
        )
      if (selection.model !== requestedModel.trim()) {
        throw new Error(
          `Configured agent @${alias} selected an unavailable model.`,
        )
      }

      return {
        alias: normalizedAlias,
        selection: {
          effort: selection.effort,
          mode: selection.mode,
          model: selection.model,
          ...(selection.serviceTier !== undefined
            ? { serviceTier: selection.serviceTier }
            : {}),
        },
      }
    }),
  )
}

function requireRecipientAliases(value: unknown): readonly string[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value) || value.length > MAX_CONFIGURED_AGENTS) {
    throw new Error('Invalid managed-session recipients.')
  }

  const aliases = new Set<string>()
  for (const entry of value) {
    const alias = requireRuntimeId(entry, 'recipient alias')
    const normalizedAlias = alias.toLowerCase()
    if (!AGENT_ALIAS_PATTERN.test(alias) || aliases.has(normalizedAlias)) {
      throw new Error('Managed-session recipients must be unique aliases.')
    }
    aliases.add(normalizedAlias)
  }
  return [...aliases]
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

/** A null workspace id addresses the global Jev gate layer, which no workspace owns. */
function requireJevGateWorktree(
  event: IpcMainInvokeEvent,
  workspaceId: unknown,
): string | null {
  if (workspaceId === null) {
    requireTrustedRenderer(event)
    return null
  }

  return requireWorkspaceForSetup(event, workspaceId).worktreePath
}

function prepareDatabase(): boolean {
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

  const result = preparePersistedState(databasePath)
  if (result.status === 'recovery') {
    persistedStateRecovery = result.recovery
    return false
  }
  database = result.database
  persistedStateRecovery = null
  return true
}

function initializeServices(): void {
  const databasePath = getAideDatabasePath({
    databasePathOverride: process.env.AIDE_DATABASE_PATH,
    userDataPath: app.getPath('userData'),
  })
  jevSettings = new JevSettings(
    path.join(path.dirname(databasePath), 'jev-settings.json'),
    safeStorage,
  )
  jevGateSettings = new JevGateSettings(
    path.join(path.dirname(databasePath), 'jev-gates.json'),
  )
  const jevDecisionLog = path.join(
    path.dirname(databasePath),
    'jev-decisions.jsonl',
  )
  const jevGates = new JevGates({
    getApiKey: (workspaceRoot) => jevSettings.getApiKey(workspaceRoot),
    log: (row) => {
      try {
        appendFileSync(jevDecisionLog, `${JSON.stringify(row)}\n`, {
          mode: 0o600,
        })
      } catch {
        return
      }
    },
  })
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
  gitWorkspaceService = new GitWorkspaceService(
    database,
    undefined,
    async ({ prompt, workspaceId }) => {
      const workspace = database.getWorkspace(workspaceId)
      const model = lunaModelId(await providerCapabilityService.getSnapshot())
      if (!workspace || !model) {
        throw new Error('No Codex model is available to write a message.')
      }
      return generateWorkspaceTitleWithCodex({ model, prompt, workspace })
    },
  )
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
  const contextPreparation = new ContextPreparation(jevSettings)
  turnCheckpoints = new TurnCheckpointService({
    storageDirectory: path.join(app.getPath('userData'), 'turn-checkpoints'),
    getWorkspaceDirectory: (workspaceId) =>
      database.getWorkspace(workspaceId)?.worktreePath ?? null,
    getSessionSnapshot: getSavedTaskSnapshot,
    isSessionActive: (sessionId) => {
      const snapshot = getSavedTaskSnapshot(sessionId)
      return Object.values(managedSessionManager.getSnapshots()).some(
        (session) =>
          session.workspaceId === snapshot?.workspaceId &&
          managedSessionManager.isSessionBusy(session.sessionId),
      )
    },
  })
  providerCapabilityService = new ProviderCapabilityService()
  const workspaceTitleService = new WorkspaceTitleService({
    getCapabilities: () => providerCapabilityService.getSnapshot(),
    store: {
      getWorkspace: (workspaceId) => database.getWorkspace(workspaceId),
      renameWorkspaceIfUnchanged: (workspaceId, input) => {
        const workspace = database.renameWorkspaceIfUnchanged(
          workspaceId,
          input,
        )
        if (workspace) publishPersistenceSnapshot()
        return workspace
      },
    },
  })
  managedSessionBroadcaster = new ManagedSessionIpcBroadcaster({
    send: (event) =>
      windowManager.broadcast(IPC_CHANNELS.managedSessionEvent, event),
  })
  managedSessionManager = new ManagedSessionManager({
    store: database,
    jevGates,
    resolveJevGates: (config) =>
      jevGateSettings.resolve(config.cwd, config.jevGates),
    afterTurn: (checkpointId) => turnCheckpoints.completeTurn(checkpointId),
    beforeInput: async ({ config, snapshot, text }) => {
      const workspace = database.getWorkspace(config.workspaceId)
      if (!workspace || workspace.worktreePath !== config.cwd)
        throw new Error(
          'The conversation workspace changed. Reopen it before sending a message.',
        )
      if (restoringWorkspaces.has(config.workspaceId))
        throw new Error(
          'Wait for checkpoint restoration before sending a message.',
        )
      if (database.getProject(workspace.projectId)?.kind === 'folder') {
        return undefined
      }
      return turnCheckpoints.captureTurn({
        config,
        snapshot,
        editedPrompt: text,
      })
    },
    prepareInput: (input) => {
      if (restoringWorkspaces.has(input.config.workspaceId))
        throw new Error(
          'Wait for checkpoint restoration before sending a message.',
        )
      const workspace = database.getWorkspace(input.config.workspaceId)
      if (!workspace || workspace.worktreePath !== input.config.cwd) {
        throw new Error(
          'The conversation workspace changed. Reopen the workspace before sending a message.',
        )
      }
      return contextPreparation.prepare(input)
    },
    onRuntimeEvent: () => undefined,
    onUserPrompt: ({ text, workspaceId }) => {
      workspaceTitleService.requestTitle(workspaceId, text)
    },
    onUpdate: (event) => {
      if (event.type === 'snapshot') {
        workspaceActivityService.handleManagedSessionSnapshot(event.snapshot)
        const notification = taskLibrary?.nextNotification(event.snapshot)
        if (notification) showTaskNotification(notification)
        const attentionCount = taskLibrary?.attentionCount() ?? 0
        if (attentionCount !== badgeCount) {
          badgeCount = attentionCount
          app.setBadgeCount(attentionCount)
        }
        managedSessionBroadcaster.update(event.snapshot)
      } else {
        workspaceActivityService.handleManagedSessionRemoved(event.sessionId)
        managedSessionBroadcaster.remove(event.sessionId, event.revision)
      }
      windowManager.broadcast(IPC_CHANNELS.taskLibraryChanged, null)
    },
  })
  taskLibrary = new TaskLibrary(database, () =>
    managedSessionManager.getSnapshots(),
  )
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
  createBrowserWindow: (options) =>
    new BrowserWindow({
      ...options,
      icon: app.isPackaged
        ? path.join(process.resourcesPath, 'icon.png')
        : path.join(app.getAppPath(), 'build/icon.png'),
    }),
  fromWebContents: (webContents) => BrowserWindow.fromWebContents(webContents),
  getAllWindows: () => BrowserWindow.getAllWindows(),
  loadRendererUrl: process.env.ELECTRON_RENDERER_URL,
  mainPreloadPath: path.join(import.meta.dirname, '../preload/index.js'),
  rendererHtmlPath: rendererLocation.rendererHtmlPath,
  setTimeout,
})

let badgeCount = 0

function showTaskNotification(notification: TaskNotification) {
  const focusedWindow = BrowserWindow.getFocusedWindow()
  const sound = database.getTaskNotificationSoundsEnabled()
  // The renderer plays the sound, so it also gets unfocused notifications when sounds are on.
  if (focusedWindow || sound)
    (focusedWindow ?? BrowserWindow.getAllWindows()[0])?.webContents.send(
      IPC_CHANNELS.taskNotification,
      { ...notification, toast: focusedWindow !== null, sound },
    )
  if (focusedWindow || !Notification.isSupported()) return
  const osNotification = new Notification({
    title: notification.title,
    body: notification.body,
    silent: true,
  })
  osNotification.on('click', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
    window.webContents.send(IPC_CHANNELS.taskOpen, notification.sessionId)
  })
  osNotification.show()
}

function publishPersistenceSnapshot() {
  const snapshot = database.getSnapshot()
  windowManager.broadcast(IPC_CHANNELS.workspacePersistenceEvent, {
    revision: snapshot.catalogRevision,
    snapshot,
  })
  return snapshot
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

function getSavedTaskSnapshot(sessionId: string) {
  return (
    managedSessionManager.getSnapshots()[sessionId] ??
    database
      .listManagedSessions()
      .find((session) => session.config.sessionId === sessionId)?.snapshot ??
    null
  )
}

function registerIpcHandlers(): void {
  const ipcMain = createTrustedIpcRegistrar(
    electronIpcMain,
    requireTrustedRenderer,
  )
  ipcMain.handle(IPC_CHANNELS.getTaskLibrary, (_event, query?: string) =>
    taskLibrary.getSnapshot(query),
  )
  ipcMain.handle(IPC_CHANNELS.openTask, (event, sessionId: unknown) => {
    const id = requireRuntimeId(sessionId, 'conversation id')
    if (!getSavedTaskSnapshot(id))
      throw new Error('This conversation is no longer available.')
    event.sender.send(IPC_CHANNELS.taskOpen, id)
  })
  ipcMain.handle(
    IPC_CHANNELS.turnCheckpointDiff,
    async (_event, sessionId: unknown, checkpointId: unknown) => {
      const id = requireRuntimeId(sessionId, 'conversation id')
      await managedSessionManager.waitForCheckpointCompletion(id)
      return turnCheckpoints.getTurnDiff(
        id,
        requireRuntimeId(checkpointId, 'checkpoint id'),
      )
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.turnCheckpointList,
    (_event, sessionId: unknown) =>
      turnCheckpoints.listCheckpoints(
        requireRuntimeId(sessionId, 'conversation id'),
      ),
  )
  ipcMain.handle(
    IPC_CHANNELS.turnCheckpointPreviewRestore,
    async (_event, sessionId: unknown, checkpointId: unknown) => {
      const id = requireRuntimeId(sessionId, 'conversation id')
      const snapshot = getSavedTaskSnapshot(id)
      if (!snapshot || restoringWorkspaces.has(snapshot.workspaceId))
        throw new Error('The conversation is unavailable during restoration.')
      const preview = await turnCheckpoints.previewRestore(
        id,
        requireRuntimeId(checkpointId, 'checkpoint id'),
      )
      checkpointPreviews.set(preview.previewId, id)
      return preview
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.turnCheckpointRestore,
    async (_event, previewId: unknown, mode: CheckpointRestoreMode) => {
      const id = requireRuntimeId(previewId, 'checkpoint preview id')
      const sourceId = checkpointPreviews.get(id)
      const snapshot = sourceId ? getSavedTaskSnapshot(sourceId) : null
      if (!snapshot)
        throw new Error('Preview the checkpoint again before restoring.')
      const workspaceId = requireRuntimeId(snapshot.workspaceId, 'workspace id')
      if (restoringWorkspaces.has(workspaceId))
        throw new Error('A checkpoint restoration is already running.')
      const workspace = database.getWorkspace(workspaceId)
      if (!workspace)
        throw new Error('The checkpoint workspace is no longer available.')
      if (workspaceSetupManager.getSnapshot(workspace.id).state === 'running') {
        throw new Error(
          'Wait for workspace setup to finish before restoring a checkpoint.',
        )
      }
      return gitWorkspaceService.runWorkspaceMutation(
        workspace.id,
        async () => {
          restoringWorkspaces.add(workspace.id)
          try {
            const seed = await turnCheckpoints.restore(id, mode)
            if (seed.config.cwd !== workspace.worktreePath)
              throw new Error('The checkpoint workspace path changed.')
            const paneId = `agent::copy-checkpoint-${randomUUID()}`
            const sessionId = `${workspace.id}:${paneId}`
            const identity = { paneId, sessionId, workspaceId: workspace.id }
            managedSessionManager.registerRestoredSession(
              { ...seed.config, ...identity },
              { ...seed.snapshot, ...identity },
            )
            checkpointPreviews.delete(id)
            windowManager.broadcast(IPC_CHANNELS.taskLibraryChanged, null)
            return {
              checkpointId: seed.checkpointId,
              editedPrompt: seed.editedPrompt,
              mode,
              sessionId,
              sourceSessionId: seed.sourceSessionId,
            }
          } finally {
            restoringWorkspaces.delete(workspace.id)
          }
        },
      )
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.getTaskTranscript,
    (_event, sessionId: unknown) => {
      if (typeof sessionId !== 'string' || sessionId.length > 1024) {
        throw new Error('Invalid conversation identifier.')
      }
      return getSavedTaskSnapshot(sessionId)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.updateTaskMetadata,
    (_event, sessionId: string, input: TaskMetadataUpdate) => {
      const snapshot = taskLibrary.update(sessionId, input)
      windowManager.broadcast(IPC_CHANNELS.taskLibraryChanged, null)
      return snapshot
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.setTaskNotifications,
    (_event, enabled: boolean) => {
      database.setTaskNotificationsEnabled(enabled)
      windowManager.broadcast(IPC_CHANNELS.taskLibraryChanged, null)
      return taskLibrary.getSnapshot()
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.setTaskNotificationSounds,
    (_event, enabled: boolean) => {
      database.setTaskNotificationSoundsEnabled(enabled)
      windowManager.broadcast(IPC_CHANNELS.taskLibraryChanged, null)
      return taskLibrary.getSnapshot()
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.getComposerDefaults,
    (_event, workspaceId: unknown) =>
      database.getComposerDefaults(
        requireRuntimeId(workspaceId, 'workspace id'),
      ),
  )
  ipcMain.handle(
    IPC_CHANNELS.setComposerDefaults,
    (_event, workspaceId: unknown, defaults: unknown) =>
      database.setComposerDefaults(
        requireRuntimeId(workspaceId, 'workspace id'),
        defaults,
      ),
  )
  ipcMain.handle(IPC_CHANNELS.getJevSettings, (event, workspaceId: unknown) => {
    const workspace = requireWorkspaceForSetup(event, workspaceId)
    return jevSettings.getStatus(workspace.worktreePath)
  })
  ipcMain.handle(
    IPC_CHANNELS.updateJevSettings,
    (event, workspaceId: unknown, input: unknown) => {
      const workspace = requireWorkspaceForSetup(event, workspaceId)
      return jevSettings.update(workspace.worktreePath, input)
    },
  )
  ipcMain.handle(IPC_CHANNELS.getJevGates, (event, workspaceId: unknown) =>
    jevGateSettings.get(requireJevGateWorktree(event, workspaceId)),
  )
  ipcMain.handle(
    IPC_CHANNELS.updateJevGates,
    (event, scope: unknown, workspaceId: unknown, overrides: unknown) => {
      if (scope !== 'global' && scope !== 'workspace')
        throw new Error('Unknown Jev gate scope.')
      return jevGateSettings.update(
        scope,
        requireJevGateWorktree(event, workspaceId),
        overrides,
      )
    },
  )
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
  ipcMain.handle(IPC_CHANNELS.managedSessionSync, (_event, sessionId) =>
    managedSessionBroadcaster.sync(String(sessionId)),
  )
  ipcMain.handle(IPC_CHANNELS.getProviderCapabilities, () =>
    providerCapabilityService.getSnapshot(),
  )
  ipcMain.handle(
    IPC_CHANNELS.getProviderSkills,
    (event, workspaceId: unknown, forceReload: unknown) => {
      const workspace = requireWorkspaceForSetup(event, workspaceId)
      if (forceReload !== undefined && typeof forceReload !== 'boolean') {
        throw new Error('Invalid provider skill refresh request.')
      }
      return providerCapabilityService.getProviderSkills(
        workspace.id,
        workspace.worktreePath,
        forceReload === true,
      )
    },
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
    IPC_CHANNELS.renameWorkspace,
    (event, workspaceId: unknown, name: unknown) => {
      requireTrustedRenderer(event)
      const id = requireRuntimeId(workspaceId, 'workspace id')
      if (typeof name !== 'string' || name.trim().length === 0) {
        throw new Error('Enter a workspace name.')
      }
      const normalizedName = name.trim()
      if (normalizedName.length > 80) {
        throw new Error('Workspace names must be 80 characters or fewer.')
      }
      if (
        !database.updateWorkspace(id, {
          name: normalizedName,
          nameSource: 'manual',
        })
      ) {
        throw new Error('Workspace not found.')
      }
      return publishPersistenceSnapshot()
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.updateWorkspaceSidebar,
    (event, workspaceId: unknown, isOpen: unknown) => {
      requireTrustedRenderer(event)
      const id = requireRuntimeId(workspaceId, 'workspace id')
      if (typeof isOpen !== 'boolean') {
        throw new Error('Sidebar state must be a boolean.')
      }
      if (!database.updateWorkspace(id, { sidebarOpen: isOpen })) {
        throw new Error('Workspace not found.')
      }
      return publishPersistenceSnapshot()
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
    IPC_CHANNELS.archiveWorkspace,
    (event, workspaceId: unknown, archived: unknown) => {
      requireTrustedRenderer(event)
      const validWorkspaceId = requireRuntimeId(workspaceId, 'workspace id')
      if (typeof archived !== 'boolean') {
        throw new Error('Archived flag must be a boolean.')
      }
      if (!database.updateWorkspace(validWorkspaceId, { archived })) {
        throw new Error('Workspace does not exist.')
      }
      return publishPersistenceSnapshot()
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.deleteWorkspace,
    async (event, workspaceId: unknown, removeWorktree: unknown) => {
      requireTrustedRenderer(event)
      const validWorkspaceId = requireRuntimeId(workspaceId, 'workspace id')
      if (typeof removeWorktree !== 'boolean') {
        throw new Error('Remove-worktree flag must be a boolean.')
      }
      // Stop everything running in the workspace before its rows cascade away.
      await workspaceSetupManager.cancelForWorkspace(validWorkspaceId)
      await managedSessionManager.reapSessions(
        (snapshot) => snapshot.workspaceId === validWorkspaceId,
      )
      terminalSessionManager.killWorkspaceSessions(validWorkspaceId)
      await gitWorkspaceService.deleteWorkspace(
        validWorkspaceId,
        removeWorktree,
      )
      return publishPersistenceSnapshot()
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
  ipcMain.handle(
    IPC_CHANNELS.updateProjectAppearance,
    (event, projectId: unknown, input: unknown) => {
      requireTrustedRenderer(event)
      const validProjectId = requireRuntimeId(projectId, 'project id')
      const project = database.updateProject(
        validProjectId,
        requireProjectAppearance(input),
      )
      if (!project) {
        throw new Error('Project does not exist.')
      }
      return publishPersistenceSnapshot()
    },
  )
  ipcMain.handle(IPC_CHANNELS.runWorkspaceSetup, (event, workspaceId) => {
    const workspace = requireWorkspaceForSetup(event, workspaceId)
    if (restoringWorkspaces.has(workspace.id)) {
      throw new Error('Wait for checkpoint restoration before running setup.')
    }
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
  ipcMain.handle(IPC_CHANNELS.stageWorkspaceGitFile, (_event, input) =>
    gitWorkspaceService.runWorkspaceMutation(
      requireWorkspaceGitMutationId(input),
      () =>
        gitWorkspaceService.stageWorkspaceFile(
          input as WorkspaceGitFileMutationInput,
        ),
    ),
  )
  ipcMain.handle(IPC_CHANNELS.unstageWorkspaceGitFile, (_event, input) =>
    gitWorkspaceService.runWorkspaceMutation(
      requireWorkspaceGitMutationId(input),
      () =>
        gitWorkspaceService.unstageWorkspaceFile(
          input as WorkspaceGitFileMutationInput,
        ),
    ),
  )
  ipcMain.handle(IPC_CHANNELS.revertWorkspaceGitFile, (_event, input) =>
    gitWorkspaceService.runWorkspaceMutation(
      requireWorkspaceGitMutationId(input),
      () =>
        gitWorkspaceService.revertWorkspaceFile(
          input as WorkspaceGitRevertInput,
        ),
    ),
  )
  ipcMain.handle(IPC_CHANNELS.commitWorkspaceGitIndex, (_event, input) =>
    gitWorkspaceService.runWorkspaceMutation(
      requireWorkspaceGitMutationId(input),
      () =>
        gitWorkspaceService.commitWorkspaceIndex(
          input as WorkspaceGitCommitInput,
        ),
    ),
  )
  ipcMain.handle(IPC_CHANNELS.commitAllAndPushWorkspaceGit, (_event, input) =>
    gitWorkspaceService.runWorkspaceMutation(
      requireWorkspaceGitMutationId(input),
      () =>
        gitWorkspaceService.commitAllAndPushWorkspace(
          input as WorkspaceGitCommitInput,
        ),
    ),
  )
  ipcMain.handle(IPC_CHANNELS.pushWorkspaceGitBranch, (_event, workspaceId) =>
    gitWorkspaceService.pushWorkspaceBranch(workspaceId as string),
  )
  ipcMain.handle(IPC_CHANNELS.pullWorkspaceGitBranch, (_event, workspaceId) =>
    gitWorkspaceService.runWorkspaceMutation(
      requireRuntimeId(workspaceId, 'workspace id'),
      () => gitWorkspaceService.pullWorkspaceBranch(workspaceId as string),
    ),
  )
  ipcMain.handle(IPC_CHANNELS.abortWorkspaceGitPull, (_event, workspaceId) =>
    gitWorkspaceService.runWorkspaceMutation(
      requireRuntimeId(workspaceId, 'workspace id'),
      () => gitWorkspaceService.abortWorkspacePull(workspaceId as string),
    ),
  )
  ipcMain.handle(IPC_CHANNELS.startWorkspaceGitFeatureBranch, (_event, input) =>
    gitWorkspaceService.runWorkspaceMutation(
      requireWorkspaceGitMutationId(input),
      () =>
        gitWorkspaceService.startWorkspaceFeatureBranch(
          input as WorkspaceGitCommitInput,
        ),
    ),
  )
  ipcMain.handle(IPC_CHANNELS.generateWorkspaceGitMessage, (_event, input) => {
    requireWorkspaceGitMutationId(input)
    return gitWorkspaceService.generateWorkspaceGitMessage(
      input as WorkspaceGitMessageInput,
    )
  })
  ipcMain.handle(IPC_CHANNELS.createWorkspaceGitPullRequest, (_event, input) =>
    gitWorkspaceService.createWorkspacePullRequest(
      input as WorkspaceGitPullRequestInput,
    ),
  )
  ipcMain.handle(
    IPC_CHANNELS.getWorkspaceGitPullRequest,
    (_event, workspaceId) =>
      gitWorkspaceService.getWorkspacePullRequest(workspaceId as string),
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
  ipcMain.handle(IPC_CHANNELS.terminalCreate, (event, input: unknown) => {
    if (!isRecord(input) || input.mode !== 'shell')
      throw new Error('Invalid terminal configuration.')
    const workspace = requireWorkspaceForSetup(event, input.workspaceId)
    const config: TerminalSessionConfig = {
      ...requireTerminalSize(input),
      cwd: workspace.worktreePath,
      mode: 'shell',
      paneId: requireRuntimeId(input.paneId, 'pane id'),
      sessionId: requireRuntimeId(input.sessionId, 'terminal session id'),
      workspaceId: workspace.id,
    }
    workspaceActivityService.trackSession(config)
    try {
      return terminalSessionManager.createSession(config)
    } catch (error) {
      workspaceActivityService.handleSessionLaunchFailure(config, error)
      throw error
    }
  })
  ipcMain.handle(IPC_CHANNELS.terminalKill, (_event, sessionId: string) => {
    terminalSessionManager.killSession(
      requireRuntimeId(sessionId, 'terminal session id'),
    )
  })
  ipcMain.handle(
    IPC_CHANNELS.terminalResize,
    (_event, sessionId: string, size: TerminalResizeInput) => {
      terminalSessionManager.resizeSession(
        requireRuntimeId(sessionId, 'terminal session id'),
        requireTerminalSize(size),
      )
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.terminalWrite,
    (_event, sessionId: string, data: string) => {
      if (typeof data !== 'string' || data.length > 1_048_576)
        throw new Error('Invalid terminal input.')
      terminalSessionManager.writeToSession(
        requireRuntimeId(sessionId, 'terminal session id'),
        data,
      )
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionCreate,
    async (event, input: unknown) => {
      requireTrustedRenderer(event)
      if (!isRecord(input)) {
        throw new Error('Invalid managed-session configuration.')
      }
      const agents = await resolveConfiguredAgents(input.agents ?? [])
      const config =
        await providerCapabilityService.resolveManagedSessionConfig(input)
      const workspace = requireWorkspaceForSetup(event, config.workspaceId)
      config.cwd = workspace.worktreePath
      if (!managedSessionManager.getSnapshots()[config.sessionId]) {
        workspaceSetupManager.assertManagedSessionAllowed(config.workspaceId)
      }
      return managedSessionManager.createSession({
        ...config,
        readOnly: false,
        agents,
        orchestratorSelection: {
          effort: config.effort,
          mode: config.mode,
          model: config.model,
          ...(config.serviceTier !== undefined
            ? { serviceTier: config.serviceTier }
            : {}),
        },
      })
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionBranch,
    (event, sessionId: unknown, responseContentItemId: unknown) => {
      requireTrustedRenderer(event)
      const branch = managedSessionManager.branchSession(
        requireRuntimeId(sessionId, 'managed-session id'),
        requireRuntimeId(responseContentItemId, 'response id'),
      )
      windowManager.broadcast(IPC_CHANNELS.taskLibraryChanged, null)
      event.sender.send(IPC_CHANNELS.taskOpen, branch.sessionId)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionClose,
    (_event, sessionId: string) =>
      managedSessionManager.closeSession(sessionId),
  )
  ipcMain.handle(
    IPC_CHANNELS.managedFleetAcceptNode,
    (_event, input: unknown) => {
      if (!isRecord(input) || typeof input.accepted !== 'boolean') {
        throw new Error('Invalid fleet acceptance.')
      }
      return managedSessionManager.acceptFleetNode(
        requireRuntimeId(input.sessionId, 'Session id'),
        requireRuntimeId(input.nodeId, 'Node id'),
        input.accepted,
      )
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionInterrupt,
    (_event, sessionId: unknown, recipientAlias: unknown) => {
      const id = requireRuntimeId(sessionId, 'managed-session id')
      const aliases =
        recipientAlias === undefined
          ? []
          : requireRecipientAliases([recipientAlias])
      return managedSessionManager.interruptSession(id, aliases[0])
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionPickFiles,
    async (event, workspaceId: unknown) => {
      const workspace = requireWorkspaceForSetup(event, workspaceId)
      const browserWindow = BrowserWindow.fromWebContents(event.sender)
      if (!browserWindow) throw new Error('Workspace window is unavailable.')
      const result = await dialog.showOpenDialog(browserWindow, {
        defaultPath: workspace.worktreePath,
        properties: ['openFile', 'multiSelections'],
        title: 'Attach workspace files',
      })
      if (result.canceled) return []
      return result.filePaths.map((filePath) => {
        const relativePath = path.relative(workspace.worktreePath, filePath)
        if (
          !relativePath ||
          relativePath === '..' ||
          relativePath.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relativePath)
        ) {
          throw new Error('Choose files inside the current workspace.')
        }
        return relativePath
      })
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionSearchFiles,
    (event, workspaceId: unknown, query: unknown) => {
      const workspace = requireWorkspaceForSetup(event, workspaceId)
      if (typeof query !== 'string' || !query.trim() || query.length > 128) {
        throw new Error('Enter a file name to search.')
      }
      return searchProjectFiles(workspace.worktreePath, query)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionSendInput,
    async (
      event,
      sessionId: unknown,
      text: unknown,
      recipients: unknown,
      attachments: unknown,
      selectedSkill: unknown,
    ) => {
      const id = requireRuntimeId(sessionId, 'managed-session id')
      if (typeof text !== 'string' || !text.trim() || text.length > 65_536) {
        throw new Error('Enter a message between 1 and 65,536 characters.')
      }
      const session = managedSessionManager.getSnapshots()[id]
      if (!session) throw new Error('Managed session is unavailable.')
      const workspace = requireWorkspaceForSetup(event, session.workspaceId)
      jevSettings.requireApiKey(workspace.worktreePath)
      const recipientAliases = requireRecipientAliases(recipients)
      if (selectedSkill !== undefined && recipientAliases.length > 0) {
        throw new Error('A provider skill cannot target read-only agents.')
      }
      const resolvedSkill =
        selectedSkill === undefined
          ? undefined
          : await providerCapabilityService.resolveProviderSkill(
              workspace.id,
              workspace.worktreePath,
              selectedSkill,
            )
      if (resolvedSkill && resolvedSkill.provider !== session.provider) {
        throw new Error('Selected provider skill does not match this session.')
      }
      return managedSessionManager.sendInput(
        id,
        text,
        recipientAliases,
        validateManagedSessionAttachments(attachments),
        resolvedSkill,
      )
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionConfigureMode,
    (_event, sessionId: unknown, interactionMode: unknown) => {
      if (interactionMode !== 'build' && interactionMode !== 'plan')
        throw new Error('Invalid interaction mode.')
      return managedSessionManager.configureSessionMode(
        requireRuntimeId(sessionId, 'managed-session id'),
        interactionMode,
      )
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionConfigurePermissionMode,
    (_event, sessionId: unknown, permissionMode: unknown) => {
      if (
        permissionMode !== 'acceptEdits' &&
        permissionMode !== 'bypassPermissions' &&
        permissionMode !== 'default' &&
        permissionMode !== 'plan'
      )
        throw new Error('Invalid permission mode.')
      return managedSessionManager.configureSessionPermissionMode(
        requireRuntimeId(sessionId, 'managed-session id'),
        permissionMode,
      )
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionConfigureJevGates,
    (event, sessionId: unknown, overrides: unknown) => {
      requireTrustedRenderer(event)
      const parsed =
        overrides === null ? undefined : JevGateOverridesSchema.parse(overrides)
      return managedSessionManager.configureSessionJevGates(
        requireRuntimeId(sessionId, 'managed-session id'),
        parsed,
      )
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionConfigureAgents,
    async (_event, sessionId: unknown, agents: unknown) =>
      managedSessionManager.configureSessionAgents(
        requireRuntimeId(sessionId, 'managed-session id'),
        await resolveConfiguredAgents(agents),
      ),
  )
  ipcMain.handle(
    IPC_CHANNELS.managedSessionResolveRequest,
    (
      _event,
      sessionId: string,
      requestId: string,
      decision: ManagedSessionDecision,
      reason: unknown,
    ) =>
      managedSessionManager.resolveRequest(
        sessionId,
        requestId,
        decision,
        typeof reason === 'string' && reason.trim() ? reason.trim() : undefined,
      ),
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
  ipcMain.handle(
    IPC_CHANNELS.readProjectFile,
    (event, workspaceId: unknown, relativePath: unknown) => {
      const workspace = requireWorkspaceForSetup(event, workspaceId)
      if (
        typeof relativePath !== 'string' ||
        !relativePath ||
        relativePath.length > 4_096
      )
        throw new Error('Invalid project file path.')
      return readProjectFile(workspace.worktreePath, relativePath)
    },
  )
  ipcMain.handle(
    IPC_CHANNELS.getWorktreeBranchStats,
    (_event, workspaceId: string) =>
      gitWorkspaceService.getWorktreeBranchStats(workspaceId),
  )
}

const applicationRuntime = new ApplicationRuntime({
  createMainWindow: () => {
    if (!windowManager.hasWindows()) windowManager.createMainWindow()
  },
  hasWindows: () => windowManager.hasWindows(),
  initializeServices,
  reapStoppedManagedSessions: () => {
    void managedSessionManager.reapSessions(
      (snapshot) => snapshot.sessionState === 'stopped',
    )
  },
  registerIpcHandlers,
  shutdownServices: async (reason) => {
    if (!runtimeInitialized) return
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
      runtimeInitialized = false
    }
  },
  startReaper: setInterval,
})

function startReadyRuntime(): void {
  applicationRuntime.start()
  runtimeInitialized = true
  updateHealthReporter.start()
  updateManager.startAutomaticChecks()
  registerDiagnosticsHandlers()
}

function registerRecoveryHandlers(): void {
  const ipcMain = createTrustedIpcRegistrar(
    electronIpcMain,
    requireTrustedRenderer,
  )
  const requireRecovery = () => {
    if (!persistedStateRecovery)
      throw new Error('Saved-data recovery is not active.')
    return persistedStateRecovery
  }
  const resume = () => {
    if (!prepareDatabase())
      throw new Error(
        persistedStateRecovery?.message ?? 'Saved data is still unavailable.',
      )
    startReadyRuntime()
    setImmediate(() => {
      for (const window of BrowserWindow.getAllWindows())
        window.webContents.reload()
    })
  }
  ipcMain.handle(
    IPC_CHANNELS.getPersistedStateRecovery,
    () => persistedStateRecovery,
  )
  ipcMain.handle(IPC_CHANNELS.openPersistedStateDataFolder, async () => {
    const error = await shell.openPath(requireRecovery().dataDirectory)
    if (error) throw new Error(error)
  })
  ipcMain.handle(IPC_CHANNELS.quitPersistedStateRecovery, () => {
    requireRecovery()
    app.quit()
  })
  ipcMain.handle(IPC_CHANNELS.restoreKnownGoodPersistedState, () => {
    restoreKnownGoodPersistedState(requireRecovery().databasePath)
    resume()
  })
  ipcMain.handle(IPC_CHANNELS.resetPersistedState, () => {
    resetPersistedState(requireRecovery().databasePath)
    resume()
  })
}

app.on('second-instance', () => {
  const window = BrowserWindow.getAllWindows().find(
    (candidate) => !candidate.isDestroyed(),
  )
  if (window) {
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  } else if (app.isReady() && !applicationRuntime.isShutdownComplete()) {
    applicationRuntime.ensureMainWindow()
  }
})

app.whenReady().then(() => {
  if (!hasInstanceLock) return
  Menu.setApplicationMenu(null)
  registerRecoveryHandlers()
  if (prepareDatabase()) startReadyRuntime()
  else windowManager.createMainWindow()

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
  if (!hasInstanceLock) return
  if (applicationRuntime.isShutdownComplete()) {
    return
  }

  event.preventDefault()
  void applicationRuntime.shutdown().finally(() => app.quit())
})

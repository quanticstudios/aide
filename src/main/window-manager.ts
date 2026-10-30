import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  WebContents,
} from 'electron'

import { IPC_CHANNELS } from '../shared/ipc'
import { isAllowedPreviewUrl } from '../shared/preview'
import type { WorkspaceWindowContext } from '../shared/workspace-window'
import { mapInputToShortcutEvent } from './app-shortcuts'

const PREVIEW_PARTITION = 'persist:aide-preview'

export interface WindowManagerDependencies {
  createBrowserWindow: (
    options: BrowserWindowConstructorOptions,
  ) => BrowserWindow
  fromWebContents: (webContents: WebContents) => BrowserWindow | null
  getAllWindows: () => BrowserWindow[]
  loadRendererUrl?: string
  mainPreloadPath: string
  rendererHtmlPath: string
  setTimeout: typeof setTimeout
}

export class WindowManager {
  private mainWindow: BrowserWindow | null = null
  private readonly windowContexts = new Map<
    BrowserWindow,
    WorkspaceWindowContext
  >()

  constructor(private readonly dependencies: WindowManagerDependencies) {}

  broadcast(channel: string, payload: unknown): void {
    for (const window of this.dependencies.getAllWindows()) {
      window.webContents.send(channel, payload)
    }
  }

  broadcastForWindowContext(
    channel: string,
    createPayload: (context: WorkspaceWindowContext) => unknown | undefined,
  ): void {
    for (const [window, context] of this.windowContexts) {
      const payload = createPayload(context)

      if (!window.isDestroyed() && payload !== undefined) {
        window.webContents.send(channel, payload)
      }
    }
  }

  createMainWindow(): BrowserWindow {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.focusWindow(this.mainWindow)
      return this.mainWindow
    }

    const window = this.dependencies.createBrowserWindow({
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
        preload: this.dependencies.mainPreloadPath,
        webviewTag: true,
      },
    })

    this.mainWindow = window
    const handleClosed = this.registerWindow(window, {
      kind: 'main',
      windowId: null,
      workspaceId: null,
    })
    this.configureWindow(window, undefined, handleClosed)
    this.loadRenderer(window)

    return window
  }

  createWorkspaceWindow(
    context: Extract<WorkspaceWindowContext, { kind: 'workspace' }>,
    onClosed: () => void,
  ): void {
    const window = this.dependencies.createBrowserWindow({
      autoHideMenuBar: true,
      width: 1280,
      height: 820,
      minWidth: 900,
      minHeight: 600,
      show: false,
      backgroundColor: '#18181b',
      title: 'aide',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: this.dependencies.mainPreloadPath,
        webviewTag: true,
      },
    })

    const handleClosed = this.registerWindow(window, context, onClosed)
    this.configureWindow(window, context, handleClosed)
    this.loadRenderer(window, context)
  }

  getWindowContext(webContents: WebContents): WorkspaceWindowContext | null {
    const window = this.getWindowForWebContents(webContents)
    return window ? (this.windowContexts.get(window) ?? null) : null
  }

  focusWorkspaceWindow(windowId: string): boolean {
    for (const [window, context] of this.windowContexts) {
      if (context.kind === 'workspace' && context.windowId === windowId) {
        return this.focusWindow(window)
      }
    }

    return false
  }

  private registerWindow(
    window: BrowserWindow,
    context: WorkspaceWindowContext,
    onClosed?: () => void,
  ): () => void {
    let didClose = false
    const handleClosed = () => {
      if (didClose) {
        return
      }

      didClose = true
      this.windowContexts.delete(window)
      if (this.mainWindow === window) {
        this.mainWindow = null
      }
      onClosed?.()
    }

    this.windowContexts.set(window, context)
    window.once('closed', handleClosed)
    return handleClosed
  }

  private configureWindow(
    window: BrowserWindow,
    context?: Extract<WorkspaceWindowContext, { kind: 'workspace' }>,
    onClosed?: () => void,
  ): void {
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

        delete params.preload
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
      (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
        console.error('Renderer failed to load', errorCode, errorDescription)

        if (!window.isVisible()) {
          window.show()
        }

        if (
          context &&
          isMainFrame === true &&
          this.isFatalMainFrameLoadFailure(errorCode)
        ) {
          this.repairFailedWorkspaceWindow(window, onClosed)
        }
      },
    )

    window.webContents.on('render-process-gone', (_event, details) => {
      console.error('Renderer process exited', details)

      if (context) {
        this.repairFailedWorkspaceWindow(window, onClosed)
      }
    })

    this.dependencies.setTimeout(revealWindow, 1500)
  }

  private isFatalMainFrameLoadFailure(errorCode: number): boolean {
    return errorCode !== -3
  }

  private repairFailedWorkspaceWindow(
    window: BrowserWindow,
    onClosed: (() => void) | undefined,
  ): void {
    if (!this.windowContexts.has(window)) {
      return
    }

    if (!window.isDestroyed()) {
      window.destroy()
    }

    onClosed?.()
  }

  private loadRenderer(
    window: BrowserWindow,
    context?: Extract<WorkspaceWindowContext, { kind: 'workspace' }>,
  ): void {
    if (this.dependencies.loadRendererUrl) {
      if (!context) {
        void window.loadURL(this.dependencies.loadRendererUrl)
        return
      }

      const rendererUrl = new URL(this.dependencies.loadRendererUrl)
      rendererUrl.searchParams.set('aideWindowId', context.windowId)
      rendererUrl.searchParams.set('aideWorkspaceId', context.workspaceId)
      void window.loadURL(rendererUrl.toString())
      return
    }

    if (!context) {
      void window.loadFile(this.dependencies.rendererHtmlPath)
      return
    }

    void window.loadFile(this.dependencies.rendererHtmlPath, {
      query: {
        aideWindowId: context.windowId,
        aideWorkspaceId: context.workspaceId,
      },
    })
  }

  private focusWindow(window: BrowserWindow): boolean {
    if (window.isDestroyed()) {
      return false
    }

    if (window.isMinimized()) {
      window.restore()
    }
    if (!window.isVisible()) {
      window.show()
    }
    window.focus()
    return true
  }

  getWindowForWebContents(webContents: WebContents): BrowserWindow | null {
    return this.dependencies.fromWebContents(webContents)
  }

  hasWindows(): boolean {
    return this.dependencies.getAllWindows().length > 0
  }
}

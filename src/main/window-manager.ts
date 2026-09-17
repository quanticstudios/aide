import type {
  BrowserWindow,
  BrowserWindowConstructorOptions,
  WebContents,
} from 'electron'

import { IPC_CHANNELS } from '../shared/ipc'
import { isAllowedPreviewUrl } from '../shared/preview'
import { mapInputToShortcutEvent } from './app-shortcuts'
import { isTrustedRendererUrl } from './trusted-renderer'

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
  constructor(private readonly dependencies: WindowManagerDependencies) {}

  broadcast(channel: string, payload: unknown): void {
    for (const window of this.dependencies.getAllWindows()) {
      window.webContents.send(channel, payload)
    }
  }

  createMainWindow(): BrowserWindow {
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
        sandbox: true,
        webSecurity: true,
        webviewTag: true,
      },
    })

    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.session.setPermissionRequestHandler(
      (_webContents, _permission, callback) => callback(false),
    )
    const preventUntrustedNavigation = (
      event: { preventDefault: () => void },
      url: string,
    ) => {
      if (
        !isTrustedRendererUrl(url, {
          loadRendererUrl: this.dependencies.loadRendererUrl,
          rendererHtmlPath: this.dependencies.rendererHtmlPath,
        })
      ) {
        event.preventDefault()
      }
    }
    window.webContents.on('will-navigate', preventUntrustedNavigation)
    window.webContents.on('will-redirect', preventUntrustedNavigation)

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
      (_event, errorCode, errorDescription) => {
        console.error('Renderer failed to load', errorCode, errorDescription)

        if (!window.isVisible()) {
          window.show()
        }
      },
    )

    this.dependencies.setTimeout(revealWindow, 1500)

    if (this.dependencies.loadRendererUrl) {
      void window.loadURL(this.dependencies.loadRendererUrl)
    } else {
      void window.loadFile(this.dependencies.rendererHtmlPath)
    }

    return window
  }

  getWindowForWebContents(webContents: WebContents): BrowserWindow | null {
    return this.dependencies.fromWebContents(webContents)
  }

  hasWindows(): boolean {
    return this.dependencies.getAllWindows().length > 0
  }
}

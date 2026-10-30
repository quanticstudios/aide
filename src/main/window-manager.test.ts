import type { BrowserWindow, WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'

import { WindowManager } from './window-manager'

type Listener = (...args: unknown[]) => void

function createWindow() {
  const handlers = new Map<string, Listener>()
  const onceHandlers = new Map<string, Listener>()
  const webContents = {
    on: vi.fn((event: string, handler: Listener) => {
      handlers.set(event, handler)
    }),
    once: vi.fn((event: string, handler: Listener) => {
      onceHandlers.set(event, handler)
    }),
    send: vi.fn(),
    setWindowOpenHandler: vi.fn(),
  }
  const window = {
    destroy: vi.fn(),
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isMinimized: vi.fn(() => false),
    isVisible: vi.fn(() => false),
    loadFile: vi.fn(),
    loadURL: vi.fn(),
    once: vi.fn((event: string, handler: Listener) => {
      onceHandlers.set(event, handler)
    }),
    show: vi.fn(),
    restore: vi.fn(),
    webContents,
  }

  return { handlers, onceHandlers, webContents, window }
}

function asBrowserWindow(window: ReturnType<typeof createWindow>['window']) {
  return window as unknown as BrowserWindow
}

function asTimer(setTimer: ReturnType<typeof vi.fn>): typeof setTimeout {
  return setTimer as unknown as typeof setTimeout
}

describe('WindowManager', () => {
  it('creates the existing secure single main window and loads the renderer URL', () => {
    const created = createWindow()
    const browserWindow = asBrowserWindow(created.window)
    const setTimer = vi.fn()
    const createBrowserWindow = vi.fn(() => browserWindow)
    const manager = new WindowManager({
      createBrowserWindow,
      fromWebContents: vi.fn(),
      getAllWindows: () => [browserWindow],
      loadRendererUrl: 'http://localhost:5173',
      mainPreloadPath: '/app/preload/index.js',
      rendererHtmlPath: '/app/renderer/index.html',
      setTimeout: asTimer(setTimer),
    })

    manager.createMainWindow()

    expect(createBrowserWindow).toHaveBeenCalledWith({
      autoHideMenuBar: true,
      backgroundColor: '#18181b',
      height: 920,
      minHeight: 720,
      minWidth: 1100,
      show: false,
      title: 'aide',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: '/app/preload/index.js',
        webviewTag: true,
      },
      width: 1440,
    })
    expect(created.window.loadURL).toHaveBeenCalledWith('http://localhost:5173')
  })

  it('rejects untrusted webviews before they attach', () => {
    const created = createWindow()
    const browserWindow = asBrowserWindow(created.window)
    const setTimer = vi.fn()
    const manager = new WindowManager({
      createBrowserWindow: vi.fn(() => browserWindow),
      fromWebContents: vi.fn(),
      getAllWindows: () => [browserWindow],
      mainPreloadPath: '/app/preload/index.js',
      rendererHtmlPath: '/app/renderer/index.html',
      setTimeout: asTimer(setTimer),
    })
    const event = { preventDefault: vi.fn() }

    manager.createMainWindow()
    created.handlers.get('will-attach-webview')?.(
      event,
      {},
      { src: 'https://example.com', partition: 'persist:aide-preview' },
    )

    expect(event.preventDefault).toHaveBeenCalledOnce()
  })

  it('strips preload access and forces the isolated preview partition', () => {
    const created = createWindow()
    const browserWindow = asBrowserWindow(created.window)
    const manager = new WindowManager({
      createBrowserWindow: vi.fn(() => browserWindow),
      fromWebContents: vi.fn(),
      getAllWindows: () => [browserWindow],
      mainPreloadPath: '/app/preload/index.js',
      rendererHtmlPath: '/app/renderer/index.html',
      setTimeout: asTimer(vi.fn()),
    })
    const event = { preventDefault: vi.fn() }
    const webPreferences = { preload: '/tmp/untrusted-preload.js' }
    const params = {
      preload: '/tmp/untrusted-preload.js',
      src: 'http://127.0.0.1:4173',
    }

    manager.createMainWindow()
    created.handlers.get('will-attach-webview')?.(event, webPreferences, params)

    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(params).toMatchObject({
      allowpopups: 'false',
      partition: 'persist:aide-preview',
    })
    expect(params).not.toHaveProperty('preload')
    expect(webPreferences).toEqual({
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    })
  })

  it('denies guest popups, permissions, and external navigation', () => {
    const created = createWindow()
    const browserWindow = asBrowserWindow(created.window)
    const manager = new WindowManager({
      createBrowserWindow: vi.fn(() => browserWindow),
      fromWebContents: vi.fn(),
      getAllWindows: () => [browserWindow],
      mainPreloadPath: '/app/preload/index.js',
      rendererHtmlPath: '/app/renderer/index.html',
      setTimeout: asTimer(vi.fn()),
    })
    const guestHandlers = new Map<string, Listener>()
    const setPermissionRequestHandler = vi.fn()
    const setWindowOpenHandler = vi.fn()
    const guest = {
      on: vi.fn((event: string, handler: Listener) => {
        guestHandlers.set(event, handler)
      }),
      session: { setPermissionRequestHandler },
      setWindowOpenHandler,
    }

    manager.createMainWindow()
    created.handlers.get('did-attach-webview')?.({}, guest)

    expect(setWindowOpenHandler.mock.calls[0]?.[0]()).toEqual({
      action: 'deny',
    })
    const permissionCallback = vi.fn()
    setPermissionRequestHandler.mock.calls[0]?.[0](
      guest,
      'notifications',
      permissionCallback,
    )
    expect(permissionCallback).toHaveBeenCalledWith(false)

    const externalNavigation = { preventDefault: vi.fn() }
    guestHandlers.get('will-navigate')?.(
      externalNavigation,
      'https://example.com',
    )
    expect(externalNavigation.preventDefault).toHaveBeenCalledOnce()

    const loopbackNavigation = { preventDefault: vi.fn() }
    guestHandlers.get('will-redirect')?.(
      loopbackNavigation,
      'http://localhost:4173/next',
    )
    expect(loopbackNavigation.preventDefault).not.toHaveBeenCalled()
  })

  it('forwards only shell-level shortcuts to the renderer', () => {
    const created = createWindow()
    const browserWindow = asBrowserWindow(created.window)
    const manager = new WindowManager({
      createBrowserWindow: vi.fn(() => browserWindow),
      fromWebContents: vi.fn(),
      getAllWindows: () => [browserWindow],
      mainPreloadPath: '/app/preload/index.js',
      rendererHtmlPath: '/app/renderer/index.html',
      setTimeout: asTimer(vi.fn()),
    })

    manager.createMainWindow()
    const handledEvent = { preventDefault: vi.fn() }
    created.handlers.get('before-input-event')?.(handledEvent, {
      alt: false,
      code: 'Tab',
      control: true,
      key: 'Tab',
      meta: false,
    })

    expect(handledEvent.preventDefault).toHaveBeenCalledOnce()
    expect(created.webContents.send).toHaveBeenCalledWith('app:shortcut', {
      type: 'overview-open',
    })

    const unhandledEvent = { preventDefault: vi.fn() }
    created.handlers.get('before-input-event')?.(unhandledEvent, {
      alt: true,
      code: 'ArrowDown',
      control: false,
      key: 'ArrowDown',
      meta: false,
    })
    expect(unhandledEvent.preventDefault).not.toHaveBeenCalled()
    expect(created.webContents.send).toHaveBeenCalledTimes(1)
  })

  it('broadcasts only through windows it owns', () => {
    const first = createWindow()
    const second = createWindow()
    const firstWindow = asBrowserWindow(first.window)
    const secondWindow = asBrowserWindow(second.window)
    const setTimer = vi.fn()
    const manager = new WindowManager({
      createBrowserWindow: vi.fn(),
      fromWebContents: vi.fn(),
      getAllWindows: () => [firstWindow, secondWindow],
      mainPreloadPath: '/app/preload/index.js',
      rendererHtmlPath: '/app/renderer/index.html',
      setTimeout: asTimer(setTimer),
    })

    manager.broadcast('aide:event', { revision: 1 })

    expect(first.webContents.send).toHaveBeenCalledWith('aide:event', {
      revision: 1,
    })
    expect(second.webContents.send).toHaveBeenCalledWith('aide:event', {
      revision: 1,
    })
  })

  it('omits workspace-scoped events for unauthorized window contexts', () => {
    const main = createWindow()
    const dedicated = createWindow()
    const mainWindow = asBrowserWindow(main.window)
    const dedicatedWindow = asBrowserWindow(dedicated.window)
    const manager = new WindowManager({
      createBrowserWindow: vi
        .fn(() => mainWindow)
        .mockReturnValueOnce(mainWindow)
        .mockReturnValueOnce(dedicatedWindow),
      fromWebContents: vi.fn(),
      getAllWindows: () => [mainWindow, dedicatedWindow],
      mainPreloadPath: '/app/preload/index.js',
      rendererHtmlPath: '/app/renderer/index.html',
      setTimeout: asTimer(vi.fn()),
    })

    manager.createMainWindow()
    manager.createWorkspaceWindow(
      {
        kind: 'workspace',
        windowId: 'workspace-window-1',
        workspaceId: 'workspace-1',
      },
      vi.fn(),
    )
    manager.broadcastForWindowContext('aide:event', (context) =>
      context.kind === 'workspace' && context.workspaceId === 'workspace-1'
        ? { workspaceId: context.workspaceId }
        : undefined,
    )

    expect(main.webContents.send).not.toHaveBeenCalled()
    expect(dedicated.webContents.send).toHaveBeenCalledWith('aide:event', {
      workspaceId: 'workspace-1',
    })
  })

  it('loads a detached workspace with main-controlled context and focuses its existing owner', () => {
    const created = createWindow()
    const browserWindow = asBrowserWindow(created.window)
    const onClosed = vi.fn()
    const manager = new WindowManager({
      createBrowserWindow: vi.fn(() => browserWindow),
      fromWebContents: vi.fn(() => browserWindow),
      getAllWindows: () => [browserWindow],
      loadRendererUrl: 'http://localhost:5173',
      mainPreloadPath: '/app/preload/index.js',
      rendererHtmlPath: '/app/renderer/index.html',
      setTimeout: asTimer(vi.fn()),
    })

    manager.createWorkspaceWindow(
      {
        kind: 'workspace',
        windowId: 'workspace-window-1',
        workspaceId: 'workspace-1',
      },
      onClosed,
    )

    expect(created.window.loadURL).toHaveBeenCalledWith(
      'http://localhost:5173/?aideWindowId=workspace-window-1&aideWorkspaceId=workspace-1',
    )
    expect(
      manager.getWindowContext(created.webContents as unknown as WebContents),
    ).toEqual({
      kind: 'workspace',
      windowId: 'workspace-window-1',
      workspaceId: 'workspace-1',
    })

    created.window.isMinimized.mockReturnValueOnce(true)
    expect(manager.focusWorkspaceWindow('workspace-window-1')).toBe(true)
    expect(created.window.restore).toHaveBeenCalledOnce()
    expect(created.window.show).toHaveBeenCalledOnce()
    expect(created.window.focus).toHaveBeenCalledOnce()

    created.onceHandlers.get('closed')?.()
    expect(onClosed).toHaveBeenCalledOnce()
    expect(manager.focusWorkspaceWindow('workspace-window-1')).toBe(false)
  })

  it('repairs a crashed dedicated renderer once without closing the main window on load failures', () => {
    const dedicated = createWindow()
    const main = createWindow()
    const dedicatedWindow = asBrowserWindow(dedicated.window)
    const mainWindow = asBrowserWindow(main.window)
    const onClosed = vi.fn()
    const manager = new WindowManager({
      createBrowserWindow: vi
        .fn(() => dedicatedWindow)
        .mockReturnValueOnce(dedicatedWindow)
        .mockReturnValueOnce(mainWindow),
      fromWebContents: vi.fn(),
      getAllWindows: () => [dedicatedWindow, mainWindow],
      mainPreloadPath: '/app/preload/index.js',
      rendererHtmlPath: '/app/renderer/index.html',
      setTimeout: asTimer(vi.fn()),
    })

    manager.createWorkspaceWindow(
      {
        kind: 'workspace',
        windowId: 'workspace-window-1',
        workspaceId: 'workspace-1',
      },
      onClosed,
    )
    dedicated.handlers.get('did-fail-load')?.({}, -3, 'ERR_ABORTED', '', true)
    expect(dedicated.window.destroy).not.toHaveBeenCalled()

    dedicated.handlers.get('render-process-gone')?.({}, { reason: 'crashed' })
    dedicated.handlers.get('render-process-gone')?.({}, { reason: 'crashed' })

    expect(dedicated.window.destroy).toHaveBeenCalledOnce()
    expect(onClosed).toHaveBeenCalledOnce()

    manager.createMainWindow()
    main.handlers.get('did-fail-load')?.({}, -2, 'ERR_FAILED', '', true)
    expect(main.window.destroy).not.toHaveBeenCalled()
  })

  it('repairs all fatal dedicated main-frame load failures but ignores benign aborts and subframes', () => {
    const created = createWindow()
    const browserWindow = asBrowserWindow(created.window)
    const onClosed = vi.fn()
    const manager = new WindowManager({
      createBrowserWindow: vi.fn(() => browserWindow),
      fromWebContents: vi.fn(),
      getAllWindows: () => [browserWindow],
      mainPreloadPath: '/app/preload/index.js',
      rendererHtmlPath: '/app/renderer/index.html',
      setTimeout: asTimer(vi.fn()),
    })

    manager.createWorkspaceWindow(
      {
        kind: 'workspace',
        windowId: 'workspace-window-1',
        workspaceId: 'workspace-1',
      },
      onClosed,
    )
    created.handlers.get('did-fail-load')?.(
      {},
      -102,
      'ERR_CONNECTION_REFUSED',
      '',
      false,
    )
    created.handlers.get('did-fail-load')?.({}, -3, 'ERR_ABORTED', '', true)

    expect(created.window.destroy).not.toHaveBeenCalled()
    expect(onClosed).not.toHaveBeenCalled()

    created.handlers.get('did-fail-load')?.(
      {},
      -102,
      'ERR_CONNECTION_REFUSED',
      '',
      true,
    )

    expect(created.window.destroy).toHaveBeenCalledOnce()
    expect(onClosed).toHaveBeenCalledOnce()
  })
})

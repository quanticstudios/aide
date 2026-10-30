import type { BrowserWindow } from 'electron'
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
    getURL: vi.fn(() => 'file:///app/renderer/index.html'),
    session: { setPermissionRequestHandler: vi.fn() },
    setWindowOpenHandler: vi.fn(),
  }
  const window = {
    focus: vi.fn(),
    isDestroyed: vi.fn(() => false),
    isVisible: vi.fn(() => false),
    loadFile: vi.fn(),
    loadURL: vi.fn(),
    once: vi.fn((event: string, handler: Listener) => {
      onceHandlers.set(event, handler)
    }),
    show: vi.fn(),
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
      openExternal: vi.fn(),
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
      title: 'aIDE',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        preload: '/app/preload/index.js',
        sandbox: true,
        webSecurity: true,
        webviewTag: true,
      },
      width: 1440,
    })
    expect(created.window.loadURL).toHaveBeenCalledWith('http://localhost:5173')
  })

  it('denies main-window popups, permissions, and untrusted navigation', () => {
    const openExternal = vi.fn()
    const created = createWindow()
    const browserWindow = asBrowserWindow(created.window)
    const manager = new WindowManager({
      createBrowserWindow: vi.fn(() => browserWindow),
      fromWebContents: vi.fn(),
      getAllWindows: () => [browserWindow],
      mainPreloadPath: '/app/preload/index.js',
      openExternal,
      rendererHtmlPath: '/app/renderer/index.html',
      setTimeout: asTimer(vi.fn()),
    })

    manager.createMainWindow()

    expect(
      created.webContents.setWindowOpenHandler.mock.calls[0]?.[0]({
        url: 'https://example.com/popup',
      }),
    ).toEqual({ action: 'deny' })
    expect(openExternal).toHaveBeenCalledWith('https://example.com/popup')
    const permissionCallback = vi.fn()
    created.webContents.session.setPermissionRequestHandler.mock.calls[0]?.[0](
      created.webContents,
      'notifications',
      permissionCallback,
    )
    expect(permissionCallback).toHaveBeenCalledWith(false)

    const clipboardCallback = vi.fn()
    created.webContents.session.setPermissionRequestHandler.mock.calls[0]?.[0](
      created.webContents,
      'clipboard-sanitized-write',
      clipboardCallback,
    )
    expect(clipboardCallback).toHaveBeenCalledWith(true)

    created.webContents.getURL.mockReturnValueOnce('https://example.com')
    const untrustedClipboardCallback = vi.fn()
    created.webContents.session.setPermissionRequestHandler.mock.calls[0]?.[0](
      created.webContents,
      'clipboard-sanitized-write',
      untrustedClipboardCallback,
    )
    expect(untrustedClipboardCallback).toHaveBeenCalledWith(false)

    const externalNavigation = { preventDefault: vi.fn() }
    created.handlers.get('will-navigate')?.(
      externalNavigation,
      'https://example.com',
    )
    expect(externalNavigation.preventDefault).toHaveBeenCalledOnce()
    expect(openExternal).toHaveBeenLastCalledWith('https://example.com')

    const trustedLinkNavigation = { preventDefault: vi.fn() }
    created.handlers.get('will-navigate')?.(
      trustedLinkNavigation,
      'file:///app/renderer/index.html#settings',
    )
    expect(trustedLinkNavigation.preventDefault).not.toHaveBeenCalled()
    expect(openExternal).toHaveBeenCalledTimes(2)

    const trustedNavigation = { preventDefault: vi.fn() }
    created.handlers.get('will-redirect')?.(
      trustedNavigation,
      'file:///app/renderer/index.html#settings',
    )
    expect(trustedNavigation.preventDefault).not.toHaveBeenCalled()
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
      openExternal: vi.fn(),
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
      openExternal: vi.fn(),
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
      openExternal: vi.fn(),
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
      openExternal: vi.fn(),
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
    for (const type of ['keyDown', 'keyUp']) {
      created.handlers.get('before-input-event')?.(handledEvent, {
        type,
        alt: false,
        control: true,
        key: 'b',
        meta: false,
      })
    }
    expect(created.webContents.send).toHaveBeenCalledTimes(2)
    expect(created.webContents.send).toHaveBeenLastCalledWith('app:shortcut', {
      type: 'sidebar-toggle',
    })
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
      openExternal: vi.fn(),
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
})

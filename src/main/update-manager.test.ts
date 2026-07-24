import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { tmpdir } from 'node:os'

import { describe, expect, it, vi } from 'vitest'

import type { UpdatePhase } from '../shared/update'
import { UpdateManager, type UpdateProvider } from './update-manager'

class FakeUpdateProvider implements UpdateProvider {
  public autoDownload = false
  public checkCount = 0
  public downloadCount = 0
  private readonly listeners = new Map<
    string,
    Set<(payload?: unknown) => void>
  >()

  public on(event: string, listener: (payload?: unknown) => void): void {
    const listeners = this.listeners.get(event) ?? new Set()
    listeners.add(listener)
    this.listeners.set(event, listeners)
  }

  public async checkForUpdates(): Promise<void> {
    this.checkCount += 1
  }

  public async downloadUpdate(): Promise<void> {
    this.downloadCount += 1
  }

  public emit(event: string, payload?: unknown): void {
    for (const listener of this.listeners.get(event) ?? []) {
      listener(payload)
    }
  }
}

function createManager(
  overrides: Partial<ConstructorParameters<typeof UpdateManager>[0]> = {},
) {
  const provider = new FakeUpdateProvider()
  const updates: UpdatePhase[] = []
  const manager = new UpdateManager({
    app: {
      getVersion: () => '0.1.0',
      isPackaged: true,
    },
    appImagePath: '/tmp/Aide.AppImage',
    createProvider: () => provider,
    isAppImagePath: () => true,
    onUpdate: (event) => updates.push(event.snapshot.phase),
    platform: 'linux',
    ...overrides,
  })

  return { manager, provider, updates }
}

describe('UpdateManager', () => {
  it('never creates an updater for development or manual-only installs', () => {
    const development = createManager({
      app: { getVersion: () => '0.1.0', isPackaged: false },
    })
    const manual = createManager({ appImagePath: '' })

    expect(development.manager.getSnapshot()).toMatchObject({
      capability: 'development',
      phase: 'unsupported',
    })
    expect(manual.manager.getSnapshot()).toMatchObject({
      capability: 'manual-only',
      phase: 'unsupported',
    })
    void development.manager.checkForUpdates()
    void manual.manager.checkForUpdates()
    expect(development.provider.checkCount).toBe(0)
    expect(manual.provider.checkCount).toBe(0)
  })

  it('does not schedule automatic checks for unsupported installations', () => {
    const setTimeout = vi.fn()
    const { manager } = createManager({
      app: { getVersion: () => '0.1.0', isPackaged: false },
      setTimeout: setTimeout as unknown as typeof globalThis.setTimeout,
    })

    manager.startAutomaticChecks()

    expect(setTimeout).not.toHaveBeenCalled()
  })

  it('requires an absolute regular AppImage path before enabling Linux updates', () => {
    const isAppImagePath = vi.fn(() => false)
    const missing = createManager({
      appImagePath: '/tmp/not-an-appimage',
      isAppImagePath,
    })
    const relative = createManager({
      appImagePath: 'Aide.AppImage',
      isAppImagePath,
    })

    expect(missing.manager.getSnapshot().capability).toBe('manual-only')
    expect(relative.manager.getSnapshot().capability).toBe('manual-only')
    expect(isAppImagePath).toHaveBeenCalledTimes(1)
  })

  it('requires a writable, ELF-shaped AppImage file and supports macOS packages', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'aide-update-'))
    const appImagePath = path.join(directory, 'Aide.AppImage')

    try {
      writeFileSync(appImagePath, 'not an appimage')
      const invalid = new UpdateManager({
        app: { getVersion: () => '0.1.0', isPackaged: true },
        appImagePath,
        platform: 'linux',
      })
      writeFileSync(appImagePath, Buffer.from([0x7f, 0x45, 0x4c, 0x46]))
      const ordinaryElf = new UpdateManager({
        app: { getVersion: () => '0.1.0', isPackaged: true },
        appImagePath,
        platform: 'linux',
      })
      writeFileSync(
        appImagePath,
        Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0, 0x41, 0x49, 0x02]),
      )
      const valid = new UpdateManager({
        app: { getVersion: () => '0.1.0', isPackaged: true },
        appImagePath,
        platform: 'linux',
      })
      const mac = createManager({ appImagePath: '', platform: 'darwin' })

      expect(invalid.getSnapshot().capability).toBe('manual-only')
      expect(ordinaryElf.getSnapshot().capability).toBe('manual-only')
      expect(valid.getSnapshot().capability).toBe('supported')
      expect(mac.manager.getSnapshot().capability).toBe('supported')
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('publishes a complete snapshot for subscribers and stops after unsubscribe', async () => {
    const { manager, provider } = createManager({
      automaticDownloads: false,
    })
    const events: Array<{ revision: number; phase: UpdatePhase }> = []
    const unsubscribe = manager.subscribe((event) => {
      events.push({ revision: event.revision, phase: event.snapshot.phase })
    })

    await manager.checkForUpdates()
    provider.emit('update-not-available')
    unsubscribe()
    provider.emit('checking-for-update')

    expect(events).toEqual([
      { phase: 'checking', revision: 1 },
      { phase: 'idle', revision: 2 },
    ])
  })

  it('serializes repeated checks and publishes full monotonic snapshots', async () => {
    const { manager, provider, updates } = createManager({
      automaticDownloads: false,
    })
    const events: number[] = []
    manager.subscribe((event) => events.push(event.revision))

    const first = manager.checkForUpdates()
    const second = manager.checkForUpdates()
    expect(first).toBe(second)
    await first
    provider.emit('update-available', { version: '0.1.1' })

    expect(provider.checkCount).toBe(1)
    expect(manager.getSnapshot()).toMatchObject({
      phase: 'available',
      targetVersion: '0.1.1',
    })
    expect(events).toEqual([...events].sort((left, right) => left - right))
    expect(updates).toContain('checking')
    expect(updates).toContain('available')
  })

  it('starts exactly one automatic download by default and shares it with manual calls', async () => {
    const { manager, provider } = createManager()

    await manager.checkForUpdates()
    provider.emit('update-available', { version: '0.1.1' })
    const manual = manager.downloadUpdate()
    await manual

    expect(provider.downloadCount).toBe(1)
    expect(manager.getSnapshot()).toMatchObject({
      phase: 'downloading',
      targetVersion: '0.1.1',
    })
  })

  it('keeps a valid update available for manual download when disabled by preference', async () => {
    const { manager, provider } = createManager({
      automaticDownloads: false,
    })

    await manager.checkForUpdates()
    provider.emit('update-available', { version: '0.1.1' })

    expect(provider.downloadCount).toBe(0)
    expect(manager.getSnapshot()).toMatchObject({
      phase: 'available',
      targetVersion: '0.1.1',
    })
  })

  it('ignores late check events while a valid update is downloading or downloaded', async () => {
    const { manager, provider } = createManager({
      automaticDownloads: false,
    })

    await manager.checkForUpdates()
    provider.emit('update-available', { version: '0.1.1' })
    provider.emit('checking-for-update')
    await manager.downloadUpdate()
    provider.emit('update-not-available')

    expect(manager.getSnapshot()).toMatchObject({
      phase: 'downloading',
      targetVersion: '0.1.1',
    })
    expect(await manager.checkForUpdates()).toMatchObject({
      phase: 'downloading',
      targetVersion: '0.1.1',
    })
    expect(provider.checkCount).toBe(1)

    provider.emit('update-downloaded', { version: '0.1.1' })
    provider.emit('update-not-available')

    expect(manager.getSnapshot()).toMatchObject({
      phase: 'downloaded',
      targetVersion: '0.1.1',
    })
  })

  it('rejects prerelease, downgrade, and malformed update versions', async () => {
    const { manager, provider } = createManager({
      automaticDownloads: false,
    })

    await manager.checkForUpdates()
    provider.emit('update-available', { version: '0.1.1-beta.1' })
    expect(manager.getSnapshot()).toMatchObject({
      errorCode: 'invalid-update',
      phase: 'failed',
    })

    await manager.checkForUpdates()
    provider.emit('update-available', { version: '0.1.0' })
    expect(manager.getSnapshot()).toMatchObject({
      errorCode: 'invalid-update',
      phase: 'failed',
    })

    await manager.checkForUpdates()
    provider.emit('update-available', { version: 'not-a-version' })
    expect(manager.getSnapshot()).toMatchObject({
      errorCode: 'invalid-update',
      phase: 'failed',
    })
  })

  it('deduplicates downloads, clamps progress, and exposes safe errors only', async () => {
    const { manager, provider } = createManager({
      automaticDownloads: false,
    })
    await manager.checkForUpdates()
    provider.emit('update-available', { version: '0.1.1' })

    const first = manager.downloadUpdate()
    const second = manager.downloadUpdate()
    expect(first).toBe(second)
    await first
    provider.emit('download-progress', {
      percent: 140,
      total: -1,
      transferred: -2,
    })
    expect(manager.getSnapshot()).toMatchObject({
      phase: 'downloading',
      progress: { percent: 100, total: 0, transferred: 0 },
    })

    provider.emit(
      'error',
      new Error('https://token@example.com out of disk space'),
    )
    expect(manager.getSnapshot()).toMatchObject({
      errorCode: 'disk-space',
      phase: 'failed',
    })
    expect(JSON.stringify(manager.getSnapshot())).not.toContain('token')
    expect(provider.downloadCount).toBe(1)
  })

  it('ignores stale provider callbacks after it stops', async () => {
    const intervalHandle = {} as NodeJS.Timeout
    const timeoutHandle = {} as NodeJS.Timeout
    const clearInterval = vi.fn()
    const clearTimeout = vi.fn()
    const setInterval = vi.fn(() => intervalHandle)
    const setTimeout = vi.fn(() => timeoutHandle)
    const { manager, provider } = createManager({
      clearInterval:
        clearInterval as unknown as typeof globalThis.clearInterval,
      clearTimeout: clearTimeout as unknown as typeof globalThis.clearTimeout,
      setInterval: setInterval as unknown as typeof globalThis.setInterval,
      setTimeout: setTimeout as unknown as typeof globalThis.setTimeout,
    })
    await manager.checkForUpdates()
    manager.startAutomaticChecks()
    manager.startAutomaticChecks()
    expect(setTimeout).toHaveBeenCalledOnce()
    expect(setInterval).toHaveBeenCalledOnce()
    manager.stop()
    expect(clearTimeout).toHaveBeenCalledWith(timeoutHandle)
    expect(clearInterval).toHaveBeenCalledWith(intervalHandle)
    provider.emit('update-available', { version: '0.1.1' })

    expect(manager.getSnapshot().phase).toBe('checking')
  })
})

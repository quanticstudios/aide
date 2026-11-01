import { createHash, generateKeyPairSync, sign } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'
import { canonicalizeReleaseEnvelope } from '../shared/release-envelope'
import type { UpdatePhase } from '../shared/update'
import { ApplicationRuntime } from './application-runtime'
import { UpdateManager, type UpdateProvider } from './update-manager'
import { UpdateRestartCoordinator } from './update-restart-coordinator'

class FakeUpdateProvider implements UpdateProvider {
  public autoDownload = false
  public checkCount = 0
  public downloadCount = 0
  public readonly quitAndInstall = vi.fn()
  public readonly setFeedUrls: string[] = []
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

  public setFeedURL(options: { provider: 'generic'; url: string }): void {
    this.setFeedUrls.push(options.url)
  }
}

const TEST_ORIGIN = 'http://127.0.0.1:43123'

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function sha512(value: Buffer): string {
  return createHash('sha512').update(value).digest('hex')
}

function signedReleaseFixture(
  options: {
    arch?: 'arm64' | 'x64'
    invalidFeed?: boolean
    invalidSignature?: boolean
    mergedMacFeed?: boolean
    platform?: 'darwin' | 'linux'
    urgency?: 'critical' | 'normal'
  } = {},
) {
  const arch = options.arch ?? 'x64'
  const platform = options.platform ?? 'linux'
  const artifact = Buffer.from('verified update artifact')
  const artifactName =
    platform === 'linux'
      ? 'Aide-0.2.1-linux-x86_64.AppImage'
      : `Aide-0.2.1-mac-${arch}.zip`
  const otherMacEntry =
    platform === 'darwin' && options.mergedMacFeed
      ? [
          '  - url: Aide-0.2.1-mac-x64.zip',
          `    sha512: ${createHash('sha512').update(Buffer.from('other mac architecture')).digest('base64')}`,
          '    size: 22',
          '    blockMapSize: 10',
        ]
      : []
  const feedName = platform === 'linux' ? 'latest-linux.yml' : 'latest-mac.yml'
  const declaredArtifactName = options.invalidFeed
    ? 'unexpected.AppImage'
    : artifactName
  const feed = Buffer.from(
    [
      'version: 0.2.1',
      'files:',
      ...otherMacEntry,
      `  - url: ${declaredArtifactName}`,
      `    sha512: ${createHash('sha512').update(artifact).digest('base64')}`,
      `    size: ${artifact.byteLength}`,
      ...(platform === 'darwin' ? ['    blockMapSize: 11'] : []),
      `path: ${declaredArtifactName}`,
      `sha512: ${createHash('sha512').update(artifact).digest('base64')}`,
      'releaseDate: 1970-01-01T00:00:00.000Z',
      '',
    ].join('\n'),
  )
  const { privateKey, publicKey } = generateKeyPairSync('ed25519')
  const envelope = {
    arch,
    artifact: {
      sha256: sha256(artifact),
      sha512: sha512(artifact),
      size: artifact.byteLength,
      url: `${TEST_ORIGIN}/releases/v0.2.1/${artifactName}`,
    },
    channel: 'stable' as const,
    feed: {
      sha256: sha256(feed),
      url: `${TEST_ORIGIN}/releases/v0.2.1/${feedName}`,
    },
    keyId: 'test-2026-01',
    platform,
    productId: 'studio.quantic.aide' as const,
    publishedAt: '2026-07-24T00:00:00.000Z',
    revokedVersions: [],
    rolloutPercentage: 100 as const,
    schemaVersion: 1 as const,
    urgency: options.urgency ?? 'normal',
    version: '0.2.1',
  }
  const payload = canonicalizeReleaseEnvelope(envelope)
  const signature = sign(null, payload, privateKey)
  if (options.invalidSignature) signature[0] ^= 1
  const files = new Map<string, Buffer>([
    [
      `${TEST_ORIGIN}/channels/stable/${platform}/${arch}/release-envelope.json`,
      payload,
    ],
    [
      `${TEST_ORIGIN}/channels/stable/${platform}/${arch}/release-envelope.sig`,
      signature,
    ],
    [`${TEST_ORIGIN}/releases/v0.2.1/${feedName}`, feed],
    [`${TEST_ORIGIN}/releases/v0.2.1/${artifactName}`, artifact],
  ])
  return {
    artifact,
    fetch: vi.fn(async (input: URL | RequestInfo) => {
      const bytes = files.get(String(input))
      return new Response(bytes ? new Uint8Array(bytes) : null, {
        headers: bytes ? { 'content-length': String(bytes.byteLength) } : {},
        status: bytes ? 200 : 404,
      })
    }) as unknown as typeof globalThis.fetch,
    keyring: {
      'test-2026-01': publicKey
        .export({ format: 'pem', type: 'spki' })
        .toString(),
    },
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
  it('records only fixed consented lifecycle events', async () => {
    const healthEvents: unknown[] = []
    const scheduleUpload = vi.fn(() => Promise.reject(new Error('offline')))
    const state = {
      automaticDownloads: false,
      healthDisclosureAcknowledged: true,
      healthReportingEnabled: true,
      installationId: 'installation-1',
      lastCheckedAt: null,
      pendingAttemptId: null,
      pendingTargetVersion: null,
      snoozedUntil: null,
    }
    const { manager, provider } = createManager({
      now: () => new Date('2026-07-24T12:00:42.987Z'),
      onUpdateHealthEventQueued: scheduleUpload,
      store: {
        appendUpdateHealthEvent: (event) => healthEvents.push(event),
        getUpdateState: () => state,
        updateUpdateState: () => state,
      },
    })

    await manager.checkForUpdates()
    provider.emit('update-available', { version: '0.2.1' })
    await manager.downloadUpdate()
    provider.emit('error', new Error('network unavailable'))

    expect(healthEvents).toMatchObject([
      {
        createdAt: '2026-07-24T12:00:00.000Z',
        durationMs: null,
        lifecycle: 'check-started',
        targetVersion: null,
      },
      {
        createdAt: '2026-07-24T12:00:00.000Z',
        durationMs: null,
        lifecycle: 'download-started',
        targetVersion: '0.2.1',
      },
      {
        createdAt: '2026-07-24T12:00:00.000Z',
        durationMs: 1_000,
        errorCode: 'network',
        lifecycle: 'download-failed',
      },
    ])
    expect(JSON.stringify(healthEvents)).not.toContain('installation-1')
    expect(scheduleUpload).toHaveBeenCalledTimes(3)
    await Promise.resolve()
    expect(manager.getSnapshot().phase).toBe('failed')
  })

  it('schedules a flush only after the health event has been queued', async () => {
    const scheduleUpload = vi.fn()
    const { manager } = createManager({
      onUpdateHealthEventQueued: scheduleUpload,
      store: {
        appendUpdateHealthEvent: () => {
          throw new Error('database unavailable')
        },
        getUpdateState: () => ({
          automaticDownloads: false,
          healthDisclosureAcknowledged: true,
          healthReportingEnabled: true,
          installationId: 'installation-1',
          lastCheckedAt: null,
          pendingAttemptId: null,
          pendingTargetVersion: null,
          snoozedUntil: null,
        }),
        updateUpdateState: () => ({
          automaticDownloads: false,
          healthDisclosureAcknowledged: true,
          healthReportingEnabled: true,
          installationId: 'installation-1',
          lastCheckedAt: null,
          pendingAttemptId: null,
          pendingTargetVersion: null,
          snoozedUntil: null,
        }),
      },
    })

    await manager.checkForUpdates()

    expect(scheduleUpload).not.toHaveBeenCalled()
  })

  it('fails closed until a production release origin is supplied', () => {
    const { manager, provider } = createManager({ release: null })

    expect(manager.getSnapshot()).toMatchObject({
      capability: 'manual-only',
      phase: 'unsupported',
    })
    void manager.checkForUpdates()
    expect(provider.checkCount).toBe(0)
  })

  it('verifies the signed channel and metadata before calling the provider', async () => {
    const fixture = signedReleaseFixture()
    const store = {
      getUpdateState: () => ({
        automaticDownloads: true,
        healthDisclosureAcknowledged: false,
        healthReportingEnabled: true,
        installationId: 'installation-1',
        lastCheckedAt: null,
        pendingAttemptId: null,
        pendingTargetVersion: null,
        snoozedUntil: null,
      }),
      updateUpdateState: vi.fn(),
    }
    const { manager, provider } = createManager({
      release: {
        allowInsecureTestOrigin: true,
        fetch: fixture.fetch,
        keyring: fixture.keyring,
        origin: TEST_ORIGIN,
      },
      store,
    })

    await manager.checkForUpdates()

    expect(provider.checkCount).toBe(1)
    expect(provider.setFeedUrls).toHaveLength(1)
    expect(provider.setFeedUrls[0]).toMatch(/^http:\/\/127\.0\.0\.1:\d+\//)
    manager.stop()
  })

  it('never calls the provider for a bad signature or mismatched metadata', async () => {
    for (const fixture of [
      signedReleaseFixture({ invalidSignature: true }),
      signedReleaseFixture({ invalidFeed: true }),
    ]) {
      const { manager, provider } = createManager({
        release: {
          allowInsecureTestOrigin: true,
          fetch: fixture.fetch,
          keyring: fixture.keyring,
          origin: TEST_ORIGIN,
        },
      })

      await manager.checkForUpdates()

      expect(provider.checkCount).toBe(0)
      expect(manager.getSnapshot()).toMatchObject({ phase: 'failed' })
      manager.stop()
    }
  })

  it('synthesizes one loopback-only entry from a merged macOS feed', async () => {
    const fixture = signedReleaseFixture({
      arch: 'arm64',
      mergedMacFeed: true,
      platform: 'darwin',
    })
    const { manager, provider } = createManager({
      arch: 'arm64',
      platform: 'darwin',
      release: {
        allowInsecureTestOrigin: true,
        fetch: fixture.fetch,
        keyring: fixture.keyring,
        origin: TEST_ORIGIN,
      },
    })

    await manager.checkForUpdates()
    const served = await fetch(
      `${provider.setFeedUrls[0]}/latest-mac.yml?noCache=1abc`,
    ).then((response) => response.text())

    expect(served).toContain('/artifact')
    expect(served).not.toContain(TEST_ORIGIN)
    expect(served).not.toContain('Aide-0.2.1-mac-x64.zip')
    expect(served).not.toContain('Aide-0.2.1-mac-arm64.zip')
    expect(served.match(/^\s*- url:/gm) ?? []).toHaveLength(1)
    manager.stop()
  })

  it('streams only the signed artifact and blocks a replaced downloaded path', async () => {
    const fixture = signedReleaseFixture()
    const directory = mkdtempSync(path.join(tmpdir(), 'aide-downloaded-'))
    const downloadedFile = path.join(directory, 'Aide.AppImage')
    writeFileSync(downloadedFile, fixture.artifact)
    const { manager, provider } = createManager({
      automaticDownloads: false,
      release: {
        allowInsecureTestOrigin: true,
        fetch: fixture.fetch,
        keyring: fixture.keyring,
        origin: TEST_ORIGIN,
      },
    })

    try {
      await manager.checkForUpdates()
      const streamed = await fetch(`${provider.setFeedUrls[0]}/artifact`).then(
        (response) => response.arrayBuffer(),
      )
      expect(Buffer.from(streamed)).toEqual(fixture.artifact)

      provider.emit('update-available', { version: '0.2.1' })
      const download = manager.downloadUpdate()
      provider.emit('update-downloaded', {
        downloadedFile,
        version: '0.2.1',
      })
      await download
      expect(manager.getSnapshot()).toMatchObject({ phase: 'downloaded' })

      rmSync(downloadedFile)
      writeFileSync(downloadedFile, fixture.artifact)
      await expect(manager.releaseFileMatchesVerifiedIdentity()).resolves.toBe(
        false,
      )
    } finally {
      manager.stop()
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('invalidates a revoked or unreadable downloaded channel so a higher patch can recover', async () => {
    const fixture = signedReleaseFixture()
    const directory = mkdtempSync(path.join(tmpdir(), 'aide-revoked-'))
    const downloadedFile = path.join(directory, 'Aide.AppImage')
    writeFileSync(downloadedFile, fixture.artifact)
    let revoked = false
    const fetch = vi.fn(async (input: URL | RequestInfo) => {
      if (revoked) return new Response('revoked channel', { status: 200 })
      return fixture.fetch(input)
    })
    const { manager, provider } = createManager({
      automaticDownloads: false,
      release: {
        allowInsecureTestOrigin: true,
        fetch,
        keyring: fixture.keyring,
        origin: TEST_ORIGIN,
      },
    })
    try {
      await manager.checkForUpdates()
      provider.emit('update-available', { version: '0.2.1' })
      const download = manager.downloadUpdate()
      provider.emit('update-downloaded', { downloadedFile, version: '0.2.1' })
      await download
      revoked = true
      await expect(manager.revalidateDownloadedUpdate()).resolves.toBe(false)
      expect(manager.getSnapshot()).toMatchObject({
        errorCode: 'invalid-update',
        phase: 'failed',
        targetVersion: null,
      })
      revoked = false
      await manager.checkForUpdates()
      expect(provider.checkCount).toBe(2)
    } finally {
      manager.stop()
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('rejects an artifact whose bytes do not match its signed identity', async () => {
    const fixture = signedReleaseFixture()
    const directory = mkdtempSync(path.join(tmpdir(), 'aide-downloaded-'))
    const downloadedFile = path.join(directory, 'Aide.AppImage')
    writeFileSync(downloadedFile, 'tampered')
    const { manager, provider } = createManager({
      automaticDownloads: false,
      release: {
        allowInsecureTestOrigin: true,
        fetch: fixture.fetch,
        keyring: fixture.keyring,
        origin: TEST_ORIGIN,
      },
    })

    try {
      await manager.checkForUpdates()
      provider.emit('update-available', { version: '0.2.1' })
      const download = manager.downloadUpdate()
      provider.emit('update-downloaded', {
        downloadedFile,
        version: '0.2.1',
      })
      await download

      expect(manager.getSnapshot()).toMatchObject({
        errorCode: 'invalid-update',
        phase: 'failed',
      })
    } finally {
      manager.stop()
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('commits an install marker only after explicit verified restart preparation', async () => {
    const fixture = signedReleaseFixture()
    const directory = mkdtempSync(path.join(tmpdir(), 'aide-downloaded-'))
    const downloadedFile = path.join(directory, 'Aide.AppImage')
    writeFileSync(downloadedFile, fixture.artifact)
    const state = {
      automaticDownloads: false,
      healthDisclosureAcknowledged: false,
      healthReportingEnabled: true,
      installationId: 'installation-1',
      lastCheckedAt: null,
      pendingAttemptId: null,
      pendingTargetVersion: null,
      snoozedUntil: null,
    }
    const commitUpdateInstallStart = vi.fn((input) => {
      state.pendingAttemptId = input.attemptId
      state.pendingTargetVersion = input.targetVersion
      return state
    })
    const { manager, provider } = createManager({
      automaticDownloads: false,
      release: {
        allowInsecureTestOrigin: true,
        fetch: fixture.fetch,
        keyring: fixture.keyring,
        origin: TEST_ORIGIN,
      },
      store: {
        commitUpdateInstallStart,
        getUpdateState: () => state,
        updateUpdateState: vi.fn(() => state),
      },
    })

    try {
      await manager.checkForUpdates()
      provider.emit('update-available', { version: '0.2.1' })
      const download = manager.downloadUpdate()
      provider.emit('update-downloaded', { downloadedFile, version: '0.2.1' })
      await download

      expect(state).toMatchObject({
        pendingAttemptId: null,
        pendingTargetVersion: null,
      })
      manager.markInstallStarted()
      expect(commitUpdateInstallStart).toHaveBeenCalledOnce()
      expect(state.pendingAttemptId).toMatch(/^[0-9a-f-]+$/)
      expect(state.pendingTargetVersion).toBe('0.2.1')
    } finally {
      manager.stop()
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('installs a verified update through explicit shutdown while normal stop clears its identity', async () => {
    const fixture = signedReleaseFixture()
    const directory = mkdtempSync(path.join(tmpdir(), 'aide-downloaded-'))
    const downloadedFile = path.join(directory, 'Aide.AppImage')
    writeFileSync(downloadedFile, fixture.artifact)
    const { manager, provider } = createManager({
      automaticDownloads: false,
      release: {
        allowInsecureTestOrigin: true,
        fetch: fixture.fetch,
        keyring: fixture.keyring,
        origin: TEST_ORIGIN,
      },
    })
    const shutdownServices = vi.fn(async (reason) => {
      manager.stop({ preserveVerifiedDownload: reason === 'update-install' })
    })
    const applicationRuntime = new ApplicationRuntime({
      createMainWindow: vi.fn(),
      hasWindows: () => false,
      initializeServices: vi.fn(),
      registerIpcHandlers: vi.fn(),
      shutdownServices,
    })
    const release = vi.fn()
    const terminateAfterShutdownFailure = vi.fn()
    const coordinator = new UpdateRestartCoordinator({
      applicationRuntime,
      terminals: {
        beginQuiescing: () => release,
        getActiveSessionCount: () => 0,
      },
      terminateAfterShutdownFailure,
      updates: manager,
      workspaceSetups: {
        beginQuiescing: () => release,
        getActiveSetupCount: () => 0,
      },
    })

    try {
      await manager.checkForUpdates()
      provider.emit('update-available', { version: '0.2.1' })
      const download = manager.downloadUpdate()
      provider.emit('update-downloaded', { downloadedFile, version: '0.2.1' })
      await download

      await expect(coordinator.requestRestart(true)).resolves.toMatchObject({
        restarting: true,
      })
      expect(shutdownServices).toHaveBeenCalledWith('update-install')
      expect(provider.quitAndInstall).toHaveBeenCalledOnce()
      expect(terminateAfterShutdownFailure).not.toHaveBeenCalled()

      manager.stop()
      await expect(manager.releaseFileMatchesVerifiedIdentity()).resolves.toBe(
        false,
      )
    } finally {
      manager.stop()
      rmSync(directory, { force: true, recursive: true })
    }
  })

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

  it('permits an HTTPS loopback origin only for the explicit drill release option', () => {
    const fixture = signedReleaseFixture()
    const release = {
      keyring: fixture.keyring,
      origin: 'https://127.0.0.1:4567',
    }
    const normal = createManager({
      appImagePath: '/tmp/Aide.AppImage',
      isAppImagePath: () => true,
      release,
    })
    const drill = createManager({
      appImagePath: '/tmp/Aide.AppImage',
      isAppImagePath: () => true,
      release: { ...release, allowLoopbackDrillOrigin: true },
    })
    expect(normal.manager.getSnapshot().capability).toBe('manual-only')
    expect(drill.manager.getSnapshot().capability).toBe('supported')
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

  it('uses the persisted automatic-download preference while retaining manual download', async () => {
    const state = {
      automaticDownloads: false,
      healthDisclosureAcknowledged: false,
      healthReportingEnabled: true,
      installationId: 'installation-1',
      lastCheckedAt: null,
      pendingAttemptId: null,
      pendingTargetVersion: null,
      snoozedUntil: null,
    }
    const { manager, provider } = createManager({
      store: {
        getUpdateState: () => state,
        updateUpdateState: vi.fn(() => state),
      },
    })

    await manager.checkForUpdates()
    provider.emit('update-available', { version: '0.1.1' })

    expect(provider.downloadCount).toBe(0)
    expect(manager.getSnapshot()).toMatchObject({
      phase: 'available',
      targetVersion: '0.1.1',
    })

    await manager.downloadUpdate()
    expect(provider.downloadCount).toBe(1)
  })

  it('emits monotonic durable preference revisions for a valid future snooze', () => {
    const state = {
      automaticDownloads: true,
      healthDisclosureAcknowledged: false,
      healthReportingEnabled: true,
      installationId: 'installation-1',
      lastCheckedAt: null,
      pendingAttemptId: null,
      pendingTargetVersion: null,
      snoozedUntil: null,
    }
    let preferences = {
      automaticDownloads: true,
      healthDisclosureAcknowledged: false,
      healthReportingEnabled: true,
      revision: 0,
      snoozedUntil: null as string | null,
    }
    const updateUpdatePreferences = vi.fn((input) => {
      preferences = {
        ...preferences,
        ...input,
        revision: preferences.revision + 1,
      }
      return preferences
    })
    const { manager } = createManager({
      now: () => new Date('2026-07-24T12:00:00.000Z'),
      store: {
        getUpdatePreferences: () => preferences,
        getUpdateState: () => state,
        updateUpdatePreferences,
        updateUpdateState: vi.fn(() => state),
      },
    })
    const events: number[] = []
    manager.subscribePreferences((event) => events.push(event.revision))

    expect(() =>
      manager.updatePreferences({ snoozedUntil: '2026-99-25T12:00:00.000Z' }),
    ).toThrow('Invalid update snooze time.')
    expect(
      manager.updatePreferences({
        snoozedUntil: '2026-07-25T12:00:00.000Z',
      }),
    ).toMatchObject({
      revision: 1,
      snoozedUntil: '2026-07-25T12:00:00.000Z',
    })
    expect(
      manager.updatePreferences({ automaticDownloads: false }),
    ).toMatchObject({
      automaticDownloads: false,
      revision: 2,
    })
    expect(updateUpdatePreferences).toHaveBeenCalledTimes(2)
    expect(events).toEqual([1, 2])
  })

  it('rejects snoozing a currently available critical signed update', async () => {
    const fixture = signedReleaseFixture({ urgency: 'critical' })
    const { manager, provider } = createManager({
      automaticDownloads: false,
      now: () => new Date('2026-07-24T12:00:00.000Z'),
      release: {
        allowInsecureTestOrigin: true,
        fetch: fixture.fetch,
        keyring: fixture.keyring,
        origin: TEST_ORIGIN,
      },
    })

    await manager.checkForUpdates()
    provider.emit('update-available', { version: '0.2.1' })

    expect(manager.getSnapshot()).toMatchObject({
      phase: 'available',
      urgency: 'critical',
    })
    expect(() =>
      manager.updatePreferences({
        snoozedUntil: '2026-07-25T12:00:00.000Z',
      }),
    ).toThrow('Critical updates cannot be snoozed.')
    manager.stop()
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

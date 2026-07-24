import { createHash, randomUUID } from 'node:crypto'
import { once } from 'node:events'
import {
  accessSync,
  closeSync,
  constants as fsConstants,
  openSync,
  readSync,
  statSync,
} from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'

import electronUpdater from 'electron-updater'
import {
  cohortForInstallation,
  compareStableSemver,
  MAX_RELEASE_FEED_BYTES,
  parseAndVerifyReleaseEnvelope,
  type ReleaseEnvelope,
  releaseFileMatchesIdentity,
  type VerifiedReleaseFileIdentity,
  validateReleaseEligibility,
  verifyArtifactDigest,
  verifyReleaseFileDigest,
} from '../shared/release-envelope'
import type {
  UpdateCapability,
  UpdateErrorCode,
  UpdateEvent,
  UpdateHealthEvent,
  UpdatePreferencesEvent,
  UpdatePreferencesInput,
  UpdatePreferencesSnapshot,
  UpdateProgress,
  UpdateSnapshot,
  UpdateState,
} from '../shared/update'
import { UPDATE_SCHEMA_VERSION } from '../shared/update'
import {
  bucketUpdateHealthDuration,
  coarsenUpdateHealthTimestamp,
} from '../shared/update-health'
import { validateTrustedUpdateOrigin } from '../shared/trusted-update-url.mjs'

const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const DEFAULT_INITIAL_CHECK_DELAY_MS = 60_000
const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60_000

export interface UpdateProvider {
  autoDownload: boolean
  autoInstallOnAppQuit?: boolean
  allowDowngrade?: boolean
  allowPrerelease?: boolean
  disableDifferentialDownload?: boolean
  checkForUpdates: () => Promise<unknown>
  downloadUpdate: () => Promise<unknown>
  quitAndInstall?: () => void
  setFeedURL?: (options: { provider: 'generic'; url: string }) => void
  on: (event: string, listener: (payload?: unknown) => void) => void
}

interface UpdateApp {
  getVersion: () => string
  isPackaged: boolean
}

export interface UpdateManagerOptions {
  app: UpdateApp
  appImagePath?: string
  /** Temporary preference seam; persistence is introduced by aide-x2h.3. */
  automaticDownloads?: boolean
  checkIntervalMs?: number
  createProvider?: () => UpdateProvider
  initialCheckDelayMs?: number
  isAppImagePath?: (path: string) => boolean
  now?: () => Date
  /** Invoked after a consented health event is durably queued. */
  onUpdateHealthEventQueued?: () => void | Promise<void>
  onUpdate?: (event: UpdateEvent) => void
  platform?: NodeJS.Platform
  arch?: NodeJS.Architecture
  /** `null` is the explicit production fail-closed configuration. */
  release?: UpdateReleaseOptions | null
  store?: UpdateStateStore
  setInterval?: typeof globalThis.setInterval
  setTimeout?: typeof globalThis.setTimeout
  clearInterval?: typeof globalThis.clearInterval
  clearTimeout?: typeof globalThis.clearTimeout
}

export interface UpdateStopOptions {
  /**
   * Retains only the in-memory file identity needed by the restart
   * coordinator's final post-shutdown check. The normal shutdown path clears
   * it unconditionally.
   */
  preserveVerifiedDownload?: boolean
}

export interface UpdateStateStore {
  appendUpdateHealthEvent?: (event: UpdateHealthEvent) => void
  commitUpdateInstallStart?: (input: {
    arch: 'arm64' | 'x64'
    attemptId: string
    currentVersion: string
    now: string
    platform: 'darwin' | 'linux'
    targetVersion: string
  }) => UpdateState
  getUpdateState: () => UpdateState
  getUpdatePreferences?: () => UpdatePreferencesSnapshot
  updateUpdateState: (
    input: Partial<Omit<UpdateState, 'installationId'>>,
  ) => UpdateState
  updateUpdatePreferences?: (
    input: UpdatePreferencesInput,
  ) => UpdatePreferencesSnapshot
}

export interface UpdateReleaseOptions {
  /** Build-time-only acceptance-drill capability; never derived from env. */
  readonly allowLoopbackDrillOrigin?: boolean
  readonly allowInsecureTestOrigin?: boolean
  readonly fetch?: typeof globalThis.fetch
  readonly keyring: Readonly<Record<string, string>>
  readonly origin: string
}

interface UpdateInfo {
  version?: unknown
}

interface DownloadProgressInfo {
  percent?: unknown
  total?: unknown
  transferred?: unknown
}

interface DownloadedUpdateInfo extends UpdateInfo {
  downloadedFile?: unknown
}

interface VerifiedDownloadedRelease {
  readonly artifactPath: string
  readonly envelope: ReleaseEnvelope
  readonly identity: VerifiedReleaseFileIdentity
}

interface ReleaseProxy {
  readonly close: () => Promise<void>
  readonly feedUrl: string
}

interface VerifiedFeedMetadata {
  readonly blockMapSize: number | null
}

interface ParsedFeedEntry {
  blockMapSize: number | null
  name: string
  sha512: string | null
  size: number | null
}

function isStableSemver(value: string): boolean {
  return STABLE_SEMVER.test(value)
}

function extractVersion(payload: unknown): string | null {
  const version = (payload as UpdateInfo | null)?.version
  return typeof version === 'string' ? version : null
}

function toNonNegativeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.max(0, value)
    : 0
}

function sanitizeProgress(payload: unknown): UpdateProgress {
  const progress = payload as DownloadProgressInfo | null
  return {
    percent: Math.min(100, toNonNegativeNumber(progress?.percent)),
    total: toNonNegativeNumber(progress?.total),
    transferred: toNonNegativeNumber(progress?.transferred),
  }
}

function sanitizeErrorCode(error: unknown): UpdateErrorCode {
  const message = error instanceof Error ? error.message.toLowerCase() : ''

  if (/disk|space|enospc/.test(message)) return 'disk-space'
  if (/network|fetch|connect|timeout|offline|econn|http/.test(message)) {
    return 'network'
  }
  return 'unknown'
}

export class UpdateManager {
  private checkPromise: Promise<UpdateSnapshot> | null = null
  private downloadPromise: Promise<UpdateSnapshot> | null = null
  private automaticChecksStarted = false
  private initialCheckTimer: ReturnType<typeof setTimeout> | null = null
  private intervalTimer: ReturnType<typeof setInterval> | null = null
  private operationGeneration = 0
  private provider: UpdateProvider | null = null
  private releaseProxy: ReleaseProxy | null = null
  private activeAttemptId: string | null = null
  private verifiedDownloadedRelease: VerifiedDownloadedRelease | null = null
  private verifiedRelease: ReleaseEnvelope | null = null
  private downloadedVerification: Promise<void> | null = null
  private healthOperationStartedAt: string | null = null
  private quitAndInstallCalled = false
  private readonly preferenceSubscribers = new Set<
    (event: UpdatePreferencesEvent) => void
  >()
  private readonly subscribers = new Set<(event: UpdateEvent) => void>()
  private snapshot: UpdateSnapshot

  public constructor(private readonly options: UpdateManagerOptions) {
    const capability = this.resolveCapability()
    this.snapshot = {
      capability,
      currentVersion: options.app.getVersion(),
      errorCode: null,
      lastCheckedAt: null,
      phase: capability === 'supported' ? 'idle' : 'unsupported',
      progress: null,
      revision: 0,
      schemaVersion: UPDATE_SCHEMA_VERSION,
      targetVersion: null,
      urgency: null,
    }
  }

  public getSnapshot(): UpdateSnapshot {
    return {
      ...this.snapshot,
      progress: this.snapshot.progress && { ...this.snapshot.progress },
    }
  }

  public subscribe(listener: (event: UpdateEvent) => void): () => void {
    this.subscribers.add(listener)
    return () => this.subscribers.delete(listener)
  }

  public getPreferences(): UpdatePreferencesSnapshot {
    const store = this.options.store
    if (store?.getUpdatePreferences) return store.getUpdatePreferences()
    const state = store?.getUpdateState()
    return {
      automaticDownloads: state?.automaticDownloads ?? true,
      healthDisclosureAcknowledged:
        state?.healthDisclosureAcknowledged ?? false,
      healthReportingEnabled: state?.healthReportingEnabled ?? true,
      revision: 0,
      snoozedUntil: state?.snoozedUntil ?? null,
    }
  }

  public updatePreferences(
    input: UpdatePreferencesInput,
  ): UpdatePreferencesSnapshot {
    const now = this.options.now?.() ?? new Date()
    const snoozeTime =
      input.snoozedUntil === undefined || input.snoozedUntil === null
        ? null
        : new Date(input.snoozedUntil)
    if (
      input.snoozedUntil !== undefined &&
      input.snoozedUntil !== null &&
      this.snapshot.urgency === 'critical'
    ) {
      throw new Error('Critical updates cannot be snoozed.')
    }
    if (
      input.snoozedUntil !== undefined &&
      input.snoozedUntil !== null &&
      (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(
        input.snoozedUntil,
      ) ||
        Number.isNaN(snoozeTime?.getTime()) ||
        snoozeTime?.toISOString() !== input.snoozedUntil ||
        snoozeTime.getTime() <= now.getTime())
    ) {
      throw new Error('Invalid update snooze time.')
    }
    const store = this.options.store
    const snapshot = store?.updateUpdatePreferences
      ? store.updateUpdatePreferences(input)
      : this.getPreferences()
    const event: UpdatePreferencesEvent = {
      revision: snapshot.revision,
      snapshot,
    }
    for (const subscriber of this.preferenceSubscribers) subscriber(event)
    return snapshot
  }

  public subscribePreferences(
    listener: (event: UpdatePreferencesEvent) => void,
  ): () => void {
    this.preferenceSubscribers.add(listener)
    return () => this.preferenceSubscribers.delete(listener)
  }

  public startAutomaticChecks(): void {
    if (this.snapshot.capability !== 'supported' || this.automaticChecksStarted)
      return

    this.automaticChecksStarted = true
    const setTimeout = this.options.setTimeout ?? globalThis.setTimeout
    const setInterval = this.options.setInterval ?? globalThis.setInterval
    this.initialCheckTimer = setTimeout(() => {
      this.initialCheckTimer = null
      void this.checkForUpdates()
    }, this.options.initialCheckDelayMs ?? DEFAULT_INITIAL_CHECK_DELAY_MS)
    this.intervalTimer = setInterval(
      () => void this.checkForUpdates(),
      this.options.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS,
    )
  }

  public stop(options: UpdateStopOptions = {}): void {
    this.operationGeneration += 1
    const clearTimeout = this.options.clearTimeout ?? globalThis.clearTimeout
    const clearInterval = this.options.clearInterval ?? globalThis.clearInterval
    if (this.initialCheckTimer !== null) clearTimeout(this.initialCheckTimer)
    if (this.intervalTimer !== null) clearInterval(this.intervalTimer)
    this.automaticChecksStarted = false
    this.initialCheckTimer = null
    this.intervalTimer = null
    this.checkPromise = null
    this.downloadPromise = null
    void this.releaseProxy?.close()
    this.releaseProxy = null
    this.verifiedRelease = null
    if (!options.preserveVerifiedDownload) {
      this.verifiedDownloadedRelease = null
    }
    this.downloadedVerification = null
  }

  public checkForUpdates(): Promise<UpdateSnapshot> {
    if (this.snapshot.capability !== 'supported') {
      return Promise.resolve(this.getSnapshot())
    }
    if (
      this.snapshot.phase === 'downloading' ||
      this.snapshot.phase === 'downloaded'
    ) {
      return Promise.resolve(this.getSnapshot())
    }
    if (this.checkPromise) return this.checkPromise

    const generation = this.operationGeneration
    this.publish({
      errorCode: null,
      lastCheckedAt: this.getNow(),
      phase: 'checking',
      progress: null,
      targetVersion: null,
      urgency: null,
    })
    this.activeAttemptId = randomUUID()
    this.healthOperationStartedAt = this.snapshot.lastCheckedAt
    this.recordHealth('check-started')
    this.options.store?.updateUpdateState({
      lastCheckedAt: this.snapshot.lastCheckedAt,
    })
    this.checkPromise = this.prepareSignedFeed()
      .then(() => this.getProvider().checkForUpdates())
      .catch((error: unknown) => {
        if (this.isActiveGeneration(generation)) {
          this.failUpdate(sanitizeErrorCode(error))
        }
      })
      .then(() => this.getSnapshot())
      .finally(() => {
        if (this.isActiveGeneration(generation)) this.checkPromise = null
      })
    return this.checkPromise
  }

  public downloadUpdate(): Promise<UpdateSnapshot> {
    if (this.snapshot.capability !== 'supported') {
      return Promise.resolve(this.getSnapshot())
    }
    if (this.downloadPromise) return this.downloadPromise
    if (this.snapshot.phase !== 'available') {
      return Promise.resolve(this.getSnapshot())
    }

    const generation = this.operationGeneration
    const provider = this.getProvider()
    this.publish({ errorCode: null, phase: 'downloading', progress: null })
    this.healthOperationStartedAt = this.getNow()
    this.recordHealth('download-started')
    this.downloadedVerification = null
    this.downloadPromise = provider
      .downloadUpdate()
      .then(async () => {
        await this.downloadedVerification
      })
      .catch((error: unknown) => {
        if (this.isActiveGeneration(generation)) {
          this.failUpdate(sanitizeErrorCode(error))
        }
      })
      .then(() => this.getSnapshot())
      .finally(() => {
        if (this.isActiveGeneration(generation)) this.downloadPromise = null
      })
    return this.downloadPromise
  }

  private getProvider(): UpdateProvider {
    this.provider ??= this.createProvider()
    return this.provider
  }

  private createProvider(): UpdateProvider {
    const provider =
      this.options.createProvider?.() ?? this.createElectronProvider()
    provider.allowDowngrade = false
    provider.allowPrerelease = false
    provider.disableDifferentialDownload = true
    // The manager owns the download operation so automatic and renderer-triggered
    // downloads share one deduplicated promise.
    provider.autoDownload = false
    provider.autoInstallOnAppQuit = false
    const generation = this.operationGeneration
    provider.on('checking-for-update', () => {
      if (
        this.isActiveGeneration(generation) &&
        (this.snapshot.phase === 'idle' ||
          this.snapshot.phase === 'failed' ||
          this.snapshot.phase === 'checking')
      ) {
        this.publish({
          errorCode: null,
          lastCheckedAt: this.getNow(),
          phase: 'checking',
          progress: null,
        })
      }
    })
    provider.on('update-not-available', () => {
      if (
        this.isActiveGeneration(generation) &&
        this.snapshot.phase === 'checking'
      ) {
        this.publish({
          phase: 'idle',
          progress: null,
          targetVersion: null,
          urgency: null,
        })
      }
    })
    provider.on('update-available', (payload) => {
      if (
        !this.isActiveGeneration(generation) ||
        this.snapshot.phase !== 'checking'
      ) {
        return
      }
      const version = extractVersion(payload)
      if (
        !version ||
        !isStableSemver(version) ||
        !isStableSemver(this.snapshot.currentVersion) ||
        compareStableSemver(version, this.snapshot.currentVersion) <= 0 ||
        (this.requiresSignedRelease() &&
          this.verifiedRelease?.version !== version)
      ) {
        this.failUpdate('invalid-update')
        return
      }
      this.publish({
        errorCode: null,
        phase: 'available',
        progress: null,
        targetVersion: version,
        urgency: this.verifiedRelease?.urgency ?? null,
      })
      if (this.shouldAutomaticallyDownload()) {
        void this.downloadUpdate()
      }
    })
    provider.on('download-progress', (payload) => {
      if (
        this.isActiveGeneration(generation) &&
        this.snapshot.phase === 'downloading'
      ) {
        this.publish({
          phase: 'downloading',
          progress: sanitizeProgress(payload),
        })
      }
    })
    provider.on('update-downloaded', (payload) => {
      if (
        !this.isActiveGeneration(generation) ||
        this.snapshot.phase !== 'downloading'
      ) {
        return
      }
      const version = extractVersion(payload)
      if (!version || version !== this.snapshot.targetVersion) {
        this.failUpdate('invalid-update')
        return
      }
      this.downloadedVerification = this.handleDownloadedUpdate(payload).catch(
        () => {
          if (this.isActiveGeneration(generation)) {
            this.failUpdate('invalid-update')
          }
        },
      )
    })
    provider.on('error', (error) => {
      if (
        this.isActiveGeneration(generation) &&
        (this.snapshot.phase === 'checking' ||
          this.snapshot.phase === 'downloading')
      ) {
        this.failUpdate(sanitizeErrorCode(error))
      }
    })
    return provider
  }

  private createElectronProvider(): UpdateProvider {
    const { autoUpdater } = electronUpdater
    return {
      get allowDowngrade() {
        return autoUpdater.allowDowngrade
      },
      set allowDowngrade(value: boolean | undefined) {
        autoUpdater.allowDowngrade = value ?? false
      },
      get allowPrerelease() {
        return autoUpdater.allowPrerelease
      },
      set allowPrerelease(value: boolean | undefined) {
        autoUpdater.allowPrerelease = value ?? false
      },
      get autoDownload() {
        return autoUpdater.autoDownload
      },
      set autoDownload(value: boolean) {
        autoUpdater.autoDownload = value
      },
      get autoInstallOnAppQuit() {
        return autoUpdater.autoInstallOnAppQuit
      },
      set autoInstallOnAppQuit(value: boolean | undefined) {
        autoUpdater.autoInstallOnAppQuit = value ?? false
      },
      get disableDifferentialDownload() {
        return autoUpdater.disableDifferentialDownload
      },
      set disableDifferentialDownload(value: boolean | undefined) {
        autoUpdater.disableDifferentialDownload = value ?? true
      },
      checkForUpdates: () => autoUpdater.checkForUpdates(),
      downloadUpdate: () => autoUpdater.downloadUpdate(),
      quitAndInstall: () => autoUpdater.quitAndInstall(),
      setFeedURL: (options) => autoUpdater.setFeedURL(options),
      on: (event, listener) => {
        autoUpdater.on(event as never, listener as never)
      },
    }
  }

  /**
   * Re-fetches the signed channel before shutdown. The updater is never called
   * unless this check has selected a current, signed target and a private local
   * feed proxy has been installed.
   */
  public async revalidateDownloadedUpdate(): Promise<boolean> {
    const downloaded = this.verifiedDownloadedRelease
    if (!downloaded || this.snapshot.phase !== 'downloaded') return false
    try {
      const envelope = await this.fetchVerifiedRelease()
      if (
        envelope.version !== downloaded.envelope.version ||
        envelope.artifact.sha256 !== downloaded.envelope.artifact.sha256 ||
        envelope.artifact.sha512 !== downloaded.envelope.artifact.sha512 ||
        envelope.artifact.size !== downloaded.envelope.artifact.size
      ) {
        this.invalidateDownloadedUpdate()
        return false
      }
      const matches = await releaseFileMatchesIdentity(
        downloaded.artifactPath,
        downloaded.identity,
      )
      if (!matches) this.invalidateDownloadedUpdate()
      return matches
    } catch {
      this.invalidateDownloadedUpdate()
      return false
    }
  }

  /** A refreshed channel can revoke a ready file; make recovery checkable. */
  private invalidateDownloadedUpdate(): void {
    this.verifiedDownloadedRelease = null
    this.downloadedVerification = null
    void this.releaseProxy?.close()
    this.releaseProxy = null
    this.verifiedRelease = null
    this.publish({
      errorCode: 'invalid-update',
      phase: 'failed',
      progress: null,
      targetVersion: null,
      urgency: null,
    })
  }

  /** Reopens the updater cache path without following links immediately before install. */
  public async releaseFileMatchesVerifiedIdentity(): Promise<boolean> {
    const downloaded = this.verifiedDownloadedRelease
    return downloaded
      ? releaseFileMatchesIdentity(downloaded.artifactPath, downloaded.identity)
      : false
  }

  /**
   * Commits the durable install marker after fresh channel/artifact validation
   * but before shutdown. This is the only moment a future startup may report an
   * installation result.
   */
  public markInstallStarted(): void {
    const downloaded = this.verifiedDownloadedRelease
    if (!downloaded || this.snapshot.phase !== 'downloaded') {
      throw new Error('No verified update is ready to install.')
    }
    const store = this.options.store
    if (!store) return
    const attemptId = this.activeAttemptId ?? randomUUID()
    this.activeAttemptId = attemptId
    const target = downloaded.envelope.version
    const input = {
      arch: downloaded.envelope.arch,
      attemptId,
      currentVersion: this.snapshot.currentVersion,
      now: this.getNow(),
      platform: downloaded.envelope.platform,
      targetVersion: target,
    } as const
    const state = store.commitUpdateInstallStart?.(input)
    if (state) return
    const updated = store.updateUpdateState({
      pendingAttemptId: attemptId,
      pendingTargetVersion: target,
    })
    if (
      updated.healthReportingEnabled &&
      updated.healthDisclosureAcknowledged
    ) {
      if (!store.appendUpdateHealthEvent) return
      store.appendUpdateHealthEvent({
        arch: input.arch,
        attemptId,
        cohort: cohortForInstallation(updated.installationId, target),
        createdAt: input.now,
        currentVersion: input.currentVersion,
        durationMs: null,
        errorCode: null,
        lifecycle: 'install-started',
        platform: input.platform,
        targetVersion: target,
      })
    }
  }

  /** The restart coordinator is the sole caller; provider-level de-duplication is defensive. */
  public quitAndInstall(): void {
    if (this.quitAndInstallCalled || this.snapshot.phase !== 'downloaded')
      return
    this.quitAndInstallCalled = true
    this.getProvider().quitAndInstall?.()
  }

  private async prepareSignedFeed(): Promise<void> {
    if (!this.requiresSignedRelease()) return
    const release = await this.fetchVerifiedRelease()
    const metadata = await this.fetchVerifiedFeed(release)
    const proxy = await this.startReleaseProxy(release, metadata)
    await this.releaseProxy?.close()
    this.releaseProxy = proxy
    this.verifiedRelease = release
    const provider = this.getProvider()
    if (!provider.setFeedURL) {
      throw new Error('The update provider cannot accept a verified feed.')
    }
    provider.setFeedURL({ provider: 'generic', url: proxy.feedUrl })
  }

  private async fetchVerifiedRelease(): Promise<ReleaseEnvelope> {
    const release = this.options.release
    if (!release) {
      throw new Error('A trusted update origin is not configured.')
    }
    const origin = this.requireReleaseOrigin(release)
    const target = this.releaseTarget()
    const base = `${origin.href}channels/stable/${target.platform}/${target.arch}/`
    const envelopeUrl = new URL('release-envelope.json', base)
    const signatureUrl = new URL('release-envelope.sig', base)
    const [rawEnvelope, signature] = await Promise.all([
      this.fetchBoundedBytes(envelopeUrl, 64 * 1024),
      this.fetchBoundedBytes(signatureUrl, 64 * 1024),
    ])
    const envelope = parseAndVerifyReleaseEnvelope(
      rawEnvelope,
      signature,
      release.keyring,
    )
    validateReleaseEligibility(envelope, {
      allowedOrigin: origin.href,
      allowInsecureTestOrigin: release.allowInsecureTestOrigin === true,
      arch: target.arch,
      currentVersion: this.snapshot.currentVersion,
      installationId: this.getInstallationId(),
      platform: target.platform,
    })
    return envelope
  }

  private async fetchVerifiedFeed(
    release: ReleaseEnvelope,
  ): Promise<VerifiedFeedMetadata> {
    const bytes = await this.fetchBoundedBytes(
      new URL(release.feed.url),
      MAX_RELEASE_FEED_BYTES,
    )
    const directory = await mkdtemp(path.join(tmpdir(), 'aide-release-feed-'))
    const feedPath = path.join(directory, 'metadata.yml')
    try {
      await writeFile(feedPath, bytes, { flag: 'wx', mode: 0o600 })
      await verifyReleaseFileDigest(feedPath, release.feed.sha256)
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
    return this.validateFeedMetadata(bytes, release)
  }

  private async startReleaseProxy(
    release: ReleaseEnvelope,
    metadata: VerifiedFeedMetadata,
  ): Promise<ReleaseProxy> {
    const token = randomUUID().replaceAll('-', '')
    const target = this.releaseTarget()
    const feedName =
      target.platform === 'linux' ? 'latest-linux.yml' : 'latest-mac.yml'
    let port: number | null = null
    const server = createServer(async (request, response) => {
      if (request.method !== 'GET') {
        response.writeHead(405).end()
        return
      }
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (
        requestUrl.pathname === `/${token}/${feedName}` &&
        this.isExpectedFeedQuery(requestUrl)
      ) {
        if (port === null) {
          response.writeHead(503).end()
          return
        }
        const rewritten = this.createLocalFeed(release, metadata, token, port)
        response.writeHead(200, {
          'cache-control': 'no-store',
          'content-length': rewritten.byteLength,
          'content-type': 'text/yaml; charset=utf-8',
        })
        response.end(rewritten)
        return
      }
      if (
        requestUrl.pathname !== `/${token}/artifact` ||
        requestUrl.search ||
        requestUrl.hash
      ) {
        response.writeHead(404).end()
        return
      }
      try {
        await this.streamArtifact(
          new URL(release.artifact.url),
          release,
          request,
          response,
        )
      } catch {
        if (!response.headersSent) response.writeHead(502)
        response.end()
      }
    })
    const address = await listenLoopback(server)
    port = address.port
    return {
      close: () => closeServer(server),
      feedUrl: `http://127.0.0.1:${address.port}/${token}`,
    }
  }

  private createLocalFeed(
    release: ReleaseEnvelope,
    metadata: VerifiedFeedMetadata,
    token: string,
    port: number,
  ): Buffer {
    const localArtifact = `http://127.0.0.1:${port}/${token}/artifact`
    const sha512 = Buffer.from(release.artifact.sha512, 'hex').toString(
      'base64',
    )
    return Buffer.from(
      [
        `version: ${release.version}`,
        'files:',
        `  - url: ${localArtifact}`,
        `    sha512: ${sha512}`,
        `    size: ${release.artifact.size}`,
        ...(metadata.blockMapSize === null
          ? []
          : [`    blockMapSize: ${metadata.blockMapSize}`]),
        `path: ${localArtifact}`,
        `sha512: ${sha512}`,
        'releaseDate: 1970-01-01T00:00:00.000Z',
        '',
      ].join('\n'),
      'utf8',
    )
  }

  private isExpectedFeedQuery(requestUrl: URL): boolean {
    if (!requestUrl.search) return true
    const entries = [...requestUrl.searchParams.entries()]
    return (
      entries.length === 1 &&
      entries[0]?.[0] === 'noCache' &&
      /^[0-9a-v]{1,32}$/.test(entries[0]?.[1] ?? '') &&
      requestUrl.search === `?noCache=${entries[0]?.[1]}`
    )
  }

  private validateFeedMetadata(
    feedBytes: Buffer,
    release: ReleaseEnvelope,
  ): VerifiedFeedMetadata {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(feedBytes)
    if (text.includes('\u0000') || text.length > MAX_RELEASE_FEED_BYTES) {
      throw new Error('Invalid updater metadata.')
    }
    const version = /^version:\s*([^\s]+)\s*$/m.exec(text)?.[1]
    const artifactName = path.basename(new URL(release.artifact.url).pathname)
    const expectedSha512 = Buffer.from(release.artifact.sha512, 'hex').toString(
      'base64',
    )
    const entry = this.findSignedFeedEntry(text, artifactName)
    if (
      version !== release.version ||
      !entry ||
      entry.sha512 !== expectedSha512 ||
      entry.size !== release.artifact.size
    ) {
      throw new Error('Updater metadata does not match its signed release.')
    }
    return { blockMapSize: entry.blockMapSize }
  }

  private findSignedFeedEntry(
    text: string,
    artifactName: string,
  ): { blockMapSize: number | null; sha512: string; size: number } | null {
    const lines = text.split('\n')
    let active: ParsedFeedEntry | null = null
    const entries: ParsedFeedEntry[] = []
    for (const line of lines) {
      const file = /^\s*-\s+url:\s*([^\s]+)\s*$/.exec(line)
      if (file) {
        if (active) entries.push(active)
        active = {
          blockMapSize: null,
          name: file[1],
          sha512: null,
          size: null,
        }
        continue
      }
      if (!active) continue
      const sha512 = /^\s+sha512:\s*([^\s]+)\s*$/.exec(line)
      if (sha512) {
        active.sha512 = sha512[1]
        continue
      }
      const size = /^\s+size:\s*(\d+)\s*$/.exec(line)
      if (size) {
        active.size = Number(size[1])
        continue
      }
      const blockMapSize = /^\s+blockMapSize:\s*(\d+)\s*$/.exec(line)
      if (blockMapSize) {
        const value = Number(blockMapSize[1])
        if (!Number.isSafeInteger(value) || value < 1) return null
        active.blockMapSize = value
      }
    }
    if (active) entries.push(active)
    const matching = entries.filter(
      (entry) =>
        entry.name === artifactName &&
        entry.sha512 !== null &&
        entry.size !== null &&
        Number.isSafeInteger(entry.size) &&
        entry.size > 0,
    )
    if (matching.length !== 1) return null
    const entry = matching[0]
    return {
      blockMapSize: entry.blockMapSize,
      sha512: entry.sha512 as string,
      size: entry.size as number,
    }
  }

  private async handleDownloadedUpdate(payload: unknown): Promise<void> {
    if (!this.requiresSignedRelease()) {
      this.publish({
        phase: 'downloaded',
        progress: { percent: 100, total: 0, transferred: 0 },
      })
      this.recordHealth('downloaded')
      return
    }
    const pathValue = (payload as DownloadedUpdateInfo | null)?.downloadedFile
    const release = this.verifiedRelease
    if (typeof pathValue !== 'string' || !release) {
      throw new Error('Update provider did not report a downloaded file.')
    }
    const identity = await verifyArtifactDigest(pathValue, release.artifact)
    this.verifiedDownloadedRelease = {
      artifactPath: pathValue,
      envelope: release,
      identity,
    }
    this.publish({
      phase: 'downloaded',
      progress: { percent: 100, total: 0, transferred: 0 },
    })
    this.recordHealth('downloaded')
  }

  private requiresSignedRelease(): boolean {
    return (
      this.options.release !== undefined ||
      this.options.createProvider === undefined
    )
  }

  private getInstallationId(): string {
    return (
      this.options.store?.getUpdateState().installationId ?? 'test-installation'
    )
  }

  private shouldAutomaticallyDownload(): boolean {
    return (
      this.options.store?.getUpdateState().automaticDownloads ??
      this.options.automaticDownloads ??
      true
    )
  }

  private releaseTarget(): {
    arch: 'arm64' | 'x64'
    platform: 'darwin' | 'linux'
  } {
    const platform = this.options.platform ?? process.platform
    const arch = this.options.arch ?? process.arch
    if (
      (platform !== 'linux' && platform !== 'darwin') ||
      (arch !== 'x64' && arch !== 'arm64')
    ) {
      throw new Error('This platform cannot use signed updates.')
    }
    if (platform === 'linux' && arch !== 'x64') {
      throw new Error('Linux updates support x64 AppImages only.')
    }
    return { arch, platform }
  }

  private requireReleaseOrigin(release: UpdateReleaseOptions): URL {
    const origin = new URL(release.origin)
    const loopback =
      origin.protocol === 'http:' &&
      release.allowInsecureTestOrigin === true &&
      ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(origin.hostname)
    if (
      (!loopback &&
        validateTrustedUpdateOrigin(release.origin, {
          allowLoopback: release.allowLoopbackDrillOrigin === true,
        }) === null) ||
      origin.username ||
      origin.password ||
      origin.search ||
      origin.hash ||
      origin.pathname !== '/' ||
      Object.keys(release.keyring).length === 0
    ) {
      throw new Error('A trusted HTTPS custom update origin is required.')
    }
    return origin
  }

  private async fetchBoundedBytes(
    url: URL,
    maximumBytes: number,
  ): Promise<Buffer> {
    const response = await this.fetchReleaseResponse(url)
    const reader = response.body?.getReader()
    if (!reader) throw new Error('Update response has no body.')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        const next = await reader.read()
        if (next.done) break
        size += next.value.byteLength
        if (size > maximumBytes)
          throw new Error('Update response is too large.')
        chunks.push(next.value)
      }
    } finally {
      reader.releaseLock()
    }
    return Buffer.concat(chunks, size)
  }

  private async streamArtifact(
    url: URL,
    release: ReleaseEnvelope,
    request: import('node:http').IncomingMessage,
    response: import('node:http').ServerResponse,
  ): Promise<void> {
    const source = await this.fetchReleaseResponse(url)
    const contentLength = source.headers.get('content-length')
    if (
      !contentLength ||
      !/^\d+$/.test(contentLength) ||
      Number(contentLength) !== release.artifact.size
    ) {
      throw new Error('Update artifact has an unexpected content length.')
    }
    const reader = source.body?.getReader()
    if (!reader) throw new Error('Update artifact has no body.')
    const sha256 = createHash('sha256')
    const sha512 = createHash('sha512')
    let aborted = false
    const cancel = () => {
      aborted = true
      void reader.cancel()
    }
    request.once('aborted', cancel)
    response.once('close', cancel)
    response.writeHead(200, {
      'cache-control': 'no-store',
      'content-length': release.artifact.size,
      'content-type': 'application/octet-stream',
    })
    let size = 0
    try {
      while (!aborted) {
        const next = await reader.read()
        if (next.done) break
        size += next.value.byteLength
        if (size > release.artifact.size) {
          throw new Error('Update artifact exceeds its signed size.')
        }
        sha256.update(next.value)
        sha512.update(next.value)
        if (!response.write(next.value)) await once(response, 'drain')
      }
      if (aborted) return
      if (
        size !== release.artifact.size ||
        sha256.digest('hex') !== release.artifact.sha256 ||
        sha512.digest('hex') !== release.artifact.sha512
      ) {
        throw new Error('Update artifact does not match its signed digest.')
      }
      response.end()
    } finally {
      request.off('aborted', cancel)
      response.off('close', cancel)
      reader.releaseLock()
    }
  }

  private async fetchReleaseResponse(url: URL): Promise<Response> {
    const release = this.options.release
    if (!release) throw new Error('A trusted update origin is not configured.')
    if (url.username || url.password)
      throw new Error('Update URL has credentials.')
    const response = await (release.fetch ?? globalThis.fetch)(url, {
      redirect: 'manual',
    })
    if (
      !response.ok ||
      response.status !== 200 ||
      response.redirected ||
      (response.url && response.url !== url.href)
    ) {
      throw new Error('Update request was rejected.')
    }
    return response
  }

  private isActiveGeneration(generation: number): boolean {
    return generation === this.operationGeneration
  }

  private resolveCapability(): UpdateCapability {
    if (!this.options.app.isPackaged) return 'development'
    // `undefined` is retained only for isolated fake-provider unit tests. The
    // production composition root always supplies `null` or trusted release
    // inputs, making an absent origin a manual-only installation.
    if (this.options.release === null) return 'manual-only'
    if (this.options.release) {
      try {
        this.requireReleaseOrigin(this.options.release)
        this.releaseTarget()
      } catch {
        return 'manual-only'
      }
    }
    const platform = this.options.platform ?? process.platform
    if (platform === 'linux') {
      const appImagePath =
        this.options.appImagePath === undefined
          ? process.env.APPIMAGE
          : this.options.appImagePath
      if (!appImagePath || !path.isAbsolute(appImagePath)) {
        return 'manual-only'
      }
      return (this.options.isAppImagePath ?? isValidAppImageFile)(appImagePath)
        ? 'supported'
        : 'manual-only'
    }
    return platform === 'darwin' ? 'supported' : 'unsupported-platform'
  }

  private getNow(): string {
    return (this.options.now?.() ?? new Date()).toISOString()
  }

  private failUpdate(errorCode: UpdateErrorCode): void {
    if (this.snapshot.phase === 'checking') {
      this.recordHealth('check-failed', errorCode)
    } else if (this.snapshot.phase === 'downloading') {
      this.recordHealth('download-failed', errorCode)
    }
    this.publish({ errorCode, phase: 'failed' })
  }

  /** Records only the fixed health schema; persistence enforces consent again. */
  private recordHealth(
    lifecycle: UpdateHealthEvent['lifecycle'],
    errorCode: UpdateErrorCode | null = null,
  ): void {
    const store = this.options.store
    if (!store) return
    try {
      const state = store.getUpdateState()
      if (!state.healthDisclosureAcknowledged || !state.healthReportingEnabled)
        return
      const targetVersion = this.snapshot.targetVersion
      const platform =
        this.verifiedRelease?.platform ??
        this.options.platform ??
        process.platform
      const arch =
        this.verifiedRelease?.arch ?? this.options.arch ?? process.arch
      if (
        (platform !== 'darwin' && platform !== 'linux') ||
        (arch !== 'arm64' && arch !== 'x64')
      ) {
        return
      }
      const now = this.getNow()
      const started = this.healthOperationStartedAt
      const durationMs =
        started && !lifecycle.endsWith('-started')
          ? bucketUpdateHealthDuration(
              Math.max(
                0,
                new Date(now).getTime() - new Date(started).getTime(),
              ),
            )
          : null
      if (!store.appendUpdateHealthEvent) return
      store.appendUpdateHealthEvent({
        arch,
        attemptId: this.activeAttemptId ?? randomUUID(),
        cohort: cohortForInstallation(
          state.installationId,
          targetVersion ?? this.snapshot.currentVersion,
        ),
        createdAt: coarsenUpdateHealthTimestamp(now),
        currentVersion: this.snapshot.currentVersion,
        durationMs,
        errorCode,
        lifecycle,
        platform,
        targetVersion,
      })
      void Promise.resolve(this.options.onUpdateHealthEventQueued?.()).catch(
        () => {
          // Upload scheduling must not alter update trust or availability.
        },
      )
    } catch {
      // Health observability must not alter update trust or availability.
    }
  }

  private publish(
    patch: Partial<
      Omit<
        UpdateSnapshot,
        'capability' | 'currentVersion' | 'revision' | 'schemaVersion'
      >
    >,
  ): void {
    this.snapshot = {
      ...this.snapshot,
      ...patch,
      revision: this.snapshot.revision + 1,
    }
    const event: UpdateEvent = {
      revision: this.snapshot.revision,
      snapshot: this.getSnapshot(),
    }
    this.options.onUpdate?.(event)
    for (const subscriber of this.subscribers) subscriber(event)
  }
}

function isValidAppImageFile(filePath: string): boolean {
  try {
    if (!statSync(filePath).isFile()) return false
    accessSync(path.dirname(filePath), fsConstants.W_OK)
    const descriptor = openSync(filePath, 'r')
    try {
      const header = Buffer.alloc(11)
      return (
        readSync(descriptor, header, 0, header.length, 0) === header.length &&
        header.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) &&
        header.subarray(8, 11).equals(Buffer.from([0x41, 0x49, 0x02]))
      )
    } finally {
      closeSync(descriptor)
    }
  } catch {
    return false
  }
}

function listenLoopback(server: Server): Promise<{ port: number }> {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('Update proxy did not bind to a TCP port.'))
        return
      }
      resolve({ port: address.port })
    })
  })
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}

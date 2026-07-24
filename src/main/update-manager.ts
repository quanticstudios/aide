import {
  accessSync,
  closeSync,
  constants as fsConstants,
  openSync,
  readSync,
  statSync,
} from 'node:fs'
import path from 'node:path'

import { autoUpdater } from 'electron-updater'

import type {
  UpdateCapability,
  UpdateErrorCode,
  UpdateEvent,
  UpdateProgress,
  UpdateSnapshot,
} from '../shared/update'
import { UPDATE_SCHEMA_VERSION } from '../shared/update'

const STABLE_SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const DEFAULT_INITIAL_CHECK_DELAY_MS = 60_000
const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60_000

export interface UpdateProvider {
  autoDownload: boolean
  autoInstallOnAppQuit?: boolean
  allowDowngrade?: boolean
  allowPrerelease?: boolean
  checkForUpdates: () => Promise<unknown>
  downloadUpdate: () => Promise<unknown>
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
  onUpdate?: (event: UpdateEvent) => void
  platform?: NodeJS.Platform
  setInterval?: typeof globalThis.setInterval
  setTimeout?: typeof globalThis.setTimeout
  clearInterval?: typeof globalThis.clearInterval
  clearTimeout?: typeof globalThis.clearTimeout
}

interface UpdateInfo {
  version?: unknown
}

interface DownloadProgressInfo {
  percent?: unknown
  total?: unknown
  transferred?: unknown
}

function isStableSemver(value: string): boolean {
  return STABLE_SEMVER.test(value)
}

function compareStableSemver(left: string, right: string): number {
  const leftParts = left.split('.').map(Number)
  const rightParts = right.split('.').map(Number)

  for (let index = 0; index < leftParts.length; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0)
    if (difference !== 0) return difference
  }

  return 0
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

  public stop(): void {
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
    const provider = this.getProvider()
    this.publish({
      errorCode: null,
      lastCheckedAt: this.getNow(),
      phase: 'checking',
      progress: null,
    })
    this.checkPromise = provider
      .checkForUpdates()
      .catch((error: unknown) => {
        if (this.isActiveGeneration(generation)) {
          this.publish({ errorCode: sanitizeErrorCode(error), phase: 'failed' })
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
    this.downloadPromise = provider
      .downloadUpdate()
      .catch((error: unknown) => {
        if (this.isActiveGeneration(generation)) {
          this.publish({ errorCode: sanitizeErrorCode(error), phase: 'failed' })
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
        this.publish({ phase: 'idle', progress: null, targetVersion: null })
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
        compareStableSemver(version, this.snapshot.currentVersion) <= 0
      ) {
        this.publish({ errorCode: 'invalid-update', phase: 'failed' })
        return
      }
      this.publish({
        errorCode: null,
        phase: 'available',
        progress: null,
        targetVersion: version,
      })
      if (this.options.automaticDownloads ?? true) {
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
        this.publish({ errorCode: 'invalid-update', phase: 'failed' })
        return
      }
      this.publish({
        phase: 'downloaded',
        progress: { percent: 100, total: 0, transferred: 0 },
      })
    })
    provider.on('error', (error) => {
      if (
        this.isActiveGeneration(generation) &&
        (this.snapshot.phase === 'checking' ||
          this.snapshot.phase === 'downloading')
      ) {
        this.publish({ errorCode: sanitizeErrorCode(error), phase: 'failed' })
      }
    })
    return provider
  }

  private createElectronProvider(): UpdateProvider {
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
      checkForUpdates: () => autoUpdater.checkForUpdates(),
      downloadUpdate: () => autoUpdater.downloadUpdate(),
      on: (event, listener) => {
        autoUpdater.on(event as never, listener as never)
      },
    }
  }

  private isActiveGeneration(generation: number): boolean {
    return generation === this.operationGeneration
  }

  private resolveCapability(): UpdateCapability {
    if (!this.options.app.isPackaged) return 'development'
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

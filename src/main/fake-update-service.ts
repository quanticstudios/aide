import {
  type UpdateEvent,
  type UpdatePreferencesEvent,
  type UpdatePreferencesInput,
  type UpdatePreferencesSnapshot,
  type UpdateRestartStatus,
  type UpdateSnapshot,
  UPDATE_SCHEMA_VERSION,
} from '../shared/update'
import type { UpdateStateStore, UpdateStopOptions } from './update-manager'

interface FakeUpdateServiceOptions {
  readonly activeManagedSessions?: number
  readonly activeTerminalSessions?: number
  readonly activeWorkspaceSetups?: number
  readonly checkFailures?: number
  readonly currentVersion: string
  readonly downloadFailures?: number
  readonly initialUpdateAvailable?: boolean
  readonly onUpdate: (event: UpdateEvent) => void
  readonly preferenceFailures?: number
  readonly restartFailures?: number
  readonly snapshotFailures?: number
  readonly store: UpdateStateStore
  readonly targetVersion?: string
  readonly urgency?: 'critical' | 'normal'
  readonly wait?: (delayMs: number) => Promise<void>
}

export function isFakeUpdateServiceEnabled(
  isPackaged: boolean,
  environmentValue: string | undefined,
): boolean {
  return !isPackaged && environmentValue === '1'
}

function nonNegativeInteger(value: number | undefined): number {
  return Number.isInteger(value) && (value ?? 0) > 0 ? (value ?? 0) : 0
}

export class FakeUpdateService {
  private checkFailures: number
  private downloadFailures: number
  private preferenceFailures: number
  private restartFailures: number
  private snapshotFailures: number
  private readonly preferenceSubscribers = new Set<
    (event: UpdatePreferencesEvent) => void
  >()
  private snapshot: UpdateSnapshot

  public constructor(private readonly options: FakeUpdateServiceOptions) {
    this.checkFailures = nonNegativeInteger(options.checkFailures)
    this.downloadFailures = nonNegativeInteger(options.downloadFailures)
    this.preferenceFailures = nonNegativeInteger(options.preferenceFailures)
    this.restartFailures = nonNegativeInteger(options.restartFailures)
    this.snapshotFailures = nonNegativeInteger(options.snapshotFailures)
    this.snapshot = {
      capability: 'supported',
      currentVersion: options.currentVersion,
      errorCode: null,
      lastCheckedAt: null,
      phase: options.initialUpdateAvailable ? 'available' : 'idle',
      progress: null,
      revision: 0,
      schemaVersion: UPDATE_SCHEMA_VERSION,
      targetVersion: options.initialUpdateAvailable
        ? (options.targetVersion ?? '9.9.9')
        : null,
      urgency: options.initialUpdateAvailable
        ? (options.urgency ?? 'normal')
        : null,
    }
  }

  public getSnapshot(): UpdateSnapshot {
    if (this.snapshotFailures > 0) {
      this.snapshotFailures -= 1
      throw new Error('Injected update snapshot failure.')
    }
    return this.cloneSnapshot()
  }

  private cloneSnapshot(): UpdateSnapshot {
    return {
      ...this.snapshot,
      progress: this.snapshot.progress && { ...this.snapshot.progress },
    }
  }

  public getPreferences(): UpdatePreferencesSnapshot {
    return (
      this.options.store.getUpdatePreferences?.() ?? {
        automaticDownloads: true,
        healthDisclosureAcknowledged: false,
        healthReportingEnabled: true,
        revision: 0,
        snoozedUntil: null,
      }
    )
  }

  public subscribePreferences(
    listener: (event: UpdatePreferencesEvent) => void,
  ): () => void {
    this.preferenceSubscribers.add(listener)
    return () => this.preferenceSubscribers.delete(listener)
  }

  public updatePreferences(
    input: UpdatePreferencesInput,
  ): UpdatePreferencesSnapshot {
    if (this.preferenceFailures > 0) {
      this.preferenceFailures -= 1
      throw new Error('Injected update preference failure.')
    }

    const snapshot =
      this.options.store.updateUpdatePreferences?.(input) ??
      this.getPreferences()
    const event = { revision: snapshot.revision, snapshot }
    for (const listener of this.preferenceSubscribers) listener(event)
    return snapshot
  }

  public async checkForUpdates(): Promise<UpdateSnapshot> {
    if (this.checkFailures > 0) {
      this.checkFailures -= 1
      throw new Error('Injected update check failure.')
    }

    this.publish({
      errorCode: null,
      lastCheckedAt: new Date().toISOString(),
      phase: 'checking',
      progress: null,
      targetVersion: null,
      urgency: null,
    })
    await this.wait()
    this.publish({
      phase: 'available',
      targetVersion: this.options.targetVersion ?? '9.9.9',
      urgency: this.options.urgency ?? 'normal',
    })
    return this.cloneSnapshot()
  }

  public async downloadUpdate(): Promise<UpdateSnapshot> {
    if (this.snapshot.phase !== 'available') return this.cloneSnapshot()

    this.publish({
      errorCode: null,
      phase: 'downloading',
      progress: { percent: 10, total: 100, transferred: 10 },
    })
    await this.wait()
    this.publish({
      progress: { percent: 50, total: 100, transferred: 50 },
    })
    await this.wait()
    if (this.downloadFailures > 0) {
      this.downloadFailures -= 1
      this.publish({ errorCode: 'network', phase: 'failed', progress: null })
      return this.cloneSnapshot()
    }

    this.publish({
      phase: 'downloaded',
      progress: { percent: 100, total: 100, transferred: 100 },
    })
    return this.cloneSnapshot()
  }

  public requestRestart(confirmed: boolean): Promise<UpdateRestartStatus> {
    if (this.restartFailures > 0) {
      this.restartFailures -= 1
      return Promise.reject(new Error('Injected update restart failure.'))
    }

    const status = {
      activeManagedSessions: nonNegativeInteger(
        this.options.activeManagedSessions,
      ),
      activeTerminalSessions: nonNegativeInteger(
        this.options.activeTerminalSessions,
      ),
      activeWorkspaceSetups: nonNegativeInteger(
        this.options.activeWorkspaceSetups,
      ),
      confirmationRequired: false,
      restarting: false,
    }
    const hasActiveWork =
      status.activeManagedSessions +
        status.activeTerminalSessions +
        status.activeWorkspaceSetups >
      0
    if (hasActiveWork && !confirmed) {
      return Promise.resolve({ ...status, confirmationRequired: true })
    }
    return Promise.resolve({ ...status, restarting: true })
  }

  public startAutomaticChecks(): void {}

  public stop(_options: UpdateStopOptions = {}): void {}

  private async wait(): Promise<void> {
    if (this.options.wait) {
      await this.options.wait(25)
      return
    }
    await new Promise<void>((resolve) => setTimeout(resolve, 25))
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
    this.options.onUpdate({
      revision: this.snapshot.revision,
      snapshot: this.cloneSnapshot(),
    })
  }
}

import type { ApplicationShutdownReason } from './application-runtime'
import type { UpdateRestartStatus } from '../shared/update'

export interface QuiesceableManagedSessions {
  beginQuiescing: () => () => void
  getActiveSessionCount: () => number
}

export interface QuiesceableTerminals {
  beginQuiescing: () => () => void
  getActiveSessionCount: () => number
}

export interface QuiesceableWorkspaceSetups {
  beginQuiescing: () => () => void
  getActiveSetupCount: () => number
}

export interface InstallableUpdate {
  markInstallStarted: () => void
  quitAndInstall: () => void
  releaseFileMatchesVerifiedIdentity: () => Promise<boolean>
  revalidateDownloadedUpdate: () => Promise<boolean>
}

export interface UpdateRestartCoordinatorOptions {
  applicationRuntime: {
    shutdown: (reason: ApplicationShutdownReason) => Promise<void>
  }
  managedSessions: QuiesceableManagedSessions
  terminals: QuiesceableTerminals
  /** Ends the now-shut-down process without ever invoking the updater. */
  terminateAfterShutdownFailure: () => void
  updates: InstallableUpdate
  workspaceSetups: QuiesceableWorkspaceSetups
}

/** Serializes the only path that may call electron-updater.quitAndInstall(). */
export class UpdateRestartCoordinator {
  private restartPromise: Promise<UpdateRestartStatus> | null = null

  public constructor(
    private readonly options: UpdateRestartCoordinatorOptions,
  ) {}

  public requestRestart(confirmed: boolean): Promise<UpdateRestartStatus> {
    if (this.restartPromise) return this.restartPromise

    const current = this.getStatus(false)
    if (!confirmed && this.hasActiveWork(current)) {
      return Promise.resolve({ ...current, confirmationRequired: true })
    }

    this.restartPromise = this.restart(confirmed)
    return this.restartPromise
  }

  private async restart(confirmed: boolean): Promise<UpdateRestartStatus> {
    const releases = [
      this.options.managedSessions.beginQuiescing(),
      this.options.terminals.beginQuiescing(),
      this.options.workspaceSetups.beginQuiescing(),
    ]
    const rechecked = this.getStatus(true)
    if (!confirmed && this.hasActiveWork(rechecked)) {
      for (const release of releases.reverse()) release()
      this.restartPromise = null
      return { ...rechecked, confirmationRequired: true, restarting: false }
    }

    if (!(await this.options.updates.revalidateDownloadedUpdate())) {
      for (const release of releases.reverse()) release()
      this.restartPromise = null
      throw new Error('Update can no longer be installed safely.')
    }

    try {
      this.options.updates.markInstallStarted()
    } catch (error) {
      for (const release of releases.reverse()) release()
      this.restartPromise = null
      throw error
    }
    try {
      await this.options.applicationRuntime.shutdown('update-install')
    } catch (error) {
      // Shutdown can reject after it has already closed part of the runtime.
      // The persisted install marker must not leave this partial process alive.
      this.options.terminateAfterShutdownFailure()
      throw error
    }
    if (!(await this.options.updates.releaseFileMatchesVerifiedIdentity())) {
      this.options.terminateAfterShutdownFailure()
      throw new Error('Downloaded update changed before installation.')
    }
    this.options.updates.quitAndInstall()
    return this.getStatus(true)
  }

  private getStatus(restarting: boolean): UpdateRestartStatus {
    return {
      activeManagedSessions:
        this.options.managedSessions.getActiveSessionCount(),
      activeTerminalSessions: this.options.terminals.getActiveSessionCount(),
      activeWorkspaceSetups: this.options.workspaceSetups.getActiveSetupCount(),
      confirmationRequired: false,
      restarting,
    }
  }

  private hasActiveWork(status: UpdateRestartStatus): boolean {
    return (
      status.activeManagedSessions > 0 ||
      status.activeTerminalSessions > 0 ||
      status.activeWorkspaceSetups > 0
    )
  }
}

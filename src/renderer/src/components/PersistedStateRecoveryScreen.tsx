import { useState } from 'react'

import type { AideApi } from '../../../shared/ipc'
import type { PersistedStateRecovery } from '../../../shared/recovery'

interface PersistedStateRecoveryScreenProps {
  api: AideApi
  recovery: PersistedStateRecovery
}

function getReasonLabel(reason: PersistedStateRecovery['reason']): string {
  switch (reason) {
    case 'bootstrap-failed':
      return 'The saved application state could not be loaded safely.'
    case 'integrity-check-failed':
      return 'The SQLite integrity check failed.'
    case 'migration-failed':
      return 'A database migration could not be completed.'
    case 'backup-failed':
      return 'A required safety backup could not be created.'
    case 'recovery-transaction-failed':
      return 'An interrupted recovery action could not be reconciled safely.'
  }
}

function getRestoreLabel(
  recommendedBackup: PersistedStateRecovery['recommendedBackup'],
): string {
  return recommendedBackup === 'pre-migration'
    ? 'Restore pre-migration backup'
    : 'Restore latest known-good backup'
}

function canRetry(reason: PersistedStateRecovery['reason']): boolean {
  return (
    reason === 'backup-failed' ||
    reason === 'bootstrap-failed' ||
    reason === 'recovery-transaction-failed'
  )
}

export default function PersistedStateRecoveryScreen({
  api,
  recovery,
}: PersistedStateRecoveryScreenProps) {
  const [actionError, setActionError] = useState<string | null>(null)
  const [isResetConfirmationVisible, setIsResetConfirmationVisible] =
    useState(false)
  const [isWorking, setIsWorking] = useState(false)

  const runAction = async (action: () => Promise<void>) => {
    setActionError(null)
    setIsWorking(true)
    try {
      await action()
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Recovery action failed.',
      )
    } finally {
      setIsWorking(false)
    }
  }

  return (
    <main className="recovery-screen" data-testid="persisted-state-recovery">
      <section aria-labelledby="recovery-title" className="recovery-card">
        <p className="recovery-eyebrow">Safe mode</p>
        <h1 id="recovery-title">Aide could not safely open its saved data</h1>
        <p>{getReasonLabel(recovery.reason)}</p>
        <p className="recovery-message">{recovery.message}</p>
        {recovery.recommendedBackup === 'pre-migration' ? (
          <p>
            The failed startup may have changed the working database. The fresh
            pre-migration backup is available to restore.
          </p>
        ) : (
          <p>
            No data has been changed. Choose a recovery action, or quit and keep
            the files exactly as they are.
          </p>
        )}
        {actionError ? (
          <p aria-live="polite" className="recovery-error" role="alert">
            {actionError}
          </p>
        ) : null}
        <div className="recovery-actions">
          {canRetry(recovery.reason) ? (
            <button
              disabled={isWorking}
              onClick={() => runAction(() => api.retryPersistedStateRecovery())}
              type="button"
            >
              Retry startup
            </button>
          ) : null}
          <button
            disabled={isWorking || !recovery.recommendedBackup}
            onClick={() => runAction(() => api.restorePersistedStateBackup())}
            type="button"
          >
            {getRestoreLabel(recovery.recommendedBackup)}
          </button>
          <button
            disabled={isWorking}
            onClick={() => runAction(() => api.openPersistedStateDataFolder())}
            type="button"
          >
            Open data folder
          </button>
          <button
            disabled={isWorking}
            onClick={() => runAction(() => api.quitPersistedStateRecovery())}
            type="button"
          >
            Quit
          </button>
        </div>
        {isResetConfirmationVisible ? (
          <div className="recovery-reset-confirmation">
            <p>
              Reset creates a new empty database. The current damaged database
              will first be saved in a timestamped backup.
            </p>
            <button
              className="recovery-reset-confirm-button"
              disabled={isWorking}
              onClick={() => runAction(() => api.resetPersistedState())}
              type="button"
            >
              Reset and preserve damaged database
            </button>
            <button
              disabled={isWorking}
              onClick={() => setIsResetConfirmationVisible(false)}
              type="button"
            >
              Cancel reset
            </button>
          </div>
        ) : (
          <button
            className="recovery-reset-button"
            disabled={isWorking}
            onClick={() => setIsResetConfirmationVisible(true)}
            type="button"
          >
            Reset saved data…
          </button>
        )}
      </section>
    </main>
  )
}

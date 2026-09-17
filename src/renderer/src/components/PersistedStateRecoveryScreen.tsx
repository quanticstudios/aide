import { useState } from 'react'

import type { AideApi } from '../../../shared/ipc'
import type { PersistedStateRecovery } from '../../../shared/recovery'

interface PersistedStateRecoveryScreenProps {
  api: AideApi
  recovery: PersistedStateRecovery
}

function getReasonLabel(reason: PersistedStateRecovery['reason']): string {
  switch (reason) {
    case 'integrity-check-failed':
      return 'The SQLite integrity check failed.'
    case 'migration-failed':
      return 'A database migration could not be completed.'
    case 'backup-failed':
      return 'A required safety backup could not be created.'
    case 'future-schema':
      return 'This database was created by a newer version of Aide.'
  }
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
        <p>
          Aide has paused startup. Restore a backup, reset saved data, or quit
          to inspect the files.
        </p>
        {actionError ? (
          <p aria-live="polite" className="recovery-error" role="alert">
            {actionError}
          </p>
        ) : null}
        <div className="recovery-actions">
          <button
            disabled={isWorking || !recovery.knownGoodBackupPath}
            onClick={() =>
              runAction(() => api.restoreKnownGoodPersistedState())
            }
            type="button"
          >
            Restore latest known-good backup
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

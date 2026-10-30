export type PersistedStateRecoveryReason =
  | 'bootstrap-failed'
  | 'integrity-check-failed'
  | 'migration-failed'
  | 'backup-failed'
  | 'recovery-transaction-failed'

export type PersistedStateRecoveryBackup = 'known-good' | 'pre-migration'

export interface PersistedStateRecovery {
  message: string
  recommendedBackup: PersistedStateRecoveryBackup | null
  reason: PersistedStateRecoveryReason
}

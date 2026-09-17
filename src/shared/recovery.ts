export type PersistedStateRecoveryReason =
  | 'integrity-check-failed'
  | 'migration-failed'
  | 'backup-failed'
  | 'future-schema'

export interface PersistedStateRecovery {
  dataDirectory: string
  databasePath: string
  knownGoodBackupPath: string | null
  message: string
  preMigrationBackupPath: string | null
  reason: PersistedStateRecoveryReason
}

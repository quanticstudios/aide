import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  rmSync,
} from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type {
  PersistedStateRecovery,
  PersistedStateRecoveryReason,
} from '../shared/recovery'
import {
  AIDE_DATABASE_SCHEMA_VERSION,
  type AideDatabase,
  createAideDatabase,
} from './database'

const RECOVERY_DIRECTORY_NAME = 'recovery'

export type PersistedStateStartupResult =
  | {
      database: AideDatabase
      knownGoodBackupPath: string
      preMigrationBackupPath: string | null
      status: 'ready'
    }
  | {
      recovery: PersistedStateRecovery
      status: 'recovery'
    }

interface RecoveryPaths {
  dataDirectory: string
  databasePath: string
  knownGoodBackupPath: string
  recoveryDirectory: string
}

interface PreparePersistedStateOptions {
  createDatabase?: (databasePath: string) => AideDatabase
}

interface PersistedStateInspection {
  message?: string
  ok: boolean
  schemaVersion?: number
}

export interface PersistedStateRestoreResult {
  damagedBackupPath: string
}

function getRecoveryPaths(databasePath: string): RecoveryPaths {
  const resolvedDatabasePath = path.resolve(databasePath)
  const dataDirectory = path.dirname(resolvedDatabasePath)
  const recoveryDirectory = path.join(dataDirectory, RECOVERY_DIRECTORY_NAME)
  const knownGoodBackupPath = path.join(
    recoveryDirectory,
    `${path.basename(resolvedDatabasePath)}.known-good`,
  )

  assertContainedPath(dataDirectory, recoveryDirectory)
  assertContainedPath(dataDirectory, knownGoodBackupPath)

  return {
    dataDirectory,
    databasePath: resolvedDatabasePath,
    knownGoodBackupPath,
    recoveryDirectory,
  }
}

function assertContainedPath(parentPath: string, candidatePath: string): void {
  const relativePath = path.relative(parentPath, candidatePath)

  if (
    relativePath === '' ||
    relativePath.startsWith(`..${path.sep}`) ||
    relativePath === '..' ||
    path.isAbsolute(relativePath)
  ) {
    throw new Error('Recovery files must remain inside the data directory.')
  }
}

function formatTimestamp(): string {
  return new Date().toISOString().replaceAll(/[:.]/g, '-')
}

function getTimestampedBackupPath(
  paths: RecoveryPaths,
  kind: 'before-migration' | 'damaged',
): string {
  const backupPath = path.join(
    paths.recoveryDirectory,
    `${path.basename(paths.databasePath)}.${kind}-${formatTimestamp()}-${randomUUID()}`,
  )

  assertContainedPath(paths.dataDirectory, backupPath)
  return backupPath
}

function quoteSqliteString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

function createConsistentBackup(
  sourcePath: string,
  destinationPath: string,
): void {
  mkdirSync(path.dirname(destinationPath), { recursive: true })
  const temporaryPath = `${destinationPath}.partial-${randomUUID()}`
  const source = new DatabaseSync(sourcePath)

  try {
    source.exec(`VACUUM INTO ${quoteSqliteString(temporaryPath)};`)
    renameSync(temporaryPath, destinationPath)
  } finally {
    source.close()
    rmSync(temporaryPath, { force: true })
  }
}

function copyDamagedDatabase(
  sourcePath: string,
  destinationPath: string,
): void {
  mkdirSync(path.dirname(destinationPath), { recursive: true })
  copyFileSync(sourcePath, destinationPath, 0)

  for (const suffix of ['-wal', '-shm']) {
    const sourceSidecar = `${sourcePath}${suffix}`

    if (existsSync(sourceSidecar)) {
      copyFileSync(sourceSidecar, `${destinationPath}${suffix}`, 0)
    }
  }
}

function removeDatabaseAndSidecars(databasePath: string): void {
  rmSync(databasePath, { force: true })
  rmSync(`${databasePath}-wal`, { force: true })
  rmSync(`${databasePath}-shm`, { force: true })
}

function inspectDatabase(databasePath: string): PersistedStateInspection {
  if (!existsSync(databasePath)) {
    return { ok: true, schemaVersion: 0 }
  }

  let database: DatabaseSync | null = null
  try {
    database = new DatabaseSync(databasePath, { readOnly: true })
    const rows = database.prepare('PRAGMA integrity_check;').all() as Array<{
      integrity_check: string
    }>
    const failedRow = rows.find((row) => row.integrity_check !== 'ok')

    if (failedRow) {
      return { message: failedRow.integrity_check, ok: false }
    }

    const schemaVersion = database.prepare('PRAGMA user_version;').get() as {
      user_version: number
    }

    return { ok: true, schemaVersion: schemaVersion.user_version }
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : 'Unknown SQLite error.',
      ok: false,
    }
  } finally {
    database?.close()
  }
}

export function inspectPersistedState(
  databasePath: string,
): PersistedStateInspection {
  return inspectDatabase(path.resolve(databasePath))
}

function createRecovery(
  paths: RecoveryPaths,
  input: {
    message: string
    preMigrationBackupPath: string | null
    reason: PersistedStateRecoveryReason
  },
): PersistedStateStartupResult {
  return {
    recovery: {
      dataDirectory: paths.dataDirectory,
      databasePath: paths.databasePath,
      knownGoodBackupPath: existsSync(paths.knownGoodBackupPath)
        ? paths.knownGoodBackupPath
        : null,
      message: input.message,
      preMigrationBackupPath: input.preMigrationBackupPath,
      reason: input.reason,
    },
    status: 'recovery',
  }
}

export function preparePersistedState(
  databasePath: string,
  options: PreparePersistedStateOptions = {},
): PersistedStateStartupResult {
  const paths = getRecoveryPaths(databasePath)
  const inspection = inspectDatabase(paths.databasePath)

  if (!inspection.ok) {
    return createRecovery(paths, {
      message: inspection.message ?? 'SQLite integrity check failed.',
      preMigrationBackupPath: null,
      reason: 'integrity-check-failed',
    })
  }

  let preMigrationBackupPath: string | null = null
  if (
    existsSync(paths.databasePath) &&
    (inspection.schemaVersion ?? 0) < AIDE_DATABASE_SCHEMA_VERSION
  ) {
    preMigrationBackupPath = getTimestampedBackupPath(paths, 'before-migration')
    try {
      createConsistentBackup(paths.databasePath, preMigrationBackupPath)
    } catch (error) {
      return createRecovery(paths, {
        message:
          error instanceof Error
            ? error.message
            : 'Could not create a pre-migration backup.',
        preMigrationBackupPath: null,
        reason: 'backup-failed',
      })
    }
  }

  let database: AideDatabase
  try {
    database = (options.createDatabase ?? createAideDatabase)(
      paths.databasePath,
    )
  } catch (error) {
    return createRecovery(paths, {
      message:
        error instanceof Error ? error.message : 'Database migration failed.',
      preMigrationBackupPath,
      reason: 'migration-failed',
    })
  }

  try {
    createConsistentBackup(paths.databasePath, paths.knownGoodBackupPath)
  } catch (error) {
    database.close()
    return createRecovery(paths, {
      message:
        error instanceof Error
          ? error.message
          : 'Could not create a known-good backup.',
      preMigrationBackupPath,
      reason: 'backup-failed',
    })
  }

  return {
    database,
    knownGoodBackupPath: paths.knownGoodBackupPath,
    preMigrationBackupPath,
    status: 'ready',
  }
}

export function restoreKnownGoodPersistedState(
  databasePath: string,
): PersistedStateRestoreResult {
  const paths = getRecoveryPaths(databasePath)

  if (!existsSync(paths.knownGoodBackupPath)) {
    throw new Error('No known-good backup is available to restore.')
  }

  const backupInspection = inspectDatabase(paths.knownGoodBackupPath)
  if (!backupInspection.ok) {
    throw new Error(
      `The known-good backup failed integrity checks: ${backupInspection.message ?? 'Unknown SQLite error.'}`,
    )
  }

  const restoredTemporaryPath = `${paths.databasePath}.restore-${randomUUID()}`
  copyFileSync(paths.knownGoodBackupPath, restoredTemporaryPath, 0)

  try {
    const damagedBackupPath = getTimestampedBackupPath(paths, 'damaged')
    if (existsSync(paths.databasePath)) {
      copyDamagedDatabase(paths.databasePath, damagedBackupPath)
    }

    rmSync(`${paths.databasePath}-wal`, { force: true })
    rmSync(`${paths.databasePath}-shm`, { force: true })
    renameSync(restoredTemporaryPath, paths.databasePath)

    return { damagedBackupPath }
  } finally {
    rmSync(restoredTemporaryPath, { force: true })
  }
}

export function resetPersistedState(
  databasePath: string,
): PersistedStateRestoreResult {
  const paths = getRecoveryPaths(databasePath)
  const damagedBackupPath = getTimestampedBackupPath(paths, 'damaged')

  if (existsSync(paths.databasePath)) {
    copyDamagedDatabase(paths.databasePath, damagedBackupPath)
    removeDatabaseAndSidecars(paths.databasePath)
  }

  return { damagedBackupPath }
}

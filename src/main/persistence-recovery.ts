import { randomUUID } from 'node:crypto'
import {
  constants,
  copyFileSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readdirSync,
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

type BackupKind = 'before-migration' | 'damaged' | 'known-good'

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

  assertContainedPath(dataDirectory, recoveryDirectory)

  return {
    dataDirectory,
    databasePath: resolvedDatabasePath,
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

function getBackupPath(paths: RecoveryPaths, kind: BackupKind): string {
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

function isMissingPath(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}

function assertRegularFile(pathname: string, label: string): boolean {
  try {
    const stat = lstatSync(pathname)
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error(`${label} must be a regular file.`)
    }
    return true
  } catch (error) {
    if (isMissingPath(error)) {
      return false
    }
    throw error
  }
}

function ensureRecoveryDirectory(paths: RecoveryPaths): void {
  mkdirSync(paths.recoveryDirectory, { mode: 0o700, recursive: true })
  const stat = lstatSync(paths.recoveryDirectory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error('Recovery directory must be a directory.')
  }
}

function assertBackupPathAvailable(backupPath: string): void {
  if (assertRegularFile(backupPath, 'Recovery backup')) {
    throw new Error('Recovery backup path already exists.')
  }
}

function publishNewFile(temporaryPath: string, destinationPath: string): void {
  assertBackupPathAvailable(destinationPath)
  linkSync(temporaryPath, destinationPath)
  rmSync(temporaryPath, { force: true })
}

function createConsistentBackup(
  paths: RecoveryPaths,
  sourcePath: string,
  destinationPath: string,
): void {
  ensureRecoveryDirectory(paths)
  if (!assertRegularFile(sourcePath, 'Database')) {
    throw new Error('Database does not exist.')
  }
  assertBackupPathAvailable(destinationPath)

  const temporaryPath = `${destinationPath}.partial-${randomUUID()}`
  const source = new DatabaseSync(sourcePath)

  try {
    source.exec(`VACUUM INTO ${quoteSqliteString(temporaryPath)};`)
    publishNewFile(temporaryPath, destinationPath)
  } finally {
    source.close()
    rmSync(temporaryPath, { force: true })
  }
}

function copyDamagedDatabase(
  paths: RecoveryPaths,
  sourcePath: string,
  destinationPath: string,
): void {
  ensureRecoveryDirectory(paths)
  if (!assertRegularFile(sourcePath, 'Database')) {
    throw new Error('Database does not exist.')
  }
  assertBackupPathAvailable(destinationPath)
  copyFileSync(sourcePath, destinationPath, constants.COPYFILE_EXCL)

  for (const suffix of ['-wal', '-shm']) {
    const sourceSidecar = `${sourcePath}${suffix}`
    if (assertRegularFile(sourceSidecar, 'Database sidecar')) {
      copyFileSync(
        sourceSidecar,
        `${destinationPath}${suffix}`,
        constants.COPYFILE_EXCL,
      )
    }
  }
}

function removeRegularFile(pathname: string, label: string): void {
  if (assertRegularFile(pathname, label)) {
    rmSync(pathname)
  }
}

function inspectDatabase(databasePath: string): PersistedStateInspection {
  try {
    if (!assertRegularFile(databasePath, 'Database')) {
      return { ok: true, schemaVersion: 0 }
    }
  } catch (error) {
    return {
      message: error instanceof Error ? error.message : 'Unknown file error.',
      ok: false,
    }
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

interface KnownGoodBackup {
  modifiedAtMs: number
  path: string
}

function getKnownGoodBackups(paths: RecoveryPaths): KnownGoodBackup[] {
  if (!existsSync(paths.recoveryDirectory)) {
    return []
  }

  const directory = lstatSync(paths.recoveryDirectory)
  if (!directory.isDirectory() || directory.isSymbolicLink()) {
    return []
  }

  const prefix = `${path.basename(paths.databasePath)}.known-good-`
  return readdirSync(paths.recoveryDirectory, { withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.startsWith(prefix) &&
        !entry.name.includes('.partial-'),
    )
    .map((entry) => {
      const backupPath = path.join(paths.recoveryDirectory, entry.name)
      const backup = lstatSync(backupPath)
      if (!backup.isFile() || backup.isSymbolicLink()) {
        throw new Error('Known-good backup must be a regular file.')
      }
      return { modifiedAtMs: backup.mtimeMs, path: backupPath }
    })
    .sort(
      (left, right) =>
        left.modifiedAtMs - right.modifiedAtMs ||
        left.path.localeCompare(right.path),
    )
}

function getLatestKnownGoodBackupPath(paths: RecoveryPaths): string | null {
  try {
    const backup = getKnownGoodBackups(paths)
      .reverse()
      .find((candidate) => {
        const inspection = inspectDatabase(candidate.path)
        return (
          inspection.ok &&
          (inspection.schemaVersion ?? 0) <= AIDE_DATABASE_SCHEMA_VERSION
        )
      })

    return backup?.path ?? null
  } catch {
    return null
  }
}

function pruneKnownGoodBackups(paths: RecoveryPaths): void {
  const staleBackups = getKnownGoodBackups(paths).slice(0, -3)
  for (const backup of staleBackups) {
    if (assertRegularFile(backup.path, 'Known-good backup')) {
      rmSync(backup.path)
    }
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
      knownGoodBackupPath: getLatestKnownGoodBackupPath(paths),
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

  if ((inspection.schemaVersion ?? 0) > AIDE_DATABASE_SCHEMA_VERSION) {
    return createRecovery(paths, {
      message: 'This database was created by a newer version of Aide.',
      preMigrationBackupPath: null,
      reason: 'future-schema',
    })
  }

  let preMigrationBackupPath: string | null = null
  if (
    existsSync(paths.databasePath) &&
    (inspection.schemaVersion ?? 0) < AIDE_DATABASE_SCHEMA_VERSION
  ) {
    preMigrationBackupPath = getBackupPath(paths, 'before-migration')
    try {
      createConsistentBackup(paths, paths.databasePath, preMigrationBackupPath)
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

  const knownGoodBackupPath = getBackupPath(paths, 'known-good')
  try {
    createConsistentBackup(paths, paths.databasePath, knownGoodBackupPath)
    pruneKnownGoodBackups(paths)
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
    knownGoodBackupPath,
    preMigrationBackupPath,
    status: 'ready',
  }
}

export function restoreKnownGoodPersistedState(
  databasePath: string,
): PersistedStateRestoreResult {
  const paths = getRecoveryPaths(databasePath)
  const knownGoodBackupPath = getLatestKnownGoodBackupPath(paths)
  if (!knownGoodBackupPath) {
    throw new Error('No known-good backup is available to restore.')
  }

  const backupInspection = inspectDatabase(knownGoodBackupPath)
  if (!backupInspection.ok) {
    throw new Error(
      `The known-good backup failed integrity checks: ${backupInspection.message ?? 'Unknown SQLite error.'}`,
    )
  }

  const restoredTemporaryPath = `${paths.databasePath}.restore-${randomUUID()}`
  copyFileSync(
    knownGoodBackupPath,
    restoredTemporaryPath,
    constants.COPYFILE_EXCL,
  )

  try {
    if (!assertRegularFile(paths.databasePath, 'Database')) {
      throw new Error('Database does not exist.')
    }
    const damagedBackupPath = getBackupPath(paths, 'damaged')
    copyDamagedDatabase(paths, paths.databasePath, damagedBackupPath)

    removeRegularFile(`${paths.databasePath}-wal`, 'Database sidecar')
    removeRegularFile(`${paths.databasePath}-shm`, 'Database sidecar')
    if (assertRegularFile(paths.databasePath, 'Database')) {
      renameSync(restoredTemporaryPath, paths.databasePath)
    } else {
      publishNewFile(restoredTemporaryPath, paths.databasePath)
    }

    return { damagedBackupPath }
  } finally {
    rmSync(restoredTemporaryPath, { force: true })
  }
}

export function resetPersistedState(
  databasePath: string,
): PersistedStateRestoreResult {
  const paths = getRecoveryPaths(databasePath)
  if (!assertRegularFile(paths.databasePath, 'Database')) {
    throw new Error('Database does not exist.')
  }

  const damagedBackupPath = getBackupPath(paths, 'damaged')
  copyDamagedDatabase(paths, paths.databasePath, damagedBackupPath)
  removeRegularFile(`${paths.databasePath}-wal`, 'Database sidecar')
  removeRegularFile(`${paths.databasePath}-shm`, 'Database sidecar')
  removeRegularFile(paths.databasePath, 'Database')

  return { damagedBackupPath }
}

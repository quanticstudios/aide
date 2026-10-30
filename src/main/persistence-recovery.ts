import { randomUUID } from 'node:crypto'
import {
  closeSync,
  copyFileSync,
  existsSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import type {
  PersistedStateRecovery,
  PersistedStateRecoveryBackup,
  PersistedStateRecoveryReason,
} from '../shared/recovery'
import {
  AIDE_DATABASE_SCHEMA_VERSION,
  type AideDatabase,
  createAideDatabase,
} from './database'

const RECOVERY_DIRECTORY_NAME = 'recovery'
const RECOVERY_TRANSACTION_VERSION = 1

export type PersistedStateStartupResult =
  | {
      database: AideDatabase
      knownGoodBackupPath: string
      preMigrationBackupPath: string | null
      status: 'ready'
    }
  | {
      recovery: PersistedStateRecoveryState
      status: 'recovery'
    }

export interface PersistedStateRecoveryState extends PersistedStateRecovery {
  dataDirectory: string
  databasePath: string
  knownGoodBackupPath: string | null
  preMigrationBackupPath: string | null
}

export function toRendererPersistedStateRecovery(
  recovery: PersistedStateRecoveryState,
): PersistedStateRecovery {
  return {
    message: getRecoveryMessage(recovery.reason),
    recommendedBackup: recovery.recommendedBackup,
    reason: recovery.reason,
  }
}

interface RecoveryPaths {
  dataDirectory: string
  databasePath: string
  knownGoodBackupPath: string
  recoveryDirectory: string
  transactionPath: string
}

function getRecoveryMessage(reason: PersistedStateRecoveryReason): string {
  switch (reason) {
    case 'backup-failed':
      return 'A required safety backup could not be created.'
    case 'bootstrap-failed':
      return 'Saved application state could not be loaded safely.'
    case 'integrity-check-failed':
      return 'Saved application data failed a safety check.'
    case 'migration-failed':
      return 'Saved application data could not be migrated safely.'
    case 'recovery-transaction-failed':
      return 'An interrupted recovery action could not be reconciled safely.'
  }
}

interface PreparePersistedStateOptions {
  createDatabase?: (databasePath: string) => AideDatabase
}

interface PersistedStateInspection {
  message?: string
  ok: boolean
  schemaVersion?: number
}

type RecoveryTransactionOperation = 'reset' | 'restore'
export type RecoveryTransactionTransition =
  | 'prepared'
  | 'live-moved'
  | 'replacement-installed'

interface RecoveryTransaction {
  operation: RecoveryTransactionOperation
  rollbackBaseName: string
  stagedFileName: string | null
  state: RecoveryTransactionTransition
  version: typeof RECOVERY_TRANSACTION_VERSION
}

export interface PersistedStateRestoreResult {
  damagedBackupPath: string
}

/** Test-only interruption hook used to leave a durable state for restart tests. */
export class PersistedStateRecoveryInterruption extends Error {
  public constructor(transition: RecoveryTransactionTransition) {
    super(`Simulated interruption after ${transition}.`)
    this.name = 'PersistedStateRecoveryInterruption'
  }
}

export interface PersistedStateRestoreOptions {
  beforeInstall?: () => void
  interruptAfterTransition?: RecoveryTransactionTransition
  removeFile?: (pathname: string) => void
  renameFile?: (sourcePath: string, destinationPath: string) => void
}

function renameFile(
  sourcePath: string,
  destinationPath: string,
  options?: PersistedStateRestoreOptions,
): void {
  if (options?.renameFile) {
    options.renameFile(sourcePath, destinationPath)
    return
  }

  renameSync(sourcePath, destinationPath)
}

function getRecoveryPaths(databasePath: string): RecoveryPaths {
  const requestedDatabasePath = path.resolve(databasePath)
  assertRegularFileOrMissing(requestedDatabasePath, 'Database file')

  const dataDirectory = realpathSync(path.dirname(requestedDatabasePath))
  const resolvedDatabasePath = path.join(
    dataDirectory,
    path.basename(requestedDatabasePath),
  )
  const recoveryDirectory = path.join(dataDirectory, RECOVERY_DIRECTORY_NAME)
  const knownGoodBackupPath = path.join(
    recoveryDirectory,
    `${path.basename(resolvedDatabasePath)}.known-good`,
  )
  const transactionPath = path.join(
    recoveryDirectory,
    `${path.basename(resolvedDatabasePath)}.recovery-transaction.json`,
  )

  assertContainedPath(dataDirectory, recoveryDirectory)
  assertContainedPath(dataDirectory, knownGoodBackupPath)
  assertContainedPath(dataDirectory, transactionPath)
  assertDirectoryOrMissing(recoveryDirectory, 'Recovery directory')
  assertRegularFileOrMissing(knownGoodBackupPath, 'Known-good backup')
  assertRegularFileOrMissing(transactionPath, 'Recovery transaction')

  return {
    dataDirectory,
    databasePath: resolvedDatabasePath,
    knownGoodBackupPath,
    recoveryDirectory,
    transactionPath,
  }
}

function getLstat(pathname: string) {
  try {
    return lstatSync(pathname)
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return null
    }

    throw error
  }
}

function assertDirectoryOrMissing(pathname: string, description: string): void {
  const entry = getLstat(pathname)
  if (!entry) {
    return
  }

  if (entry.isSymbolicLink()) {
    throw new Error(`${description} must not be a symbolic link.`)
  }

  if (!entry.isDirectory()) {
    throw new Error(`${description} must be a directory.`)
  }

  const physicalPath = realpathSync(pathname)
  if (physicalPath !== pathname) {
    throw new Error(`${description} must remain at its canonical path.`)
  }
}

function assertRegularFileOrMissing(
  pathname: string,
  description: string,
): void {
  const entry = getLstat(pathname)
  if (!entry) {
    return
  }

  if (entry.isSymbolicLink()) {
    throw new Error(`${description} must not be a symbolic link.`)
  }

  if (!entry.isFile()) {
    throw new Error(`${description} must be a regular file.`)
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

function ensureRecoveryDirectory(paths: RecoveryPaths): void {
  const firstCreatedPath = mkdirSync(paths.recoveryDirectory, {
    recursive: true,
  })
  assertDirectoryOrMissing(paths.recoveryDirectory, 'Recovery directory')
  assertContainedPath(
    paths.dataDirectory,
    realpathSync(paths.recoveryDirectory),
  )
  if (firstCreatedPath !== undefined) {
    fsyncDirectory(paths.dataDirectory)
  }
  fsyncDirectory(paths.recoveryDirectory)
}

function fsyncFile(pathname: string): void {
  const descriptor = openSync(pathname, 'r')
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function fsyncDirectory(directory: string): void {
  const descriptor = openSync(directory, 'r')
  try {
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }
}

function removeFile(
  pathname: string,
  options?: PersistedStateRestoreOptions,
): void {
  if (options?.removeFile) {
    options.removeFile(pathname)
    return
  }

  rmSync(pathname, { force: true })
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
  assertRegularFileOrMissing(sourcePath, 'Database file')
  assertRegularFileOrMissing(destinationPath, 'Backup file')
  const temporaryPath = `${destinationPath}.partial-${randomUUID()}`
  const source = new DatabaseSync(sourcePath)

  try {
    source.exec(`VACUUM INTO ${quoteSqliteString(temporaryPath)};`)
    const inspection = inspectDatabase(temporaryPath)
    if (!inspection.ok) {
      throw new Error(
        `Backup failed integrity checks: ${inspection.message ?? 'Unknown SQLite error.'}`,
      )
    }
    fsyncFile(temporaryPath)
    renameSync(temporaryPath, destinationPath)
    fsyncDirectory(path.dirname(destinationPath))
  } finally {
    source.close()
    rmSync(temporaryPath, { force: true })
  }
}

function getExistingDatabaseBundlePaths(databasePath: string): string[] {
  const bundlePaths = [
    databasePath,
    `${databasePath}-wal`,
    `${databasePath}-shm`,
  ]

  for (const pathname of bundlePaths) {
    assertRegularFileOrMissing(pathname, 'Database recovery file')
  }

  return bundlePaths.filter((pathname) => existsSync(pathname))
}

function archiveDatabaseBundle(
  sourcePath: string,
  destinationPath: string,
): boolean {
  const sourcePaths = getExistingDatabaseBundlePaths(sourcePath)
  if (sourcePaths.length === 0) {
    return false
  }

  const copiedPaths: string[] = []
  try {
    for (const pathname of sourcePaths) {
      const suffix = pathname.slice(sourcePath.length)
      const copiedPath = `${destinationPath}${suffix}`
      copyFileSync(pathname, copiedPath, 0)
      fsyncFile(copiedPath)
      copiedPaths.push(copiedPath)
    }
    fsyncDirectory(path.dirname(destinationPath))
  } catch (error) {
    for (const copiedPath of copiedPaths) {
      rmSync(copiedPath, { force: true })
    }
    throw error
  }

  return true
}

function getTransactionPath(
  paths: RecoveryPaths,
  fileName: string,
  description: string,
): string {
  if (
    !fileName ||
    path.basename(fileName) !== fileName ||
    fileName.includes(path.sep)
  ) {
    throw new Error(`Invalid ${description} in recovery transaction.`)
  }

  const pathname = path.join(paths.recoveryDirectory, fileName)
  assertContainedPath(paths.recoveryDirectory, pathname)
  assertRegularFileOrMissing(pathname, description)
  return pathname
}

function getRollbackBasePath(
  paths: RecoveryPaths,
  transaction: RecoveryTransaction,
): string {
  return getTransactionPath(
    paths,
    transaction.rollbackBaseName,
    'Recovery rollback file',
  )
}

function getStagedPath(
  paths: RecoveryPaths,
  transaction: RecoveryTransaction,
): string | null {
  return transaction.stagedFileName
    ? getTransactionPath(
        paths,
        transaction.stagedFileName,
        'Staged recovery database',
      )
    : null
}

function moveDatabaseBundle(
  sourcePath: string,
  destinationPath: string,
  options?: PersistedStateRestoreOptions,
): void {
  for (const pathname of getExistingDatabaseBundlePaths(sourcePath)) {
    renameFile(
      pathname,
      `${destinationPath}${pathname.slice(sourcePath.length)}`,
      options,
    )
  }
  fsyncDirectory(path.dirname(sourcePath))
  fsyncDirectory(path.dirname(destinationPath))
}

function restoreDatabaseBundle(
  rollbackPath: string,
  destinationPath: string,
): void {
  for (const rollbackFilePath of getExistingDatabaseBundlePaths(rollbackPath)) {
    const destinationFilePath = `${destinationPath}${rollbackFilePath.slice(rollbackPath.length)}`
    if (!existsSync(destinationFilePath)) {
      renameSync(rollbackFilePath, destinationFilePath)
    }
  }
  fsyncDirectory(path.dirname(rollbackPath))
  fsyncDirectory(path.dirname(destinationPath))
}

function removeDatabaseBundle(
  databasePath: string,
  options?: PersistedStateRestoreOptions,
): void {
  for (const pathname of getExistingDatabaseBundlePaths(databasePath)) {
    removeFile(pathname, options)
  }
  fsyncDirectory(path.dirname(databasePath))
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

function validateDatabaseSnapshot(database: AideDatabase): void {
  const snapshot = database.getSnapshot()
  if (snapshot.schemaVersion !== AIDE_DATABASE_SCHEMA_VERSION) {
    throw new Error(
      `Database schema ${snapshot.schemaVersion} is not ready for Aide.`,
    )
  }
}

function validateLiveDatabaseSnapshot(databasePath: string): void {
  let database: AideDatabase | null = null
  try {
    database = createAideDatabase(databasePath)
    validateDatabaseSnapshot(database)
  } finally {
    database?.close()
  }
}

function validateStagedCandidate(stagedPath: string): void {
  const inspection = inspectDatabase(stagedPath)
  if (!inspection.ok) {
    throw new Error(
      `The staged recovery backup failed integrity checks: ${inspection.message ?? 'Unknown SQLite error.'}`,
    )
  }

  let database: AideDatabase | null = null
  try {
    database = createAideDatabase(stagedPath)
    validateDatabaseSnapshot(database)
  } finally {
    database?.close()
  }
  fsyncFile(stagedPath)
}

function isRecoveryCandidate(pathname: string | null): boolean {
  if (!pathname || !existsSync(pathname)) {
    return false
  }

  const inspection = inspectDatabase(pathname)
  if (
    !inspection.ok ||
    inspection.schemaVersion === undefined ||
    inspection.schemaVersion <= 0 ||
    inspection.schemaVersion > AIDE_DATABASE_SCHEMA_VERSION
  ) {
    return false
  }

  const verificationPath = `${pathname}.verify-${randomUUID()}`
  try {
    copyFileSync(pathname, verificationPath, 0)
    validateStagedCandidate(verificationPath)
    return true
  } catch {
    return false
  } finally {
    rmSync(verificationPath, { force: true })
    rmSync(`${verificationPath}-wal`, { force: true })
    rmSync(`${verificationPath}-shm`, { force: true })
  }
}

function parseRecoveryTransaction(value: unknown): RecoveryTransaction {
  if (!value || typeof value !== 'object') {
    throw new Error('Recovery transaction is malformed.')
  }

  const transaction = value as Partial<RecoveryTransaction>
  if (
    transaction.version !== RECOVERY_TRANSACTION_VERSION ||
    (transaction.operation !== 'restore' &&
      transaction.operation !== 'reset') ||
    (transaction.state !== 'prepared' &&
      transaction.state !== 'live-moved' &&
      transaction.state !== 'replacement-installed') ||
    typeof transaction.rollbackBaseName !== 'string' ||
    (transaction.stagedFileName !== null &&
      typeof transaction.stagedFileName !== 'string')
  ) {
    throw new Error('Recovery transaction is malformed.')
  }

  return {
    operation: transaction.operation,
    rollbackBaseName: transaction.rollbackBaseName,
    stagedFileName: transaction.stagedFileName,
    state: transaction.state,
    version: RECOVERY_TRANSACTION_VERSION,
  }
}

function writeRecoveryTransaction(
  paths: RecoveryPaths,
  transaction: RecoveryTransaction,
): void {
  const temporaryPath = `${paths.transactionPath}.partial-${randomUUID()}`
  const descriptor = openSync(temporaryPath, 'w', 0o600)
  try {
    writeFileSync(descriptor, `${JSON.stringify(transaction)}\n`, 'utf8')
    fsyncSync(descriptor)
  } finally {
    closeSync(descriptor)
  }

  renameSync(temporaryPath, paths.transactionPath)
  fsyncDirectory(paths.recoveryDirectory)
}

function removeRecoveryTransaction(paths: RecoveryPaths): void {
  rmSync(paths.transactionPath, { force: true })
  fsyncDirectory(paths.recoveryDirectory)
}

function readRecoveryTransaction(
  paths: RecoveryPaths,
): RecoveryTransaction | null {
  if (!existsSync(paths.transactionPath)) {
    return null
  }

  try {
    return parseRecoveryTransaction(
      JSON.parse(readFileSync(paths.transactionPath, 'utf8')),
    )
  } catch (error) {
    throw new Error(
      `Could not read the unfinished recovery transaction: ${error instanceof Error ? error.message : 'Unknown transaction error.'}`,
    )
  }
}

function completeReplacementInstall(
  paths: RecoveryPaths,
  transaction: RecoveryTransaction,
  options?: PersistedStateRestoreOptions,
): void {
  const rollbackPath = getRollbackBasePath(paths, transaction)
  const stagedPath = getStagedPath(paths, transaction)
  if (transaction.operation === 'restore' && !existsSync(paths.databasePath)) {
    if (getExistingDatabaseBundlePaths(rollbackPath).length === 0) {
      throw new Error(
        'The installed recovery database and rollback files are missing.',
      )
    }
    restoreDatabaseBundle(rollbackPath, paths.databasePath)
    if (stagedPath) {
      removeDatabaseBundle(stagedPath)
    }
    removeRecoveryTransaction(paths)
    return
  }

  removeDatabaseBundle(rollbackPath, options)
  if (stagedPath) {
    removeDatabaseBundle(stagedPath)
  }
  if (transaction.operation !== 'reset') {
    removeRecoveryTransaction(paths)
  }
}

function rollbackUnfinishedInstall(
  paths: RecoveryPaths,
  transaction: RecoveryTransaction,
): void {
  const rollbackPath = getRollbackBasePath(paths, transaction)
  const stagedPath = getStagedPath(paths, transaction)
  const candidateInstalled =
    transaction.operation === 'restore' &&
    !existsSync(stagedPath ?? '') &&
    existsSync(paths.databasePath) &&
    getExistingDatabaseBundlePaths(rollbackPath).length > 0

  if (candidateInstalled) {
    transaction.state = 'replacement-installed'
    writeRecoveryTransaction(paths, transaction)
    completeReplacementInstall(paths, transaction)
    return
  }

  restoreDatabaseBundle(rollbackPath, paths.databasePath)
  if (stagedPath) {
    removeDatabaseBundle(stagedPath)
  }
  removeRecoveryTransaction(paths)
}

function reconcileOrphanedRecoveryFiles(paths: RecoveryPaths): void {
  if (!existsSync(paths.recoveryDirectory)) {
    return
  }

  const databaseBaseName = path.basename(paths.databasePath)
  const rollbackPrefix = `${databaseBaseName}.rollback-`
  const stagedPrefix = `${databaseBaseName}.restore-candidate-`
  const rollbackBases = new Set<string>()

  for (const entry of readdirSync(paths.recoveryDirectory)) {
    if (entry.startsWith(stagedPrefix)) {
      const stagedPath = getTransactionPath(
        paths,
        entry,
        'Staged recovery database',
      )
      rmSync(stagedPath, { force: true })
      continue
    }

    if (entry.startsWith(rollbackPrefix)) {
      const suffix = entry.endsWith('-wal') || entry.endsWith('-shm') ? 4 : 0
      rollbackBases.add(entry.slice(0, suffix ? -suffix : undefined))
    }
  }

  for (const rollbackBaseName of rollbackBases) {
    const rollbackPath = getTransactionPath(
      paths,
      rollbackBaseName,
      'Recovery rollback file',
    )
    const rollbackBundle = getExistingDatabaseBundlePaths(rollbackPath)
    if (rollbackBundle.length === 0) {
      continue
    }

    if (!existsSync(paths.databasePath)) {
      if (!existsSync(rollbackPath)) {
        throw new Error('Orphaned recovery sidecars have no rollback database.')
      }
      restoreDatabaseBundle(rollbackPath, paths.databasePath)
    } else {
      removeDatabaseBundle(rollbackPath)
    }
  }
  fsyncDirectory(paths.recoveryDirectory)
}

function reconcileRecoveryTransaction(paths: RecoveryPaths): boolean {
  const transaction = readRecoveryTransaction(paths)
  let committedReset = false
  if (transaction) {
    if (transaction.state === 'replacement-installed') {
      completeReplacementInstall(paths, transaction)
      committedReset = transaction.operation === 'reset'
    } else {
      rollbackUnfinishedInstall(paths, transaction)
    }
  } else {
    reconcileOrphanedRecoveryFiles(paths)
  }

  const primaryExists = existsSync(paths.databasePath)
  const orphanedSidecars = [
    `${paths.databasePath}-wal`,
    `${paths.databasePath}-shm`,
  ].filter((pathname) => existsSync(pathname))
  if (!primaryExists && orphanedSidecars.length > 0) {
    throw new Error('Orphaned SQLite sidecars were found without a database.')
  }

  return committedReset
}

function hasRecoveryArtifacts(paths: RecoveryPaths): boolean {
  return (
    existsSync(paths.recoveryDirectory) &&
    readdirSync(paths.recoveryDirectory).length > 0
  )
}

function createRecovery(
  paths: RecoveryPaths,
  input: {
    message: string
    preMigrationBackupPath: string | null
    reason: PersistedStateRecoveryReason
  },
): PersistedStateStartupResult {
  const preMigrationBackupPath = isRecoveryCandidate(
    input.preMigrationBackupPath,
  )
    ? input.preMigrationBackupPath
    : null
  const knownGoodBackupPath = isRecoveryCandidate(paths.knownGoodBackupPath)
    ? paths.knownGoodBackupPath
    : null
  const recommendedBackup: PersistedStateRecoveryBackup | null =
    preMigrationBackupPath
      ? 'pre-migration'
      : knownGoodBackupPath
        ? 'known-good'
        : null

  return {
    recovery: {
      dataDirectory: paths.dataDirectory,
      databasePath: paths.databasePath,
      knownGoodBackupPath,
      message: getRecoveryMessage(input.reason),
      preMigrationBackupPath,
      recommendedBackup,
      reason: input.reason,
    },
    status: 'recovery',
  }
}

export function inspectPersistedState(
  databasePath: string,
): PersistedStateInspection {
  return inspectDatabase(getRecoveryPaths(databasePath).databasePath)
}

export function reconcilePersistedStateRecovery(databasePath: string): boolean {
  const paths = getRecoveryPaths(databasePath)
  const committedReset = reconcileRecoveryTransaction(paths)
  if (
    !existsSync(paths.databasePath) &&
    !committedReset &&
    hasRecoveryArtifacts(paths)
  ) {
    throw new Error(
      'The database file is missing while recovery artifacts are still present.',
    )
  }
  return committedReset
}

export function preparePersistedState(
  databasePath: string,
  options: PreparePersistedStateOptions = {},
): PersistedStateStartupResult {
  const paths = getRecoveryPaths(databasePath)
  let committedReset = false
  try {
    committedReset = reconcilePersistedStateRecovery(paths.databasePath)
  } catch (error) {
    return createRecovery(paths, {
      message:
        error instanceof Error
          ? error.message
          : 'Could not reconcile an unfinished recovery transaction.',
      preMigrationBackupPath: null,
      reason: 'recovery-transaction-failed',
    })
  }

  if (
    !existsSync(paths.databasePath) &&
    !committedReset &&
    hasRecoveryArtifacts(paths)
  ) {
    return createRecovery(paths, {
      message:
        'The database file is missing while recovery artifacts are still present.',
      preMigrationBackupPath: null,
      reason: 'recovery-transaction-failed',
    })
  }

  if (committedReset) {
    removeRecoveryTransaction(paths)
  }

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
      ensureRecoveryDirectory(paths)
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

  let database: AideDatabase | null = null
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
    validateDatabaseSnapshot(database)
  } catch (error) {
    database.close()
    return createRecovery(paths, {
      message:
        error instanceof Error
          ? error.message
          : 'Persisted application state could not be loaded.',
      preMigrationBackupPath,
      reason: 'bootstrap-failed',
    })
  }

  return {
    database,
    knownGoodBackupPath: paths.knownGoodBackupPath,
    preMigrationBackupPath,
    status: 'ready',
  }
}

export function createInitialKnownGoodPersistedStateBackup(
  databasePath: string,
): string {
  const paths = getRecoveryPaths(databasePath)
  if (!existsSync(paths.knownGoodBackupPath)) {
    validateLiveDatabaseSnapshot(paths.databasePath)
    ensureRecoveryDirectory(paths)
    createConsistentBackup(paths.databasePath, paths.knownGoodBackupPath)
  }
  return paths.knownGoodBackupPath
}

export function createPersistedStateBootstrapFailure(
  databasePath: string,
  error: unknown,
  preMigrationBackupPath: string | null,
): PersistedStateStartupResult {
  const paths = getRecoveryPaths(databasePath)
  return createRecovery(paths, {
    message:
      error instanceof Error
        ? error.message
        : 'Aide services could not be initialized safely.',
    preMigrationBackupPath,
    reason: 'bootstrap-failed',
  })
}

export function refreshKnownGoodPersistedStateBackup(
  databasePath: string,
): string {
  const paths = getRecoveryPaths(databasePath)
  validateLiveDatabaseSnapshot(paths.databasePath)
  ensureRecoveryDirectory(paths)
  createConsistentBackup(paths.databasePath, paths.knownGoodBackupPath)
  return paths.knownGoodBackupPath
}

function installRecoveryTransaction(
  paths: RecoveryPaths,
  input: {
    operation: RecoveryTransactionOperation
    stagedPath: string | null
  },
  options: PersistedStateRestoreOptions,
): void {
  ensureRecoveryDirectory(paths)
  const transaction: RecoveryTransaction = {
    operation: input.operation,
    rollbackBaseName: `${path.basename(paths.databasePath)}.rollback-${randomUUID()}`,
    stagedFileName: input.stagedPath ? path.basename(input.stagedPath) : null,
    state: 'prepared',
    version: RECOVERY_TRANSACTION_VERSION,
  }
  const rollbackPath = getRollbackBasePath(paths, transaction)
  let replacementInstalled = false

  try {
    writeRecoveryTransaction(paths, transaction)
    if (options.interruptAfterTransition === 'prepared') {
      throw new PersistedStateRecoveryInterruption('prepared')
    }

    moveDatabaseBundle(paths.databasePath, rollbackPath, options)
    transaction.state = 'live-moved'
    writeRecoveryTransaction(paths, transaction)
    if (options.interruptAfterTransition === 'live-moved') {
      throw new PersistedStateRecoveryInterruption('live-moved')
    }

    if (input.operation === 'restore') {
      if (!input.stagedPath) {
        throw new Error('Recovery restore has no staged database.')
      }
      renameFile(input.stagedPath, paths.databasePath, options)
      fsyncDirectory(paths.dataDirectory)
    }

    transaction.state = 'replacement-installed'
    writeRecoveryTransaction(paths, transaction)
    replacementInstalled = true
    if (options.interruptAfterTransition === 'replacement-installed') {
      throw new PersistedStateRecoveryInterruption('replacement-installed')
    }

    completeReplacementInstall(paths, transaction, options)
  } catch (error) {
    if (
      error instanceof PersistedStateRecoveryInterruption ||
      replacementInstalled
    ) {
      throw error
    }

    try {
      reconcileRecoveryTransaction(paths)
    } catch (recoveryError) {
      throw new Error(
        `Recovery installation failed and could not be reconciled: ${recoveryError instanceof Error ? recoveryError.message : 'Unknown reconciliation error.'}`,
        { cause: error },
      )
    }
    throw error
  }
}

export function restoreKnownGoodPersistedState(
  databasePath: string,
  options: PersistedStateRestoreOptions = {},
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

  return restorePersistedStateBackup(
    databasePath,
    paths.knownGoodBackupPath,
    options,
  )
}

export function restorePersistedStateBackup(
  databasePath: string,
  backupPath: string,
  options: PersistedStateRestoreOptions = {},
): PersistedStateRestoreResult {
  const paths = getRecoveryPaths(databasePath)
  const resolvedBackupPath = path.resolve(backupPath)
  assertContainedPath(paths.recoveryDirectory, resolvedBackupPath)
  assertRegularFileOrMissing(resolvedBackupPath, 'Recovery backup')

  if (!existsSync(resolvedBackupPath)) {
    throw new Error('No recovery backup is available to restore.')
  }

  const backupInspection = inspectDatabase(resolvedBackupPath)
  if (!backupInspection.ok) {
    throw new Error(
      `The recovery backup failed integrity checks: ${backupInspection.message ?? 'Unknown SQLite error.'}`,
    )
  }

  ensureRecoveryDirectory(paths)
  const stagedPath = path.join(
    paths.recoveryDirectory,
    `${path.basename(paths.databasePath)}.restore-candidate-${randomUUID()}`,
  )
  const damagedBackupPath = getTimestampedBackupPath(paths, 'damaged')
  let leaveStagedCandidate = false

  try {
    copyFileSync(resolvedBackupPath, stagedPath, 0)
    fsyncFile(stagedPath)
    fsyncDirectory(paths.recoveryDirectory)
    validateStagedCandidate(stagedPath)
    archiveDatabaseBundle(paths.databasePath, damagedBackupPath)
    options.beforeInstall?.()
    installRecoveryTransaction(
      paths,
      { operation: 'restore', stagedPath },
      options,
    )
    return { damagedBackupPath }
  } catch (error) {
    leaveStagedCandidate = error instanceof PersistedStateRecoveryInterruption
    throw error
  } finally {
    if (
      !leaveStagedCandidate &&
      getExistingDatabaseBundlePaths(stagedPath).length > 0
    ) {
      removeDatabaseBundle(stagedPath)
    }
  }
}

export function resetPersistedState(
  databasePath: string,
  options: PersistedStateRestoreOptions = {},
): PersistedStateRestoreResult {
  const paths = getRecoveryPaths(databasePath)
  const damagedBackupPath = getTimestampedBackupPath(paths, 'damaged')

  ensureRecoveryDirectory(paths)
  if (getExistingDatabaseBundlePaths(paths.databasePath).length > 0) {
    archiveDatabaseBundle(paths.databasePath, damagedBackupPath)
  }
  installRecoveryTransaction(
    paths,
    { operation: 'reset', stagedPath: null },
    options,
  )
  return { damagedBackupPath }
}

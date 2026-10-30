import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it, vi } from 'vitest'

import { createAideDatabase } from './database'
import {
  createInitialKnownGoodPersistedStateBackup,
  createPersistedStateBootstrapFailure,
  inspectPersistedState,
  PersistedStateRecoveryInterruption,
  preparePersistedState,
  refreshKnownGoodPersistedStateBackup,
  resetPersistedState,
  restoreKnownGoodPersistedState,
  restorePersistedStateBackup,
  toRendererPersistedStateRecovery,
} from './persistence-recovery'

function createTemporaryDatabasePath(): { directory: string; path: string } {
  const directory = mkdtempSync(path.join(tmpdir(), 'aide-recovery-'))

  return { directory, path: path.join(directory, 'aide.sqlite3') }
}

describe('persisted-state recovery', () => {
  it('creates its first known-good backup only after bootstrap succeeds', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      const result = preparePersistedState(temporary.path)

      expect(result.status).toBe('ready')
      if (result.status !== 'ready') return

      expect(result.database.getSnapshot().projects).toEqual([])
      expect(existsSync(result.knownGoodBackupPath)).toBe(false)
      createInitialKnownGoodPersistedStateBackup(temporary.path)
      expect(existsSync(result.knownGoodBackupPath)).toBe(true)
      expect(inspectPersistedState(result.knownGoodBackupPath).ok).toBe(true)
      result.database.close()
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })

  it('refreshes the known-good backup with committed state before shutdown', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      const result = preparePersistedState(temporary.path)
      expect(result.status).toBe('ready')
      if (result.status !== 'ready') return

      result.database.createProject({
        defaultBranch: 'main',
        name: 'saved before shutdown',
        remoteUrl: null,
        repoRoot: '/workspace/saved',
      })

      const refreshedBackupPath = refreshKnownGoodPersistedStateBackup(
        temporary.path,
      )
      result.database.close()

      const backup = createAideDatabase(refreshedBackupPath)
      expect(backup.listProjects()).toHaveLength(1)
      backup.close()
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })

  it('rejects structurally invalid preview JSON before refresh preserves the prior known-good backup', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      const ready = preparePersistedState(temporary.path)
      expect(ready.status).toBe('ready')
      if (ready.status !== 'ready') return

      const project = ready.database.createProject({
        defaultBranch: 'main',
        name: 'known good',
        remoteUrl: null,
        repoRoot: '/workspace/known-good',
      })
      const workspace = ready.database.createWorkspace({
        branchName: 'main',
        name: 'main',
        projectId: project.id,
        windowId: null,
        worktreePath: '/workspace/known-good',
      })
      ready.database.saveWorkspacePreviewState({
        activeTabId: 'preview-1',
        initialized: true,
        revision: 1,
        tabs: [
          {
            canGoBack: false,
            canGoForward: false,
            error: null,
            id: 'preview-1',
            label: 'Preview',
            navStatus: 'idle',
            title: null,
            updatedAt: '2026-07-13T12:00:00.000Z',
            url: 'http://127.0.0.1:4173',
            workspaceId: workspace.id,
          },
        ],
        workspaceId: workspace.id,
      })
      const knownGoodBackupPath = createInitialKnownGoodPersistedStateBackup(
        temporary.path,
      )
      const knownGoodBeforeCorruption = readFileSync(knownGoodBackupPath)
      ready.database.close()

      const corrupted = new DatabaseSync(temporary.path)
      corrupted
        .prepare(
          "UPDATE workspace_preview_states SET tabs_json = '{}' WHERE workspace_id = ?",
        )
        .run(workspace.id)
      corrupted.close()

      expect(() =>
        refreshKnownGoodPersistedStateBackup(temporary.path),
      ).toThrow('Workspace preview tabs must be an array.')
      expect(readFileSync(knownGoodBackupPath)).toEqual(
        knownGoodBeforeCorruption,
      )

      expect(preparePersistedState(temporary.path)).toMatchObject({
        recovery: {
          reason: 'bootstrap-failed',
          recommendedBackup: 'known-good',
        },
        status: 'recovery',
      })
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })

  it('redacts SQLite and filesystem failures from the recovery payload', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      for (const rawError of [
        'SQLITE_CORRUPT: database disk image is malformed: /home/alice/.config/aide/aide.sqlite3',
        "EACCES: permission denied, mkdir '/home/alice/.config/aide/recovery'",
      ]) {
        const result = createPersistedStateBootstrapFailure(
          temporary.path,
          new Error(rawError),
          null,
        )

        expect(result).toMatchObject({
          recovery: {
            message: 'Saved application state could not be loaded safely.',
            reason: 'bootstrap-failed',
          },
          status: 'recovery',
        })
        if (result.status !== 'recovery') return
        const rendererPayload = toRendererPersistedStateRecovery(
          result.recovery,
        )
        expect(JSON.stringify(rendererPayload)).not.toContain('/home/alice')
        expect(JSON.stringify(rendererPayload)).not.toContain('SQLITE_')
        expect(JSON.stringify(rendererPayload)).not.toContain('EACCES')
        expect(JSON.stringify(rendererPayload)).not.toContain(temporary.path)
      }
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })

  it('enters bootstrap safe mode for malformed persisted JSON without replacing a prior known-good backup', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      const ready = preparePersistedState(temporary.path)
      expect(ready.status).toBe('ready')
      if (ready.status !== 'ready') return

      ready.database.createProject({
        defaultBranch: 'main',
        name: 'known good',
        remoteUrl: null,
        repoRoot: '/workspace/known-good',
      })
      createInitialKnownGoodPersistedStateBackup(temporary.path)
      ready.database.close()
      const corrupted = new DatabaseSync(temporary.path)
      corrupted
        .prepare(
          "UPDATE app_state SET last_active_workspace_ids_by_project = '{not json' WHERE id = 1",
        )
        .run()
      corrupted.close()

      const result = preparePersistedState(temporary.path)

      expect(result).toMatchObject({
        recovery: {
          reason: 'bootstrap-failed',
          recommendedBackup: 'known-good',
        },
        status: 'recovery',
      })
      const knownGood = createAideDatabase(
        path.join(temporary.directory, 'recovery', 'aide.sqlite3.known-good'),
      )
      expect(knownGood.listProjects()).toHaveLength(1)
      knownGood.close()
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })

  it('creates a backup before migrating an existing database', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      const database = createAideDatabase(temporary.path)
      database.close()

      const legacyDatabase = new DatabaseSync(temporary.path)
      legacyDatabase.exec('PRAGMA user_version = 5;')
      legacyDatabase.close()

      const result = preparePersistedState(temporary.path)

      expect(result.status).toBe('ready')
      if (result.status !== 'ready') return

      const backupPath = result.preMigrationBackupPath
      expect(backupPath).not.toBeNull()
      if (!backupPath) return
      expect(existsSync(backupPath)).toBe(true)
      expect(inspectPersistedState(backupPath).ok).toBe(true)
      expect(result.database.getSnapshot().schemaVersion).toBe(6)
      result.database.close()
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })

  it('enters safe mode for a corrupt database without replacing it', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      writeFileSync(temporary.path, 'not a sqlite database')

      const result = preparePersistedState(temporary.path)

      expect(result).toMatchObject({
        recovery: {
          databasePath: temporary.path,
          reason: 'integrity-check-failed',
        },
        status: 'recovery',
      })
      expect(readFileSync(temporary.path, 'utf8')).toBe('not a sqlite database')
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })

  it('enters safe mode when a migration fails and preserves the pre-migration backup', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      const database = createAideDatabase(temporary.path)
      database.close()

      const legacyDatabase = new DatabaseSync(temporary.path)
      legacyDatabase.exec('PRAGMA user_version = 5;')
      legacyDatabase.close()

      const result = preparePersistedState(temporary.path, {
        createDatabase: () => {
          throw new Error('migration failed')
        },
      })

      expect(result).toMatchObject({
        recovery: { reason: 'migration-failed' },
        status: 'recovery',
      })
      if (result.status !== 'recovery') return

      const backupPath = result.recovery.preMigrationBackupPath
      expect(backupPath).not.toBeNull()
      if (!backupPath) return
      expect(existsSync(backupPath)).toBe(true)
      expect(inspectPersistedState(backupPath).ok).toBe(true)
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })

  it('prefers the fresh verified pre-migration candidate over an older known-good backup after bootstrap fails', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      const original = createAideDatabase(temporary.path)
      original.createProject({
        defaultBranch: 'main',
        name: 'older known good',
        remoteUrl: null,
        repoRoot: '/workspace/older',
      })
      original.close()
      refreshKnownGoodPersistedStateBackup(temporary.path)

      const legacyDatabase = new DatabaseSync(temporary.path)
      legacyDatabase.exec('PRAGMA user_version = 5;')
      legacyDatabase.close()

      const result = preparePersistedState(temporary.path, {
        createDatabase: (databasePath) => {
          const migrated = createAideDatabase(databasePath)
          vi.spyOn(migrated, 'getSnapshot').mockImplementation(() => {
            throw new Error('injected bootstrap failure')
          })
          return migrated
        },
      })

      expect(result).toMatchObject({
        recovery: {
          reason: 'bootstrap-failed',
          recommendedBackup: 'pre-migration',
        },
        status: 'recovery',
      })
      if (result.status !== 'recovery') return
      expect(result.recovery.preMigrationBackupPath).not.toBeNull()
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })

  it('prefers and restores the pre-migration backup after a migration failure', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      const database = createAideDatabase(temporary.path)
      database.close()

      const legacyDatabase = new DatabaseSync(temporary.path)
      legacyDatabase.exec('PRAGMA user_version = 5;')
      legacyDatabase.close()

      const result = preparePersistedState(temporary.path, {
        createDatabase: (databasePath) => {
          const partiallyMigratedDatabase = new DatabaseSync(databasePath)
          partiallyMigratedDatabase.exec(
            'CREATE TABLE migration_failure_marker (value TEXT NOT NULL);',
          )
          partiallyMigratedDatabase.close()
          throw new Error('migration failed after writing')
        },
      })

      expect(result).toMatchObject({
        recovery: {
          reason: 'migration-failed',
          recommendedBackup: 'pre-migration',
        },
        status: 'recovery',
      })
      if (result.status !== 'recovery') return
      if (!result.recovery.preMigrationBackupPath) {
        throw new Error('expected a pre-migration backup')
      }

      restorePersistedStateBackup(
        temporary.path,
        result.recovery.preMigrationBackupPath,
      )

      const restored = new DatabaseSync(temporary.path, { readOnly: true })
      try {
        expect(
          restored
            .prepare(
              "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'migration_failure_marker'",
            )
            .get(),
        ).toBeUndefined()
        expect(
          (
            restored.prepare('PRAGMA user_version;').get() as {
              user_version: number
            }
          ).user_version,
        ).toBe(6)
      } finally {
        restored.close()
      }
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })

  it('restores a known-good backup atomically and archives the damaged database', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      const ready = preparePersistedState(temporary.path)
      expect(ready.status).toBe('ready')
      if (ready.status !== 'ready') return

      ready.database.createProject({
        defaultBranch: 'main',
        name: 'kept project',
        remoteUrl: null,
        repoRoot: '/workspace/kept',
      })
      ready.database.close()
      createInitialKnownGoodPersistedStateBackup(temporary.path)

      writeFileSync(temporary.path, 'damaged state')
      const restoration = restoreKnownGoodPersistedState(temporary.path)

      expect(existsSync(restoration.damagedBackupPath)).toBe(true)
      expect(readFileSync(restoration.damagedBackupPath, 'utf8')).toBe(
        'damaged state',
      )
      expect(inspectPersistedState(temporary.path).ok).toBe(true)

      const restored = createAideDatabase(temporary.path)
      expect(restored.listProjects()).toHaveLength(1)
      restored.close()
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })

  it('rolls back a failed restore without losing a working WAL database', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      const ready = preparePersistedState(temporary.path)
      expect(ready.status).toBe('ready')
      if (ready.status !== 'ready') return
      ready.database.close()
      createInitialKnownGoodPersistedStateBackup(temporary.path)

      const liveDatabase = new DatabaseSync(temporary.path)
      liveDatabase.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA wal_autocheckpoint = 0;
        CREATE TABLE wal_state (value TEXT NOT NULL);
        INSERT INTO wal_state (value) VALUES ('preserved');
      `)
      expect(existsSync(`${temporary.path}-wal`)).toBe(true)

      expect(() =>
        restoreKnownGoodPersistedState(temporary.path, {
          beforeInstall: () => {
            throw new Error('injected installation failure')
          },
        }),
      ).toThrow('injected installation failure')

      expect(existsSync(temporary.path)).toBe(true)
      expect(existsSync(`${temporary.path}-wal`)).toBe(true)
      const damagedBackupPath = readdirSync(
        path.join(temporary.directory, 'recovery'),
      )
        .filter((entry) => entry.includes('.damaged-'))
        .map((entry) => path.join(temporary.directory, 'recovery', entry))[0]
      expect(damagedBackupPath).toBeDefined()
      if (!damagedBackupPath) return
      expect(existsSync(`${damagedBackupPath}-wal`)).toBe(true)
      expect(existsSync(`${damagedBackupPath}-shm`)).toBe(true)
      expect(inspectPersistedState(temporary.path).ok).toBe(true)
      expect(
        liveDatabase.prepare('SELECT value FROM wal_state').get() as {
          value: string
        },
      ).toEqual({ value: 'preserved' })
      liveDatabase.close()
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })

  it('restores a WAL-backed live bundle after an interrupted install and restart', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      const ready = preparePersistedState(temporary.path)
      expect(ready.status).toBe('ready')
      if (ready.status !== 'ready') return
      createInitialKnownGoodPersistedStateBackup(temporary.path)
      ready.database.close()

      const liveDatabase = new DatabaseSync(temporary.path)
      liveDatabase.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA wal_autocheckpoint = 0;
        CREATE TABLE recovery_wal_state (value TEXT NOT NULL);
        INSERT INTO recovery_wal_state (value) VALUES ('preserved after restart');
      `)
      expect(existsSync(`${temporary.path}-wal`)).toBe(true)

      expect(() =>
        restoreKnownGoodPersistedState(temporary.path, {
          interruptAfterTransition: 'live-moved',
        }),
      ).toThrow(PersistedStateRecoveryInterruption)
      liveDatabase.close()

      const restarted = preparePersistedState(temporary.path)
      expect(restarted.status).toBe('ready')
      if (restarted.status !== 'ready') return
      restarted.database.close()

      const verified = new DatabaseSync(temporary.path, { readOnly: true })
      expect(
        verified.prepare('SELECT value FROM recovery_wal_state').get(),
      ).toEqual({ value: 'preserved after restart' })
      verified.close()
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })

  it.each([
    'move-live',
    'install-replacement',
  ] as const)('rolls back safely after an injected rename failure while it tries to %s', (failedTransition) => {
    const temporary = createTemporaryDatabasePath()

    try {
      const ready = preparePersistedState(temporary.path)
      expect(ready.status).toBe('ready')
      if (ready.status !== 'ready') return
      ready.database.createProject({
        defaultBranch: 'main',
        name: 'known good',
        remoteUrl: null,
        repoRoot: '/workspace/known-good',
      })
      createInitialKnownGoodPersistedStateBackup(temporary.path)
      ready.database.createProject({
        defaultBranch: 'main',
        name: 'live project',
        remoteUrl: null,
        repoRoot: '/workspace/live',
      })
      ready.database.close()

      expect(() =>
        restoreKnownGoodPersistedState(temporary.path, {
          renameFile: (sourcePath, destinationPath) => {
            if (
              (failedTransition === 'move-live' &&
                sourcePath === temporary.path) ||
              (failedTransition === 'install-replacement' &&
                destinationPath === temporary.path)
            ) {
              throw new Error(`injected ${failedTransition} rename failure`)
            }
            renameSync(sourcePath, destinationPath)
          },
        }),
      ).toThrow(`injected ${failedTransition} rename failure`)

      const restarted = preparePersistedState(temporary.path)
      expect(restarted.status).toBe('ready')
      if (restarted.status !== 'ready') return
      expect(restarted.database.listProjects()).toHaveLength(2)
      restarted.database.close()
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })

  it.each([
    'prepared',
    'live-moved',
    'replacement-installed',
  ] as const)('reconciles an interrupted restore from the %s state before opening SQLite', (interruptedAfter) => {
    const temporary = createTemporaryDatabasePath()

    try {
      const ready = preparePersistedState(temporary.path)
      expect(ready.status).toBe('ready')
      if (ready.status !== 'ready') return

      ready.database.createProject({
        defaultBranch: 'main',
        name: 'backup project',
        remoteUrl: null,
        repoRoot: '/workspace/backup',
      })
      createInitialKnownGoodPersistedStateBackup(temporary.path)
      ready.database.createProject({
        defaultBranch: 'main',
        name: 'live project',
        remoteUrl: null,
        repoRoot: '/workspace/live',
      })
      ready.database.close()

      expect(() =>
        restoreKnownGoodPersistedState(temporary.path, {
          interruptAfterTransition: interruptedAfter,
        }),
      ).toThrow(PersistedStateRecoveryInterruption)

      const restarted = preparePersistedState(temporary.path)
      expect(restarted.status).toBe('ready')
      if (restarted.status !== 'ready') return

      expect(
        restarted.database.listProjects().map((project) => project.name),
      ).toEqual(
        interruptedAfter === 'replacement-installed'
          ? ['backup project']
          : ['backup project', 'live project'],
      )
      restarted.database.close()
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })

  it('keeps the installed replacement when rollback cleanup fails and reconciles it on restart', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      const ready = preparePersistedState(temporary.path)
      expect(ready.status).toBe('ready')
      if (ready.status !== 'ready') return

      ready.database.createProject({
        defaultBranch: 'main',
        name: 'backup project',
        remoteUrl: null,
        repoRoot: '/workspace/backup',
      })
      createInitialKnownGoodPersistedStateBackup(temporary.path)
      ready.database.createProject({
        defaultBranch: 'main',
        name: 'live project',
        remoteUrl: null,
        repoRoot: '/workspace/live',
      })
      ready.database.close()

      expect(() =>
        restoreKnownGoodPersistedState(temporary.path, {
          removeFile: (pathname) => {
            if (pathname.includes('.rollback-')) {
              throw new Error('injected rollback cleanup failure')
            }
            rmSync(pathname, { force: true })
          },
        }),
      ).toThrow('injected rollback cleanup failure')

      const restarted = preparePersistedState(temporary.path)
      expect(restarted.status).toBe('ready')
      if (restarted.status !== 'ready') return
      expect(
        restarted.database.listProjects().map((project) => project.name),
      ).toEqual(['backup project'])
      restarted.database.close()
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })

  it('rolls a reset interrupted after moving the live bundle back on startup', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      const ready = preparePersistedState(temporary.path)
      expect(ready.status).toBe('ready')
      if (ready.status !== 'ready') return

      ready.database.createProject({
        defaultBranch: 'main',
        name: 'live project',
        remoteUrl: null,
        repoRoot: '/workspace/live',
      })
      ready.database.close()

      expect(() =>
        resetPersistedState(temporary.path, {
          interruptAfterTransition: 'live-moved',
        }),
      ).toThrow(PersistedStateRecoveryInterruption)

      const restarted = preparePersistedState(temporary.path)
      expect(restarted.status).toBe('ready')
      if (restarted.status !== 'ready') return
      expect(restarted.database.listProjects()).toHaveLength(1)
      restarted.database.close()
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })

  it('does not replace a damaged database when the selected backup is invalid', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      writeFileSync(temporary.path, 'damaged state')
      const knownGoodBackupPath = path.join(
        temporary.directory,
        'recovery',
        'aide.sqlite3.known-good',
      )
      mkdirSync(path.dirname(knownGoodBackupPath), { recursive: true })
      writeFileSync(knownGoodBackupPath, 'also damaged')

      expect(() => restoreKnownGoodPersistedState(temporary.path)).toThrow(
        'known-good backup failed integrity checks',
      )
      expect(readFileSync(temporary.path, 'utf8')).toBe('damaged state')
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })

  it('only resets after an explicit action and archives the damaged database first', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      writeFileSync(temporary.path, 'damaged state')

      const reset = resetPersistedState(temporary.path)

      expect(readFileSync(reset.damagedBackupPath, 'utf8')).toBe(
        'damaged state',
      )
      expect(existsSync(temporary.path)).toBe(false)

      const restarted = preparePersistedState(temporary.path)
      expect(restarted.status).toBe('ready')
      if (restarted.status === 'ready') {
        expect(restarted.database.getSnapshot().projects).toEqual([])
        restarted.database.close()
      }
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })

  it('keeps the damaged database unchanged until restore or reset is explicitly selected', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      writeFileSync(temporary.path, 'damaged state')
      const recovery = preparePersistedState(temporary.path)

      expect(recovery.status).toBe('recovery')
      expect(readFileSync(temporary.path, 'utf8')).toBe('damaged state')
      expect(existsSync(path.join(temporary.directory, 'recovery'))).toBe(false)
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })

  it('never creates a fresh database when the primary is missing beside recovery artifacts', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      const ready = preparePersistedState(temporary.path)
      expect(ready.status).toBe('ready')
      if (ready.status !== 'ready') return
      createInitialKnownGoodPersistedStateBackup(temporary.path)
      ready.database.close()
      rmSync(temporary.path)

      const result = preparePersistedState(temporary.path)

      expect(result).toMatchObject({
        recovery: {
          reason: 'recovery-transaction-failed',
          recommendedBackup: 'known-good',
        },
        status: 'recovery',
      })
      expect(existsSync(temporary.path)).toBe(false)
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })

  it('allows a fresh database after explicitly resetting a missing primary with recovery artifacts', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      const ready = preparePersistedState(temporary.path)
      expect(ready.status).toBe('ready')
      if (ready.status !== 'ready') return
      createInitialKnownGoodPersistedStateBackup(temporary.path)
      ready.database.close()
      rmSync(temporary.path)

      resetPersistedState(temporary.path)
      const restarted = preparePersistedState(temporary.path)

      expect(restarted.status).toBe('ready')
      if (restarted.status !== 'ready') return
      expect(restarted.database.getSnapshot().projects).toEqual([])
      restarted.database.close()
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })

  it('keeps every generated recovery path inside the database directory', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      const result = preparePersistedState(temporary.path)
      expect(result.status).toBe('ready')
      if (result.status !== 'ready') return

      expect(
        path.relative(temporary.directory, result.knownGoodBackupPath),
      ).not.toMatch(/^\.\.(?:[/\\]|$)/)
      expect(result.knownGoodBackupPath).toContain(
        `${path.sep}recovery${path.sep}`,
      )
      result.database.close()
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })

  it('rejects symbolic links for database files and recovery paths', () => {
    const temporary = createTemporaryDatabasePath()
    const outsideDirectory = mkdtempSync(path.join(tmpdir(), 'aide-outside-'))

    try {
      const outsideDatabasePath = path.join(outsideDirectory, 'outside.sqlite3')
      writeFileSync(outsideDatabasePath, 'not a sqlite database')
      symlinkSync(outsideDatabasePath, temporary.path)

      expect(() => preparePersistedState(temporary.path)).toThrow(
        'Database file must not be a symbolic link.',
      )

      rmSync(temporary.path)
      symlinkSync(
        outsideDirectory,
        path.join(temporary.directory, 'recovery'),
        'dir',
      )

      expect(() => preparePersistedState(temporary.path)).toThrow(
        'Recovery directory must not be a symbolic link.',
      )

      rmSync(path.join(temporary.directory, 'recovery'))
      mkdirSync(path.join(temporary.directory, 'recovery'))
      symlinkSync(
        outsideDatabasePath,
        path.join(temporary.directory, 'recovery', 'aide.sqlite3.known-good'),
      )

      expect(() => preparePersistedState(temporary.path)).toThrow(
        'Known-good backup must not be a symbolic link.',
      )
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
      rmSync(outsideDirectory, { force: true, recursive: true })
    }
  })
})

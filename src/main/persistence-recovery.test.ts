import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import { AIDE_DATABASE_SCHEMA_VERSION, createAideDatabase } from './database'
import {
  inspectPersistedState,
  preparePersistedState,
  resetPersistedState,
  restoreKnownGoodPersistedState,
} from './persistence-recovery'

function createTemporaryDatabasePath(): { directory: string; path: string } {
  const directory = mkdtempSync(path.join(tmpdir(), 'aide-recovery-'))

  return { directory, path: path.join(directory, 'aide.sqlite3') }
}

describe('persisted-state recovery', () => {
  it('starts a healthy database and creates a known-good backup', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      const result = preparePersistedState(temporary.path)

      expect(result.status).toBe('ready')
      if (result.status !== 'ready') return

      expect(result.database.getSnapshot().projects).toEqual([])
      expect(existsSync(result.knownGoodBackupPath)).toBe(true)
      expect(inspectPersistedState(result.knownGoodBackupPath).ok).toBe(true)
      result.database.close()
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
      legacyDatabase.exec(
        `PRAGMA user_version = ${AIDE_DATABASE_SCHEMA_VERSION - 1};`,
      )
      legacyDatabase.close()

      const result = preparePersistedState(temporary.path)

      expect(result.status).toBe('ready')
      if (result.status !== 'ready') return

      const backupPath = result.preMigrationBackupPath
      expect(backupPath).not.toBeNull()
      if (!backupPath) return
      expect(existsSync(backupPath)).toBe(true)
      expect(inspectPersistedState(backupPath).ok).toBe(true)
      expect(result.database.getSnapshot().schemaVersion).toBe(
        AIDE_DATABASE_SCHEMA_VERSION,
      )
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
      legacyDatabase.exec(
        `PRAGMA user_version = ${AIDE_DATABASE_SCHEMA_VERSION - 1};`,
      )
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

      const refreshed = preparePersistedState(temporary.path)
      expect(refreshed.status).toBe('ready')
      if (refreshed.status !== 'ready') return
      refreshed.database.close()

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

  it('does not replace a damaged database when the selected backup is invalid', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      writeFileSync(temporary.path, 'damaged state')
      const knownGoodBackupPath = path.join(
        temporary.directory,
        'recovery',
        'aide.sqlite3.known-good-invalid',
      )
      mkdirSync(path.dirname(knownGoodBackupPath), { recursive: true })
      writeFileSync(knownGoodBackupPath, 'also damaged')

      expect(() => restoreKnownGoodPersistedState(temporary.path)).toThrow(
        'No known-good backup is available',
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

  it('does not follow a recovery-directory symlink while starting in safe mode', () => {
    const temporary = createTemporaryDatabasePath()
    const outsideDirectory = mkdtempSync(path.join(tmpdir(), 'aide-outside-'))

    try {
      writeFileSync(temporary.path, 'damaged state')
      symlinkSync(
        outsideDirectory,
        path.join(temporary.directory, 'recovery'),
        'dir',
      )

      const recovery = preparePersistedState(temporary.path)

      expect(recovery.status).toBe('recovery')
      expect(readdirSync(outsideDirectory)).toEqual([])
      expect(readFileSync(temporary.path, 'utf8')).toBe('damaged state')
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
      rmSync(outsideDirectory, { force: true, recursive: true })
    }
  })

  it('keeps the older valid backup when a newer backup is corrupt', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      const ready = preparePersistedState(temporary.path)
      expect(ready.status).toBe('ready')
      if (ready.status !== 'ready') return
      ready.database.close()

      const invalidBackupPath = path.join(
        temporary.directory,
        'recovery',
        'aide.sqlite3.known-good-invalid',
      )
      writeFileSync(invalidBackupPath, 'invalid backup')
      writeFileSync(temporary.path, 'damaged state')

      const recovery = preparePersistedState(temporary.path)

      expect(recovery.status).toBe('recovery')
      if (recovery.status !== 'recovery') return
      expect(recovery.recovery.knownGoodBackupPath).toBe(
        ready.knownGoodBackupPath,
      )
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })

  it('refuses a newer database schema without changing the database', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      const database = createAideDatabase(temporary.path)
      database.close()
      const futureDatabase = new DatabaseSync(temporary.path)
      futureDatabase.exec(
        `PRAGMA user_version = ${AIDE_DATABASE_SCHEMA_VERSION + 1};`,
      )
      futureDatabase.close()

      const recovery = preparePersistedState(temporary.path)

      expect(recovery).toMatchObject({
        recovery: { reason: 'future-schema' },
        status: 'recovery',
      })
      expect(inspectPersistedState(temporary.path).schemaVersion).toBe(
        AIDE_DATABASE_SCHEMA_VERSION + 1,
      )
      expect(existsSync(path.join(temporary.directory, 'recovery'))).toBe(false)
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })

  it('retains the three newest known-good backups', () => {
    const temporary = createTemporaryDatabasePath()

    try {
      for (let index = 0; index < 4; index += 1) {
        const result = preparePersistedState(temporary.path)
        expect(result.status).toBe('ready')
        if (result.status === 'ready') result.database.close()
      }

      const knownGoodBackups = readdirSync(
        path.join(temporary.directory, 'recovery'),
      ).filter((name) => name.startsWith('aide.sqlite3.known-good-'))
      expect(knownGoodBackups).toHaveLength(3)
    } finally {
      rmSync(temporary.directory, { force: true, recursive: true })
    }
  })
})

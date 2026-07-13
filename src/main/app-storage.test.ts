import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { getAideDatabasePath, migrateLegacyDatabase } from './app-storage'

describe('getAideDatabasePath', () => {
  it('prefers an explicit database path and otherwise uses userData', () => {
    expect(
      getAideDatabasePath({
        userDataPath: '/home/user/.config/aide',
      }),
    ).toBe('/home/user/.config/aide/aide.sqlite3')
    expect(
      getAideDatabasePath({
        databasePathOverride: '/tmp/aide.sqlite3',
        userDataPath: '/home/user/.config/aide',
      }),
    ).toBe('/tmp/aide.sqlite3')
  })
})

describe('migrateLegacyDatabase', () => {
  it('moves a cwd database and its SQLite sidecars into userData once', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'aide-storage-'))
    const legacyPath = path.join(directory, 'cwd', '.aide.sqlite3')
    const databasePath = path.join(directory, 'user-data', 'aide.sqlite3')

    try {
      mkdirSync(path.dirname(legacyPath), { recursive: true })
      writeFileSync(legacyPath, 'database')
      writeFileSync(`${legacyPath}-wal`, 'wal')
      writeFileSync(`${legacyPath}-shm`, 'shm')

      migrateLegacyDatabase({ databasePath, legacyPath })

      expect(readFileSync(databasePath, 'utf8')).toBe('database')
      expect(readFileSync(`${databasePath}-wal`, 'utf8')).toBe('wal')
      expect(readFileSync(`${databasePath}-shm`, 'utf8')).toBe('shm')
      expect(existsSync(legacyPath)).toBe(false)
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('keeps an existing user-data database instead of replacing it', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'aide-storage-'))
    const legacyPath = path.join(directory, 'cwd', '.aide.sqlite3')
    const databasePath = path.join(directory, 'user-data', 'aide.sqlite3')

    try {
      mkdirSync(path.dirname(legacyPath), { recursive: true })
      mkdirSync(path.dirname(databasePath), { recursive: true })
      writeFileSync(legacyPath, 'legacy')
      writeFileSync(databasePath, 'current')

      migrateLegacyDatabase({ databasePath, legacyPath })

      expect(readFileSync(databasePath, 'utf8')).toBe('current')
      expect(readFileSync(legacyPath, 'utf8')).toBe('legacy')
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})

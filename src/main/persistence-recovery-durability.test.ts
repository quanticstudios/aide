import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it, vi } from 'vitest'

const readOnlyOpenPaths = vi.hoisted(() => [] as string[])

vi.mock('node:fs', async (importOriginal) => {
  const filesystem = await importOriginal<typeof import('node:fs')>()

  return {
    ...filesystem,
    openSync: (pathname: string, flags: string | number, mode?: number) => {
      if (flags === 'r') {
        readOnlyOpenPaths.push(pathname)
      }
      return filesystem.openSync(pathname, flags, mode)
    },
  }
})

import {
  createInitialKnownGoodPersistedStateBackup,
  preparePersistedState,
} from './persistence-recovery'

describe('persisted-state recovery durability', () => {
  it('fsyncs the data and recovery directories when recovery storage is first created', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'aide-recovery-'))
    const databasePath = path.join(directory, 'aide.sqlite3')

    try {
      const prepared = preparePersistedState(databasePath)
      expect(prepared.status).toBe('ready')
      if (prepared.status !== 'ready') return

      readOnlyOpenPaths.length = 0
      createInitialKnownGoodPersistedStateBackup(databasePath)

      expect(readOnlyOpenPaths).toContain(directory)
      expect(readOnlyOpenPaths).toContain(path.join(directory, 'recovery'))
      prepared.database.close()
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })
})

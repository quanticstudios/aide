import {
  copyFileSync,
  existsSync,
  mkdirSync,
  renameSync,
  unlinkSync,
} from 'node:fs'
import path from 'node:path'

const DATABASE_FILE_NAME = 'aide.sqlite3'

export function getAideDatabasePath(input: {
  databasePathOverride?: string
  userDataPath: string
}): string {
  return (
    input.databasePathOverride ??
    path.join(input.userDataPath, DATABASE_FILE_NAME)
  )
}

export function migrateLegacyDatabase(input: {
  databasePath: string
  legacyPath: string
}): void {
  if (
    input.databasePath === input.legacyPath ||
    existsSync(input.databasePath)
  ) {
    return
  }

  if (!existsSync(input.legacyPath)) {
    return
  }

  mkdirSync(path.dirname(input.databasePath), { recursive: true })
  moveFile(input.legacyPath, input.databasePath)

  for (const suffix of ['-wal', '-shm']) {
    const legacySidecar = `${input.legacyPath}${suffix}`

    if (existsSync(legacySidecar)) {
      moveFile(legacySidecar, `${input.databasePath}${suffix}`)
    }
  }
}

function moveFile(source: string, destination: string): void {
  try {
    renameSync(source, destination)
  } catch (error) {
    if (
      !(error instanceof Error) ||
      !('code' in error) ||
      error.code !== 'EXDEV'
    ) {
      throw error
    }

    copyFileSync(source, destination)
    unlinkSync(source)
  }
}

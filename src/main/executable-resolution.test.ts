import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  probeExecutable,
  resolveExecutablePath,
  validateExecutablePath,
} from './executable-resolution'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (tempRoot) => {
      await rm(tempRoot, { force: true, recursive: true })
    }),
  )
})

async function createTempRoot(): Promise<string> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aide-exec-'))
  tempRoots.push(tempRoot)
  return tempRoot
}

describe('resolveExecutablePath', () => {
  it('resolves commands from PATH', async () => {
    await expect(resolveExecutablePath('node')).resolves.toContain(
      `${path.sep}node`,
    )
  })

  it('resolves executable relative paths', async () => {
    const tempRoot = await createTempRoot()
    const scriptPath = path.join(tempRoot, 'tool.sh')

    await writeFile(scriptPath, '#!/bin/sh\necho aide\n')

    if (process.platform !== 'win32') {
      await chmod(scriptPath, 0o755)
    }

    await expect(
      resolveExecutablePath('./tool.sh', { cwd: tempRoot }),
    ).resolves.toBe(scriptPath)
  })
})

describe('validateExecutablePath', () => {
  it('returns a human-readable error for missing executables', async () => {
    await expect(
      validateExecutablePath('missing-aide-command'),
    ).resolves.toEqual({
      error:
        'Configured executable "missing-aide-command" was not found in PATH.',
      ok: false,
    })
  })
})

describe('probeExecutable', () => {
  it('can launch a test command successfully', async () => {
    const result = await probeExecutable('node', { args: ['--version'] })

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.output.startsWith('v')).toBe(true)
    }
  })
})

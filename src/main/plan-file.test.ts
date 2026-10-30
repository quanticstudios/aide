import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { writePlanFile } from './plan-file'

describe('writePlanFile', () => {
  const directories: string[] = []
  const makeDirectory = () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'aide-plan-file-'))
    directories.push(directory)
    return directory
  }

  afterEach(() => {
    for (const directory of directories.splice(0))
      rmSync(directory, { force: true, recursive: true })
  })

  it('writes the plan inside the workspace', async () => {
    const workspace = makeDirectory()
    mkdirSync(path.join(workspace, 'docs'))

    const saved = await writePlanFile(
      workspace,
      path.join(workspace, 'docs', 'PLAN.md'),
      '# Plan',
    )

    expect(readFileSync(saved, 'utf8')).toBe('# Plan\n')
  })

  it('refuses paths outside the workspace, the root itself and symlinks out', async () => {
    const workspace = makeDirectory()
    const outside = makeDirectory()
    symlinkSync(outside, path.join(workspace, 'escape'))
    symlinkSync(
      path.join(outside, 'target.md'),
      path.join(workspace, 'link.md'),
    )

    for (const filePath of [
      path.join(outside, 'PLAN.md'),
      path.join(workspace, '..', 'PLAN.md'),
      path.join(workspace, 'escape', 'PLAN.md'),
      path.join(workspace, 'link.md'),
      workspace,
    ]) {
      await expect(
        writePlanFile(workspace, filePath, '# Plan'),
      ).rejects.toThrow('Save the plan inside the workspace.')
    }
  })
})

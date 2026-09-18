import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import {
  rankProjectFilePaths,
  readProjectFile,
  resolveProjectFilePath,
  searchProjectFiles,
} from './project-files'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    tempRoots.splice(0).map(async (tempRoot) => {
      await rm(tempRoot, { force: true, recursive: true })
    }),
  )
})

async function createTempRoot(): Promise<string> {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'aide-project-files-'))
  tempRoots.push(tempRoot)
  return tempRoot
}

describe('resolveProjectFilePath', () => {
  it('resolves project-relative files inside the root', async () => {
    const tempRoot = await createTempRoot()

    expect(resolveProjectFilePath(tempRoot, 'docs/plan.md')).toBe(
      path.join(tempRoot, 'docs/plan.md'),
    )
  })

  it('rejects traversal outside the project root', async () => {
    const tempRoot = await createTempRoot()

    expect(() => resolveProjectFilePath(tempRoot, '../secret.txt')).toThrow(
      'File path must stay inside the project root',
    )
  })
})

describe('rankProjectFilePaths', () => {
  it('ranks filename prefix matches for an inline @file query', () => {
    expect(
      rankProjectFilePaths(
        [
          'docs/fleet-policy-drawer.md',
          'src/shared/fleet.ts',
          'src/renderer/src/lib/fleet-flow.test.ts',
          'src/unrelated.ts',
        ],
        'flee',
      ),
    ).toEqual([
      'src/shared/fleet.ts',
      'src/renderer/src/lib/fleet-flow.test.ts',
      'docs/fleet-policy-drawer.md',
    ])
  })

  it('searches ordinary project folders that are not git repositories', async () => {
    const projectRoot = await createTempRoot()
    await mkdir(path.join(projectRoot, 'src', 'shared'), { recursive: true })
    await writeFile(path.join(projectRoot, 'src', 'shared', 'fleet.ts'), '')

    await expect(searchProjectFiles(projectRoot, 'flee')).resolves.toEqual([
      'src/shared/fleet.ts',
    ])
  })
})

describe('readProjectFile', () => {
  it('returns file contents for a valid project-relative path', async () => {
    const tempRoot = await createTempRoot()
    const filePath = path.join(tempRoot, 'README.md')

    await writeFile(filePath, '# aide\n')

    await expect(readProjectFile(tempRoot, 'README.md')).resolves.toEqual({
      absolutePath: filePath,
      content: '# aide\n',
      relativePath: 'README.md',
    })
  })

  it('rejects a symlink that resolves outside the project root', async () => {
    const projectRoot = await createTempRoot()
    const hostRoot = await createTempRoot()
    const secretPath = path.join(hostRoot, 'host-secret.txt')

    await writeFile(secretPath, 'host sentinel')
    await symlink(secretPath, path.join(projectRoot, 'escape.txt'))

    await expect(readProjectFile(projectRoot, 'escape.txt')).rejects.toThrow(
      'File path must stay inside the project root',
    )
  })
})

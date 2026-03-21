import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { readProjectFile, resolveProjectFilePath } from './project-files'

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
})

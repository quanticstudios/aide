import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import path from 'node:path'

import type { ProjectTextFile } from '../shared/editor'

function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  )
}

export function resolveProjectFilePath(
  projectRoot: string,
  relativePath: string,
): string {
  if (!relativePath.trim()) {
    throw new Error('Expected a project-relative file path')
  }

  const resolvedRoot = path.resolve(projectRoot)
  const resolvedPath = path.resolve(resolvedRoot, relativePath)
  const relativeFromRoot = path.relative(resolvedRoot, resolvedPath)

  if (relativeFromRoot.startsWith('..') || path.isAbsolute(relativeFromRoot)) {
    throw new Error('File path must stay inside the project root')
  }

  return resolvedPath
}

export async function readProjectFile(
  projectRoot: string,
  relativePath: string,
): Promise<ProjectTextFile> {
  const absolutePath = resolveProjectFilePath(projectRoot, relativePath)
  const [resolvedRoot, resolvedPath] = await Promise.all([
    realpath(projectRoot),
    realpath(absolutePath),
  ])

  if (!isInsideRoot(resolvedRoot, resolvedPath)) {
    throw new Error('File path must stay inside the project root')
  }

  const pathStats = await lstat(resolvedPath)
  if (!pathStats.isFile()) {
    throw new Error('Project file must be a regular file')
  }

  const noFollow =
    typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
  const file = await open(resolvedPath, constants.O_RDONLY | noFollow)
  let content: string
  try {
    if (!(await file.stat()).isFile()) {
      throw new Error('Project file must be a regular file')
    }
    content = await file.readFile({ encoding: 'utf8' })
  } finally {
    await file.close()
  }

  return {
    absolutePath,
    content,
    relativePath,
  }
}

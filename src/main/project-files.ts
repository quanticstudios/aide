import { readFile } from 'node:fs/promises'
import path from 'node:path'

import type { ProjectTextFile } from '../shared/editor'

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
  const content = await readFile(absolutePath, 'utf8')

  return {
    absolutePath,
    content,
    relativePath,
  }
}

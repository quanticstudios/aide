import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import { lstat, open, readdir, realpath } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import type { ProjectTextFile } from '../shared/editor'

const execFileAsync = promisify(execFile)
const MAX_FILE_LIST_BYTES = 2_000_000
const MAX_FILE_RESULTS = 8
const MAX_SCANNED_FILES = 5_000
const SKIPPED_DIRECTORIES = new Set([
  '.git',
  '.cache',
  'dist',
  'node_modules',
  'out',
])

export function rankProjectFilePaths(
  filePaths: readonly string[],
  query: string,
  limit = MAX_FILE_RESULTS,
): string[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return []

  return filePaths
    .flatMap((filePath) => {
      const normalizedPath = filePath.toLowerCase()
      const fileName = path.posix.basename(normalizedPath)
      const matchIndex = fileName.indexOf(normalizedQuery)
      const pathMatchIndex = normalizedPath.indexOf(normalizedQuery)
      if (matchIndex < 0 && pathMatchIndex < 0) return []

      const rank =
        fileName === normalizedQuery
          ? 0
          : matchIndex === 0
            ? 1
            : matchIndex > 0
              ? 2
              : 3
      return [{ filePath, rank }]
    })
    .sort(
      (left, right) =>
        left.rank - right.rank ||
        path.posix.basename(left.filePath).length -
          path.posix.basename(right.filePath).length ||
        left.filePath.localeCompare(right.filePath),
    )
    .slice(0, limit)
    .map(({ filePath }) => filePath)
}

export async function searchProjectFiles(
  projectRoot: string,
  query: string,
): Promise<string[]> {
  let filePaths: string[]
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-files', '-co', '--exclude-standard', '-z'],
      {
        cwd: projectRoot,
        encoding: 'utf8',
        maxBuffer: MAX_FILE_LIST_BYTES,
        timeout: 1_500,
      },
    )
    filePaths = stdout
      .split('\0')
      .filter((filePath) => filePath && !/[\t\r\n]/.test(filePath))
  } catch (error) {
    const stderr =
      (error as { stderr?: Buffer | string }).stderr?.toString() ?? ''
    if (
      (error as NodeJS.ErrnoException).code !== 'ENOENT' &&
      !/not a git repository/i.test(stderr)
    ) {
      throw error
    }
    filePaths = await listRegularProjectFiles(projectRoot)
  }
  return rankProjectFilePaths(filePaths, query)
}

async function listRegularProjectFiles(projectRoot: string): Promise<string[]> {
  const directories = ['']
  const filePaths: string[] = []
  while (directories.length > 0 && filePaths.length < MAX_SCANNED_FILES) {
    const relativeDirectory = directories.pop() ?? ''
    const entries = await readdir(path.join(projectRoot, relativeDirectory), {
      withFileTypes: true,
    })
    for (const entry of entries) {
      const relativePath = path.posix.join(relativeDirectory, entry.name)
      if (entry.isDirectory() && !SKIPPED_DIRECTORIES.has(entry.name)) {
        directories.push(relativePath)
      } else if (entry.isFile() && !/[\t\r\n]/.test(relativePath)) {
        filePaths.push(relativePath)
        if (filePaths.length >= MAX_SCANNED_FILES) break
      }
    }
  }
  return filePaths
}

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

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const RETRIEVAL_TIMEOUT_MS = 1_500
const MAX_GIT_OUTPUT_BYTES = 256_000
const MAX_LISTED_FILES = 512
const MAX_MANDATORY_FILES = 32
const MAX_MANDATORY_BYTES = 24_000
const MAX_MANDATORY_FILE_BYTES = 12_000
const MAX_CANDIDATES = 16
const MAX_CANDIDATE_BYTES = 8_000
const MAX_CANDIDATE_EXCERPT_BYTES = 4_000
const INSTRUCTION_FILE_NAMES = new Set(['AGENTS.md', 'CLAUDE.md'])

export interface ContextExcerpt {
  content: string
  contentRevision: string
  endLine: number
  id: string
  path: string
  startLine: number
}

export interface ContextOmission {
  path: string
  reason: string
}

export interface RetrievedContext {
  candidates: ContextExcerpt[]
  mandatory: ContextExcerpt[]
  omitted: ContextOmission[]
}

export interface RetrieveContextOptions {
  signal?: AbortSignal
  task: string
  workspaceRoot: string
}

interface ValidatedFile {
  bytes: Buffer
  content: string
  path: string
}

function abortError(): Error {
  const error = new Error('Context retrieval was cancelled.')
  error.name = 'AbortError'
  return error
}

function assertActive(signal: AbortSignal | undefined, deadline: number): void {
  if (signal?.aborted) {
    throw abortError()
  }

  if (Date.now() > deadline) {
    throw new Error('Context retrieval exceeded its 1500ms deadline.')
  }
}

function remainingTime(deadline: number): number {
  return Math.max(1, deadline - Date.now())
}

function splitNullDelimited(value: string): string[] {
  return value.split('\0').filter(Boolean)
}

function splitLines(value: string): string[] {
  return value.split('\n').filter(Boolean)
}

function isSecretPath(relativePath: string): boolean {
  const name = path.posix.basename(relativePath).toLowerCase()

  return (
    /^\.env(?:[._-].*)?$/.test(name) ||
    /(?:^|[._-])(secret|secrets|credential|credentials|token|password|passwd|api[-_]?key|key)(?:[._-]|$)/.test(
      name,
    ) ||
    /\.(key|pem|p12|pfx)$/i.test(name) ||
    name === 'id_rsa' ||
    name === 'id_ed25519'
  )
}

function isInsideRoot(root: string, candidate: string): boolean {
  const relativePath = path.relative(root, candidate)
  return !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

function normalizePath(value: string): string | null {
  const trimmed = value.trim().replace(/^['"`(]+|['"`),.;:]+$/g, '')

  if (!trimmed || path.isAbsolute(trimmed) || trimmed.includes('\\')) {
    return null
  }

  const normalized = path.posix.normalize(trimmed)
  if (
    normalized === '.' ||
    normalized === '..' ||
    normalized.startsWith('../')
  ) {
    return null
  }

  return normalized
}

function explicitPaths(task: string): string[] {
  const values =
    task.match(
      /(?:(?:\.{1,2}|[A-Za-z0-9_.-]+)\/)*[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]+/g,
    ) ?? []
  const paths = new Set<string>()

  for (const value of values) {
    const normalized = normalizePath(value)
    if (normalized) {
      paths.add(normalized)
    }
  }

  return [...paths].sort((left, right) => left.localeCompare(right))
}

function taskTerms(task: string): string[] {
  return [...new Set(task.toLowerCase().match(/[a-z0-9_]{3,}/g) ?? [])].sort()
}

function pathScore(relativePath: string, terms: readonly string[]): number {
  const normalized = relativePath.toLowerCase()
  const basename = path.posix.basename(normalized)

  return terms.reduce(
    (score, term) =>
      score + (basename.includes(term) ? 4 : normalized.includes(term) ? 2 : 0),
    0,
  )
}

function lineCount(content: string): number {
  return content ? content.split('\n').length : 1
}

function revision(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function excerptId(
  relativePath: string,
  startLine: number,
  endLine: number,
): string {
  return `${relativePath}:${startLine}-${endLine}`
}

function fullExcerpt(file: ValidatedFile): ContextExcerpt {
  const endLine = lineCount(file.content)

  return {
    content: file.content,
    contentRevision: revision(file.bytes),
    endLine,
    id: excerptId(file.path, 1, endLine),
    path: file.path,
    startLine: 1,
  }
}

function candidateExcerpt(
  file: ValidatedFile,
  terms: readonly string[],
): ContextExcerpt | null {
  const lines = file.content.split(/(?<=\n)/)
  const bestLineIndex = lines.findIndex((line) => {
    const normalized = line.toLowerCase()
    return terms.some((term) => normalized.includes(term))
  })
  const startIndex = Math.max(0, bestLineIndex === -1 ? 0 : bestLineIndex - 2)
  const excerptLines: string[] = []

  for (let index = startIndex; index < lines.length; index += 1) {
    const next = `${excerptLines.join('')}${lines[index]}`
    if (Buffer.byteLength(next) > MAX_CANDIDATE_EXCERPT_BYTES) {
      break
    }
    excerptLines.push(lines[index])
  }

  const content = excerptLines.join('')
  if (!content) {
    return null
  }

  const startLine = startIndex + 1
  const endLine = startIndex + excerptLines.length

  return {
    content,
    contentRevision: revision(file.bytes),
    endLine,
    id: excerptId(file.path, startLine, endLine),
    path: file.path,
    startLine,
  }
}

async function gitFiles(
  workspaceRoot: string,
  signal: AbortSignal | undefined,
  deadline: number,
): Promise<string[] | null> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['ls-files', '-co', '--exclude-standard', '-z'],
      {
        cwd: workspaceRoot,
        encoding: 'utf8',
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        signal,
        timeout: remainingTime(deadline),
      },
    )
    const files = splitNullDelimited(stdout.toString())

    if (files.length > MAX_LISTED_FILES) {
      throw new Error(
        `Context retrieval supports at most ${MAX_LISTED_FILES} workspace files.`,
      )
    }

    return files
  } catch (error) {
    if (signal?.aborted) {
      throw abortError()
    }

    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ENOENT') {
      return null
    }

    const stderr =
      (error as { stderr?: string | Buffer }).stderr?.toString() ?? ''
    if (/not a git repository/i.test(stderr)) {
      return null
    }

    throw error
  }
}

async function ignoredGitPaths(
  workspaceRoot: string,
  files: readonly string[],
  signal: AbortSignal | undefined,
  deadline: number,
): Promise<Set<string>> {
  if (files.length === 0) {
    return new Set()
  }

  try {
    const { stdout } = await execFileAsync(
      'git',
      ['check-ignore', '--no-index', '--', ...files],
      {
        cwd: workspaceRoot,
        encoding: 'utf8',
        maxBuffer: MAX_GIT_OUTPUT_BYTES,
        signal,
        timeout: remainingTime(deadline),
      },
    )
    return new Set(splitLines(stdout.toString()))
  } catch (error) {
    if (signal?.aborted) {
      throw abortError()
    }

    if ((error as { code?: number | string }).code === 1) {
      return new Set()
    }

    throw error
  }
}

async function readValidatedFile(
  workspaceRoot: string,
  relativePath: string,
  signal: AbortSignal | undefined,
  deadline: number,
): Promise<ValidatedFile | null> {
  assertActive(signal, deadline)
  const normalized = normalizePath(relativePath)
  if (!normalized || isSecretPath(normalized)) {
    return null
  }

  const requestedPath = path.resolve(workspaceRoot, normalized)
  if (!isInsideRoot(workspaceRoot, requestedPath)) {
    return null
  }

  try {
    const resolvedPath = await realpath(requestedPath)
    if (!isInsideRoot(workspaceRoot, resolvedPath)) {
      return null
    }

    const fileStat = await stat(resolvedPath)
    if (!fileStat.isFile() || fileStat.size > MAX_MANDATORY_FILE_BYTES) {
      return null
    }

    assertActive(signal, deadline)
    const bytes = await readFile(resolvedPath)
    if (bytes.includes(0)) {
      return null
    }

    assertActive(signal, deadline)
    return {
      bytes,
      content: bytes.toString('utf8'),
      path: normalized,
    }
  } catch (error) {
    if (signal?.aborted) {
      throw abortError()
    }

    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }

    throw error
  }
}

async function existingRootInstructionPaths(
  workspaceRoot: string,
  signal: AbortSignal | undefined,
  deadline: number,
): Promise<string[]> {
  const instructionPaths: string[] = []

  for (const instructionPath of INSTRUCTION_FILE_NAMES) {
    assertActive(signal, deadline)
    try {
      const resolvedPath = await realpath(
        path.join(workspaceRoot, instructionPath),
      )
      if (isInsideRoot(workspaceRoot, resolvedPath)) {
        const fileStat = await stat(resolvedPath)
        if (fileStat.isFile()) {
          instructionPaths.push(instructionPath)
        }
      }
    } catch (error) {
      if (signal?.aborted) {
        throw abortError()
      }
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw error
      }
    }
  }

  return instructionPaths
}

function applicableInstructions(
  files: readonly string[],
  instructionPaths: readonly string[],
): string[] {
  const applicable = new Set<string>()

  for (const file of files) {
    for (const instructionPath of instructionPaths) {
      const instructionDirectory = path.posix.dirname(instructionPath)
      if (
        instructionDirectory === '.' ||
        file === instructionDirectory ||
        file.startsWith(`${instructionDirectory}/`)
      ) {
        applicable.add(instructionPath)
      }
    }
  }

  return [...applicable].sort((left, right) => left.localeCompare(right))
}

function pushOmission(
  omitted: ContextOmission[],
  relativePath: string,
  reason: string,
): void {
  omitted.push({
    path: isSecretPath(relativePath) ? '[redacted]' : relativePath,
    reason,
  })
}

export async function retrieveContext({
  workspaceRoot,
  task,
  signal,
}: RetrieveContextOptions): Promise<RetrievedContext> {
  const deadline = Date.now() + RETRIEVAL_TIMEOUT_MS
  assertActive(signal, deadline)
  const resolvedRoot = await realpath(workspaceRoot)
  const rootStat = await stat(resolvedRoot)
  if (!rootStat.isDirectory()) {
    throw new Error('Context retrieval requires a workspace directory.')
  }

  const listedFiles = await gitFiles(resolvedRoot, signal, deadline)
  assertActive(signal, deadline)
  const explicit = explicitPaths(task)
  const discoveredFiles = listedFiles ?? [
    ...(await existingRootInstructionPaths(resolvedRoot, signal, deadline)),
    ...explicit,
  ]
  const ignored = listedFiles
    ? await ignoredGitPaths(resolvedRoot, listedFiles, signal, deadline)
    : new Set<string>()
  const omissions: ContextOmission[] = []
  const available = discoveredFiles
    .filter((relativePath) => {
      if (ignored.has(relativePath)) {
        pushOmission(omissions, relativePath, 'ignored by Git')
        return false
      }
      if (isSecretPath(relativePath)) {
        pushOmission(omissions, relativePath, 'sensitive filename')
        return false
      }
      return normalizePath(relativePath) !== null
    })
    .sort((left, right) => left.localeCompare(right))
  const availableSet = new Set(available)
  const explicitAvailable = explicit.filter((relativePath) => {
    if (!availableSet.has(relativePath)) {
      pushOmission(omissions, relativePath, 'not a safe workspace file')
      return false
    }
    return true
  })
  const instructionPaths = available.filter((relativePath) =>
    INSTRUCTION_FILE_NAMES.has(path.posix.basename(relativePath)),
  )
  const terms = taskTerms(task)
  const optionalPaths = available
    .filter(
      (relativePath) =>
        !explicitAvailable.includes(relativePath) &&
        !INSTRUCTION_FILE_NAMES.has(path.posix.basename(relativePath)),
    )
    .sort((left, right) => {
      const scoreDifference = pathScore(right, terms) - pathScore(left, terms)
      return scoreDifference || left.localeCompare(right)
    })
    .slice(0, MAX_CANDIDATES)
  const mandatoryPaths = [
    ...new Set(
      [
        ...instructionPaths.filter(
          (instructionPath) => path.posix.dirname(instructionPath) === '.',
        ),
        ...explicitAvailable,
        ...applicableInstructions(
          [...explicitAvailable, ...optionalPaths],
          instructionPaths,
        ),
      ].sort((left, right) => left.localeCompare(right)),
    ),
  ]

  if (mandatoryPaths.length > MAX_MANDATORY_FILES) {
    throw new Error(
      `Required context has ${mandatoryPaths.length} files and exceeds the ${MAX_MANDATORY_FILES}-file limit.`,
    )
  }

  const mandatory: ContextExcerpt[] = []
  let mandatoryBytes = 0
  for (const relativePath of mandatoryPaths) {
    const file = await readValidatedFile(
      resolvedRoot,
      relativePath,
      signal,
      deadline,
    )
    if (!file) {
      throw new Error(`Required context file "${relativePath}" is unavailable.`)
    }

    const excerpt = fullExcerpt(file)
    const byteLength = Buffer.byteLength(excerpt.content)
    if (
      byteLength > MAX_MANDATORY_FILE_BYTES ||
      mandatoryBytes + byteLength > MAX_MANDATORY_BYTES
    ) {
      throw new Error(
        `Required context file "${relativePath}" exceeds the mandatory context budget.`,
      )
    }
    mandatory.push(excerpt)
    mandatoryBytes += byteLength
  }

  const candidates: ContextExcerpt[] = []
  let candidateBytes = 0
  for (const relativePath of optionalPaths) {
    assertActive(signal, deadline)
    const file = await readValidatedFile(
      resolvedRoot,
      relativePath,
      signal,
      deadline,
    )
    if (!file) {
      pushOmission(
        omissions,
        relativePath,
        'unreadable, binary, or outside workspace',
      )
      continue
    }

    const excerpt = candidateExcerpt(file, terms)
    if (!excerpt) {
      pushOmission(
        omissions,
        relativePath,
        'excerpt exceeds the per-file limit',
      )
      continue
    }
    const byteLength = Buffer.byteLength(excerpt.content)
    if (candidateBytes + byteLength > MAX_CANDIDATE_BYTES) {
      pushOmission(
        omissions,
        relativePath,
        'candidate context budget exhausted',
      )
      continue
    }
    candidates.push(excerpt)
    candidateBytes += byteLength
  }

  return {
    candidates,
    mandatory,
    omitted: omissions.sort(
      (left, right) =>
        left.path.localeCompare(right.path) ||
        left.reason.localeCompare(right.reason),
    ),
  }
}

export async function validateContextRevisions(
  workspaceRoot: string,
  excerpts: readonly ContextExcerpt[],
  signal?: AbortSignal,
): Promise<void> {
  const deadline = Date.now() + RETRIEVAL_TIMEOUT_MS
  assertActive(signal, deadline)
  const resolvedRoot = await realpath(workspaceRoot)

  for (const excerpt of excerpts) {
    const file = await readValidatedFile(
      resolvedRoot,
      excerpt.path,
      signal,
      deadline,
    )
    if (!file) {
      throw new Error(`Context excerpt "${excerpt.path}" is unavailable.`)
    }
    if (revision(file.bytes) !== excerpt.contentRevision) {
      throw new Error(
        `Context excerpt "${excerpt.path}" changed after retrieval.`,
      )
    }
  }
}

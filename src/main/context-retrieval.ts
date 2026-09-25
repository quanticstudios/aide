import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { open, realpath, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const RETRIEVAL_TIMEOUT_MS = 1_500
const MAX_GIT_OUTPUT_BYTES = 2_000_000
const MAX_CANDIDATE_PATHS = 512
const MAX_MANDATORY_FILES = 32
const MAX_MANDATORY_BYTES = 24_000
const MAX_MANDATORY_FILE_BYTES = 12_000
const MAX_SOURCE_FILE_BYTES = 1_000_000
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

function explicitReferences(task: string): Map<string, number | undefined> {
  // why: A URL host such as github.com looks like a file name and must not become a required file.
  const values =
    task
      .replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, ' ')
      .match(
        /(?:(?:\.{1,2}|[A-Za-z0-9_.-]+)\/)*[A-Za-z0-9_.-]+\.[A-Za-z0-9_-]+(?::\d+)?/g,
      ) ?? []
  const references = new Map<string, number | undefined>()

  for (const value of values) {
    const lineMatch = value.match(/:(\d+)$/)
    const normalized = normalizePath(
      lineMatch ? value.slice(0, -lineMatch[0].length) : value,
    )
    if (
      normalized &&
      !value.includes('/') &&
      /^v?\d+(?:\.\d+)+(?:-[\w.-]+)?$/i.test(normalized)
    ) {
      continue
    }
    if (normalized && (!references.has(normalized) || lineMatch)) {
      references.set(normalized, lineMatch ? Number(lineMatch[1]) : undefined)
    }
  }

  return new Map(
    [...references.entries()].sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  )
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
  return content
    ? content.split('\n').length - (content.endsWith('\n') ? 1 : 0)
    : 1
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
  maximumBytes = MAX_CANDIDATE_EXCERPT_BYTES,
  preferredLine?: number,
): ContextExcerpt | null {
  const lines = file.content.split(/(?<=\n)/)
  const bestLineIndex = preferredLine
    ? preferredLine > lines.length
      ? -1
      : preferredLine - 1
    : lines.findIndex((line) => {
        const normalized = line.toLowerCase()
        return terms.some((term) => normalized.includes(term))
      })
  if (preferredLine && bestLineIndex === -1) {
    return null
  }
  const startIndex = Math.max(0, bestLineIndex === -1 ? 0 : bestLineIndex - 2)
  const excerptLines: string[] = []

  for (let index = startIndex; index < lines.length; index += 1) {
    const next = `${excerptLines.join('')}${lines[index]}`
    if (Buffer.byteLength(next) > maximumBytes) {
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

    if (
      (error as NodeJS.ErrnoException).code ===
      'ERR_CHILD_PROCESS_STDIO_MAXBUFFER'
    ) {
      throw new Error('Context retrieval file listing exceeds its 2MiB limit.')
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

    // warn: A directory swap between realpath and open can choose a different file.
    const fileHandle = await open(
      requestedPath,
      constants.O_RDONLY | constants.O_NOFOLLOW,
    )
    try {
      const fileStat = await fileHandle.stat()
      if (!fileStat.isFile() || fileStat.size > MAX_SOURCE_FILE_BYTES) {
        return null
      }

      assertActive(signal, deadline)
      const bytes = await fileHandle.readFile({ signal })
      if (bytes.length > MAX_SOURCE_FILE_BYTES || bytes.includes(0)) {
        return null
      }

      assertActive(signal, deadline)
      return {
        bytes,
        content: bytes.toString('utf8'),
        path: normalized,
      }
    } finally {
      await fileHandle.close()
    }
  } catch (error) {
    if (signal?.aborted) {
      throw abortError()
    }

    if (
      ['ELOOP', 'ENOENT'].includes((error as NodeJS.ErrnoException).code ?? '')
    ) {
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

function isSupportedGitPath(relativePath: string): boolean {
  return !/[\t\r\n]/.test(relativePath)
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
  const explicitReferencesByPath = explicitReferences(task)
  const explicit = [...explicitReferencesByPath.keys()]
  const workspaceFiles = listedFiles ?? [
    ...(await existingRootInstructionPaths(resolvedRoot, signal, deadline)),
    ...explicit,
  ]
  const terms = taskTerms(task)
  const allInstructionPaths = workspaceFiles.filter((relativePath) =>
    INSTRUCTION_FILE_NAMES.has(path.posix.basename(relativePath)),
  )
  const rankedCandidatePaths = workspaceFiles
    .filter(
      (relativePath) =>
        !explicitReferencesByPath.has(relativePath) &&
        !INSTRUCTION_FILE_NAMES.has(path.posix.basename(relativePath)) &&
        !isSecretPath(relativePath) &&
        isSupportedGitPath(relativePath) &&
        normalizePath(relativePath) !== null,
    )
    .sort((left, right) => {
      const scoreDifference = pathScore(right, terms) - pathScore(left, terms)
      return scoreDifference || left.localeCompare(right)
    })
    .slice(0, MAX_CANDIDATE_PATHS)
  const discoveredFiles = [
    ...new Set([
      ...explicit,
      ...allInstructionPaths.filter(
        (instructionPath) => path.posix.dirname(instructionPath) === '.',
      ),
      ...applicableInstructions(
        [...explicit, ...rankedCandidatePaths],
        allInstructionPaths,
      ),
      ...rankedCandidatePaths,
    ]),
  ]
  const inspectableFiles = discoveredFiles.filter(
    (relativePath) =>
      !isSecretPath(relativePath) &&
      isSupportedGitPath(relativePath) &&
      normalizePath(relativePath) !== null,
  )
  const ignored = listedFiles
    ? await ignoredGitPaths(resolvedRoot, inspectableFiles, signal, deadline)
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
      if (!isSupportedGitPath(relativePath)) {
        pushOmission(omissions, relativePath, 'unsupported filename')
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

    const isInstruction = INSTRUCTION_FILE_NAMES.has(
      path.posix.basename(relativePath),
    )
    const byteLength = Buffer.byteLength(file.content)
    const excerpt =
      isInstruction || byteLength <= MAX_MANDATORY_FILE_BYTES
        ? fullExcerpt(file)
        : candidateExcerpt(
            file,
            terms,
            MAX_MANDATORY_FILE_BYTES,
            explicitReferencesByPath.get(relativePath),
          )
    if (!excerpt) {
      throw new Error(
        `Required context file "${relativePath}" has no complete excerpt within the mandatory context budget.`,
      )
    }
    if (
      (isInstruction && byteLength > MAX_MANDATORY_FILE_BYTES) ||
      mandatoryBytes + Buffer.byteLength(excerpt.content) > MAX_MANDATORY_BYTES
    ) {
      throw new Error(
        `Required context file "${relativePath}" exceeds the mandatory context budget.`,
      )
    }
    if (!isInstruction && byteLength > MAX_MANDATORY_FILE_BYTES) {
      pushOmission(
        omissions,
        relativePath,
        `full file exceeds the excerpt budget; included lines ${excerpt.startLine}-${excerpt.endLine}`,
      )
    }
    mandatory.push(excerpt)
    mandatoryBytes += Buffer.byteLength(excerpt.content)
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

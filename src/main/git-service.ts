import {
  type ChildProcessWithoutNullStreams,
  execFile,
  spawn,
} from 'node:child_process'
import { existsSync, constants as fsConstants } from 'node:fs'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readlink,
  realpath,
  rm,
  symlink,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import type {
  AttachWorkspaceRequest,
  CreateWorkspaceRequest,
  DetectWorktreeBranchResult,
  GitChangeKind,
  ImportProjectResult,
  ProjectRefRecord,
  WorkspaceGitDiffResult,
  WorkspaceGitDiffSection,
  WorkspaceGitFileStatus,
  WorkspaceGitStatusFailure,
  WorkspaceGitStatusResult,
  WorktreeBranchStats,
  WorktreeBranchStatsResult,
} from '../shared/git'
import type { ManagedSessionConfig } from '../shared/managed-session'
import type {
  CreateProjectInput,
  CreateWorkspaceInput,
  PersistenceSnapshot,
  ProjectRecord,
  UpdateProjectInput,
  UpdateWorkspaceInput,
  WorkspaceRecord,
} from '../shared/persistence'
import { resolveExecutablePath } from './executable-resolution'
import type {
  ManagedTurnPatchCapture,
  ManagedTurnPatchRecorder,
} from './managed-session-manager'

const execFileAsync = promisify(execFile)
const MAX_DIFF_OUTPUT_CHARACTERS = 20_000

/**
 * Maximum retained patch body for one completed turn (256 KiB). Oversized
 * patches keep their summary but no partial body, so the renderer never
 * receives an invalid unified diff.
 */
export const MAX_MANAGED_TURN_PATCH_BYTES = 256 * 1024

/**
 * Turn snapshots deliberately have lower limits than a whole repository. A
 * patch only needs enough source to attribute one agent action, and bounded
 * snapshots keep one unusual workspace from exhausting the main process.
 */
export const MAX_MANAGED_TURN_SNAPSHOT_FILES = 10_000
export const MAX_MANAGED_TURN_SNAPSHOT_BYTES = 64 * 1024 * 1024

const MAX_MANAGED_TURN_GIT_LIST_BYTES = 1024 * 1024
const MAX_MANAGED_TURN_NAME_STATUS_BYTES = 1024 * 1024
const MANAGED_TURN_GIT_TIMEOUT_MS = 10_000
const MANAGED_TURN_SNAPSHOT_TIMEOUT_MS = 15_000
const MANAGED_TURN_RENAME_LIMIT = 1_000

interface ManagedTurnPatchBaseline {
  disposed: boolean
  gitlinkCount: number
  snapshotDirectory: string
  worktreePath: string
  workspaceId: string
}

interface ManagedTurnSnapshotCopy {
  gitlinkCount: number
}

interface ManagedTurnSnapshotEntry {
  mode: number
  size: number
  source: Awaited<ReturnType<typeof open>> | null
  symbolicLinkTarget: string | null
}

class ManagedTurnSnapshotLimitError extends Error {}

class ManagedTurnSnapshotTimeoutError extends Error {}

function throwIfManagedTurnSnapshotAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) {
    return
  }

  throw new ManagedTurnSnapshotTimeoutError(
    signal.reason instanceof Error
      ? signal.reason.message
      : 'Managed turn snapshot capture was cancelled.',
  )
}

function createManagedTurnSnapshotSignal(parent?: AbortSignal): {
  dispose: () => void
  signal: AbortSignal
} {
  const controller = new AbortController()
  const onAbort = () => controller.abort(parent?.reason)
  parent?.addEventListener('abort', onAbort, { once: true })
  const timeout = setTimeout(() => {
    controller.abort(
      new ManagedTurnSnapshotTimeoutError(
        'Managed turn snapshot capture timed out.',
      ),
    )
  }, MANAGED_TURN_SNAPSHOT_TIMEOUT_MS)

  return {
    dispose: () => {
      clearTimeout(timeout)
      parent?.removeEventListener('abort', onAbort)
    },
    signal: controller.signal,
  }
}

/**
 * Narrow test seams for forcing pathname swaps after the snapshot root or an
 * intermediate directory is pinned. Production callers never supply these;
 * they exist to prove the containment boundary against real races.
 */
export interface ManagedTurnSnapshotHooks {
  afterRootOpen?: () => Promise<void>
  beforeLeafOpen?: (filePath: string) => Promise<void>
}

interface RepositoryMetadata {
  currentBranchLabel: string
  defaultBranch: string
  projectName: string
  remoteUrl: string | null
  repoRoot: string
}

export interface GitWorkspaceStore {
  createProject(input: CreateProjectInput): ProjectRecord
  createWorkspace(input: CreateWorkspaceInput): WorkspaceRecord
  deleteProject(projectId: string): boolean
  findProjectByRepoRoot(repoRoot: string): ProjectRecord | null
  findWorkspaceByWorktreePath(
    projectId: string,
    worktreePath: string,
  ): WorkspaceRecord | null
  getProject(projectId: string): ProjectRecord | null
  getWorkspace(workspaceId: string): WorkspaceRecord | null
  getSnapshot(): PersistenceSnapshot
  updateProject(
    projectId: string,
    input: UpdateProjectInput,
  ): ProjectRecord | null
  updateWorkspace(
    workspaceId: string,
    input: UpdateWorkspaceInput,
  ): WorkspaceRecord | null
}

function resolveProjectName(repoRoot: string): string {
  return path.basename(repoRoot) || 'project'
}

function formatGitError(error: unknown, fallback: string): Error {
  if (!(error instanceof Error)) {
    return new Error(fallback)
  }

  const cause = 'stderr' in error ? String(error.stderr ?? '').trim() : ''

  return new Error(cause || error.message || fallback)
}

function normalizeGitChangeKind(code: string): GitChangeKind {
  if (code === '.' || code === ' ') {
    return 'unmodified'
  }

  if (code === 'M') {
    return 'modified'
  }

  if (code === 'A') {
    return 'added'
  }

  if (code === 'D') {
    return 'deleted'
  }

  if (code === 'R') {
    return 'renamed'
  }

  if (code === 'C') {
    return 'copied'
  }

  if (code === 'U') {
    return 'unmerged'
  }

  if (code === '?') {
    return 'untracked'
  }

  return 'modified'
}

function parseBranchHead(output: string): string | null {
  for (const line of output.split('\n')) {
    if (!line.startsWith('# branch.head ')) {
      continue
    }

    const branchHead = line.slice('# branch.head '.length).trim()

    if (!branchHead || branchHead === '(detached)') {
      return null
    }

    return branchHead
  }

  return null
}

function parseWorkspaceGitFiles(output: string): WorkspaceGitFileStatus[] {
  const files: WorkspaceGitFileStatus[] = []

  for (const line of output.split('\n')) {
    if (!line || line.startsWith('# ')) {
      continue
    }

    if (line.startsWith('? ')) {
      const path = line.slice(2).trim()

      if (!path) {
        continue
      }

      files.push({
        isStaged: false,
        isUnstaged: true,
        originalPath: null,
        path,
        staged: 'unmodified',
        unstaged: 'untracked',
      })
      continue
    }

    if (
      line.startsWith('1 ') ||
      line.startsWith('2 ') ||
      line.startsWith('u ')
    ) {
      const [meta, originalPath] = line.split('\t')
      const fields = meta.split(' ')
      const xy = fields[1] ?? '..'
      const pathStartIndex = line.startsWith('1 ')
        ? 8
        : line.startsWith('2 ')
          ? 9
          : 10
      const path = fields.slice(pathStartIndex).join(' ').trim()

      if (!path) {
        continue
      }

      const staged = normalizeGitChangeKind(xy[0] ?? '.')
      const unstaged = normalizeGitChangeKind(xy[1] ?? '.')

      files.push({
        isStaged: staged !== 'unmodified',
        isUnstaged: unstaged !== 'unmodified',
        originalPath: originalPath?.trim() || null,
        path,
        staged,
        unstaged,
      })
    }
  }

  return files.sort((left, right) => left.path.localeCompare(right.path))
}

function classifyWorkspaceGitStatusError(
  error: unknown,
): WorkspaceGitStatusFailure {
  const message = formatGitError(
    error,
    'Unable to inspect workspace Git status.',
  ).message

  if (message.includes('Configured executable "git"')) {
    return {
      code: 'git-unavailable',
      error: message,
      ok: false,
    }
  }

  if (
    message.includes('not a git repository') ||
    message.includes('cannot change to') ||
    message.includes('no such file or directory')
  ) {
    return {
      code: 'not-a-git-worktree',
      error: 'Workspace worktree is not a valid Git repository.',
      ok: false,
    }
  }

  return {
    code: 'git-command-failed',
    error: message,
    ok: false,
  }
}

function truncateDiffOutput(patch: string): {
  isTruncated: boolean
  patch: string
} {
  if (patch.length <= MAX_DIFF_OUTPUT_CHARACTERS) {
    return {
      isTruncated: false,
      patch,
    }
  }

  return {
    isTruncated: true,
    patch: `${patch.slice(0, MAX_DIFF_OUTPUT_CHARACTERS)}\n\n...diff truncated...`,
  }
}

function buildUntrackedPatch(filePath: string, content: string): string {
  const lines = content.replace(/\r\n/g, '\n').split('\n')
  const normalizedLines =
    lines.at(-1) === '' ? lines.slice(0, Math.max(lines.length - 1, 0)) : lines
  const body = normalizedLines.map((line) => `+${line}`).join('\n')
  const lineCount = normalizedLines.length

  return [
    `diff --git a/${filePath} b/${filePath}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${filePath}`,
    `@@ -0,0 +1,${lineCount} @@`,
    body,
  ]
    .filter(Boolean)
    .join('\n')
}

function isManagedTurnPatchBaseline(
  value: unknown,
): value is ManagedTurnPatchBaseline {
  if (!value || typeof value !== 'object') {
    return false
  }

  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.disposed === 'boolean' &&
    typeof candidate.gitlinkCount === 'number' &&
    typeof candidate.snapshotDirectory === 'string' &&
    typeof candidate.worktreePath === 'string' &&
    typeof candidate.workspaceId === 'string'
  )
}

function isSafeGitRelativePath(filePath: string): boolean {
  const components = filePath.split(/[\\/]/)

  return (
    filePath.length > 0 &&
    !filePath.includes('\0') &&
    !path.isAbsolute(filePath) &&
    !path.win32.isAbsolute(filePath) &&
    !components.some(
      (component) =>
        component.length === 0 ||
        component === '.' ||
        component === '..' ||
        component.toLowerCase() === '.git',
    )
  )
}

/**
 * Git patch syntax always uses forward slashes, even when the process that
 * produced the patch received Windows path strings. Keep this conversion
 * isolated to recognized metadata lines: source text can legitimately contain
 * a snapshot path and must never be rewritten.
 */
function managedTurnGitPathPrefixes(
  prefix: 'a' | 'b' | null,
  snapshotDirectory: string,
): string[] {
  const slashDirectory = snapshotDirectory.replaceAll('\\', '/')
  const directoryVariants = [
    slashDirectory,
    snapshotDirectory,
    snapshotDirectory.replaceAll('\\', '\\\\'),
  ]
  const prefixes = directoryVariants.map((directory) =>
    prefix === null
      ? directory
      : directory.startsWith('/')
        ? `${prefix}${directory}`
        : `${prefix}/${directory}`,
  )

  return [
    ...new Set(
      prefixes.flatMap((directory) => [
        `${directory}/`,
        `${directory}\\\\`,
        `${directory}\\`,
      ]),
    ),
  ]
}

function normalizeManagedTurnMetadataPath(
  metadataPath: string,
  prefix: 'a' | 'b' | null,
  snapshotDirectories: string[],
): string {
  for (const snapshotDirectory of snapshotDirectories) {
    for (const directoryPrefix of managedTurnGitPathPrefixes(
      prefix,
      snapshotDirectory,
    )) {
      if (metadataPath.startsWith(directoryPrefix)) {
        const outputPrefix = prefix === null ? '' : `${prefix}/`
        return `${outputPrefix}${metadataPath.slice(directoryPrefix.length)}`
      }

      const quotedDirectoryPrefix = `"${directoryPrefix}`
      if (metadataPath.startsWith(quotedDirectoryPrefix)) {
        const outputPrefix = prefix === null ? '' : `${prefix}/`
        return `"${outputPrefix}${metadataPath.slice(
          quotedDirectoryPrefix.length,
        )}`
      }
    }
  }

  return metadataPath
}

function normalizeManagedTurnMetadataPathInHeader(
  header: string,
  prefix: 'a' | 'b',
  snapshotDirectories: string[],
): string {
  for (const snapshotDirectory of snapshotDirectories) {
    for (const directoryPrefix of managedTurnGitPathPrefixes(
      prefix,
      snapshotDirectory,
    )) {
      if (header.includes(directoryPrefix)) {
        return header.replace(directoryPrefix, `${prefix}/`)
      }

      const quotedDirectoryPrefix = `"${directoryPrefix}`
      if (header.includes(quotedDirectoryPrefix)) {
        return header.replace(quotedDirectoryPrefix, `"${prefix}/`)
      }
    }
  }

  return header
}

/** Exported for focused metadata portability tests. */
export function normalizeManagedTurnPatchPaths(
  patch: string,
  beforeDirectory: string,
  afterDirectory: string,
): string {
  const snapshotDirectories = [beforeDirectory, afterDirectory]

  return patch
    .split('\n')
    .map((line) => {
      if (line.startsWith('diff --git ')) {
        const header = line.slice('diff --git '.length)
        const before = normalizeManagedTurnMetadataPathInHeader(
          header,
          'a',
          snapshotDirectories,
        )
        const after = normalizeManagedTurnMetadataPathInHeader(
          before,
          'b',
          snapshotDirectories,
        )
        return `diff --git ${after}`
      }

      if (line.startsWith('--- ')) {
        return `--- ${normalizeManagedTurnMetadataPath(
          line.slice('--- '.length),
          'a',
          snapshotDirectories,
        )}`
      }

      if (line.startsWith('+++ ')) {
        return `+++ ${normalizeManagedTurnMetadataPath(
          line.slice('+++ '.length),
          'b',
          snapshotDirectories,
        )}`
      }

      if (
        line.startsWith('rename from ') ||
        line.startsWith('rename to ') ||
        line.startsWith('copy from ') ||
        line.startsWith('copy to ')
      ) {
        const metadataPrefix = [
          'rename from ',
          'rename to ',
          'copy from ',
          'copy to ',
        ].find((prefix) => line.startsWith(prefix))

        if (!metadataPrefix) {
          return line
        }

        return `${metadataPrefix}${normalizeManagedTurnMetadataPath(
          line.slice(metadataPrefix.length),
          null,
          snapshotDirectories,
        )}`
      }

      if (line.startsWith('Binary files ')) {
        return `Binary files ${normalizeManagedTurnMetadataPathInHeader(
          normalizeManagedTurnMetadataPathInHeader(
            line.slice('Binary files '.length),
            'a',
            snapshotDirectories,
          ),
          'b',
          snapshotDirectories,
        )}`
      }

      return line
    })
    .join('\n')
}

function containsBinaryPatch(patch: string): boolean {
  return patch.includes('GIT binary patch') || patch.includes('Binary files ')
}

export class GitWorkspaceService implements ManagedTurnPatchRecorder {
  private gitPathPromise: Promise<string> | null = null

  public constructor(
    private readonly store: GitWorkspaceStore,
    private readonly managedTurnSnapshotHooks: ManagedTurnSnapshotHooks = {},
  ) {}

  public async validateManagedSessionWorkspace(
    config: ManagedSessionConfig,
  ): Promise<void> {
    await this.resolveManagedSessionWorktree(config)
  }

  /**
   * Snapshot only Git-visible files into a temporary directory. The managed
   * session's declared cwd must be exactly its persisted workspace worktree;
   * this prevents a renderer from attributing another worktree's changes.
   */
  public async captureBaseline(
    config: ManagedSessionConfig,
    signal?: AbortSignal,
  ): Promise<ManagedTurnPatchBaseline> {
    const capture = createManagedTurnSnapshotSignal(signal)
    let snapshotDirectory: string | null = null

    try {
      throwIfManagedTurnSnapshotAborted(capture.signal)
      const worktreePath = await this.resolveManagedSessionWorktree(config)
      snapshotDirectory = await mkdtemp(
        path.join(tmpdir(), 'aide-managed-turn-'),
      )
      const snapshot = await this.copyGitVisibleFiles(
        worktreePath,
        snapshotDirectory,
        capture.signal,
      )
      return {
        disposed: false,
        gitlinkCount: snapshot.gitlinkCount,
        snapshotDirectory,
        worktreePath,
        workspaceId: config.workspaceId,
      }
    } catch (error) {
      if (snapshotDirectory) {
        await rm(snapshotDirectory, { force: true, recursive: true })
      }
      throw error
    } finally {
      capture.dispose()
    }
  }

  /**
   * Baselines can be abandoned before a provider ever starts a turn. This is
   * intentionally idempotent because manager shutdown, terminalization, and
   * `capturePatch` can race to clean up the same prepared snapshot.
   */
  public async disposeBaseline(baseline: unknown): Promise<void> {
    if (!isManagedTurnPatchBaseline(baseline) || baseline.disposed) {
      return
    }

    baseline.disposed = true
    await rm(baseline.snapshotDirectory, { force: true, recursive: true })
  }

  public async capturePatch(
    config: ManagedSessionConfig,
    baseline: unknown,
    signal?: AbortSignal,
  ): Promise<ManagedTurnPatchCapture> {
    let afterDirectory: string | null = null
    const capture = createManagedTurnSnapshotSignal(signal)

    try {
      throwIfManagedTurnSnapshotAborted(capture.signal)
      if (!isManagedTurnPatchBaseline(baseline) || baseline.disposed) {
        throw new Error('Managed turn Git baseline is invalid.')
      }

      const worktreePath = await this.resolveManagedSessionWorktree(config)

      if (
        baseline.workspaceId !== config.workspaceId ||
        baseline.worktreePath !== worktreePath
      ) {
        throw new Error(
          'Managed turn Git baseline belongs to another workspace.',
        )
      }

      afterDirectory = await mkdtemp(path.join(tmpdir(), 'aide-managed-turn-'))
      const afterSnapshot = await this.copyGitVisibleFiles(
        worktreePath,
        afterDirectory,
        capture.signal,
      )

      if (baseline.gitlinkCount > 0 || afterSnapshot.gitlinkCount > 0) {
        return {
          binaryChanges: 'unknown',
          changedFileCount: 0,
          message:
            'Gitlink or submodule entries were skipped because turn snapshots cannot represent them. The change summary is unknown; open Git review for the complete worktree diff.',
          patch: null,
          patchByteLength: 0,
          status: 'truncated',
        }
      }

      const metadata = await this.inspectManagedTurnChanges(
        baseline.snapshotDirectory,
        afterDirectory,
        capture.signal,
      )

      if (metadata.truncated) {
        return {
          binaryChanges: 'unknown',
          changedFileCount: 0,
          message:
            'The turn change summary exceeded its limit, so the changed-file count is unknown. Open Git review for the complete worktree diff.',
          patch: null,
          patchByteLength: 0,
          status: 'truncated',
        }
      }

      if (metadata.changedFileCount === 0) {
        return {
          binaryChanges: 'none',
          changedFileCount: 0,
          message: 'No Git-visible changes were made during this turn.',
          patch: null,
          patchByteLength: 0,
          status: 'empty',
        }
      }

      const diff = await this.captureManagedTurnDiff(
        baseline.snapshotDirectory,
        afterDirectory,
        capture.signal,
      )

      if (diff.truncated) {
        return {
          binaryChanges: 'unknown',
          changedFileCount: metadata.changedFileCount,
          message: `Patch exceeded the ${MAX_MANAGED_TURN_PATCH_BYTES / 1024} KiB per-turn limit. Open Git review for the complete worktree diff.`,
          patch: null,
          patchByteLength: 0,
          status: 'truncated',
        }
      }

      const patch = normalizeManagedTurnPatchPaths(
        diff.output,
        baseline.snapshotDirectory,
        afterDirectory,
      )
      const patchByteLength = Buffer.byteLength(patch)

      return {
        binaryChanges: containsBinaryPatch(patch) ? 'present' : 'none',
        changedFileCount: metadata.changedFileCount,
        message: null,
        patch,
        patchByteLength,
        status: 'ready',
      }
    } catch (error) {
      if (
        error instanceof ManagedTurnSnapshotLimitError ||
        error instanceof ManagedTurnSnapshotTimeoutError
      ) {
        return {
          binaryChanges: 'unknown',
          changedFileCount: 0,
          message:
            'The turn snapshot exceeded its file or byte limit, so the change summary is unknown. Open Git review for the complete worktree diff.',
          patch: null,
          patchByteLength: 0,
          status: 'truncated',
        }
      }

      throw error
    } finally {
      capture.dispose()
      await Promise.all([
        this.disposeBaseline(baseline),
        ...(afterDirectory
          ? [rm(afterDirectory, { force: true, recursive: true })]
          : []),
      ])
    }
  }

  public async getWorkspaceStatus(
    workspaceId: string,
  ): Promise<WorkspaceGitStatusResult> {
    const workspace = this.store.getWorkspace(workspaceId)

    if (!workspace) {
      return {
        code: 'workspace-not-found',
        error: 'Workspace does not exist.',
        ok: false,
      }
    }

    try {
      const output = await this.runGit(
        ['status', '--porcelain=v2', '--branch'],
        workspace.worktreePath,
      )
      const files = parseWorkspaceGitFiles(output)
      const branchName =
        parseBranchHead(output) ||
        (await this.resolveCurrentBranchLabel(workspace.worktreePath))

      return {
        ok: true,
        status: {
          branchName,
          files,
          hasStagedChanges: files.some((file) => file.isStaged),
          hasUnstagedChanges: files.some((file) => file.isUnstaged),
          workspaceId: workspace.id,
          worktreePath: workspace.worktreePath,
        },
      }
    } catch (error) {
      return classifyWorkspaceGitStatusError(error)
    }
  }

  public async getWorkspaceFileDiff(
    workspaceId: string,
    filePath: string,
  ): Promise<WorkspaceGitDiffResult> {
    const workspace = this.store.getWorkspace(workspaceId)

    if (!workspace) {
      return {
        code: 'workspace-not-found',
        error: 'Workspace does not exist.',
        ok: false,
      }
    }

    const statusResult = await this.getWorkspaceStatus(workspaceId)

    if (!statusResult.ok) {
      return {
        code: statusResult.code,
        error: statusResult.error,
        ok: false,
      }
    }

    const file = statusResult.status.files.find(
      (candidate) => candidate.path === filePath,
    )

    if (!file) {
      return {
        code: 'file-not-found',
        error: 'Changed file does not exist in workspace Git status.',
        ok: false,
      }
    }

    try {
      const sections = await this.buildDiffSections(workspace, file)

      return {
        diff: {
          branchName: statusResult.status.branchName,
          path: file.path,
          sections,
          workspaceId: workspace.id,
          worktreePath: workspace.worktreePath,
        },
        ok: true,
      }
    } catch (error) {
      const classifiedError = classifyWorkspaceGitStatusError(error)

      return {
        code: classifiedError.code,
        error: classifiedError.error,
        ok: false,
      }
    }
  }

  public async getWorktreeBranchStats(
    workspaceId: string,
  ): Promise<WorktreeBranchStatsResult> {
    const workspace = this.store.getWorkspace(workspaceId)

    if (!workspace) {
      return {
        code: 'workspace-not-found',
        error: 'Workspace does not exist.',
        ok: false,
      }
    }

    const project = this.store.getProject(workspace.projectId)

    if (!project) {
      return {
        code: 'workspace-not-found',
        error: 'Parent project does not exist.',
        ok: false,
      }
    }

    try {
      const baseRef = await this.resolveComparisonBase(
        workspace.worktreePath,
        project.defaultBranch,
      )

      if (!baseRef) {
        return {
          ok: true,
          stats: {
            additions: 0,
            aheadCount: 0,
            behindCount: 0,
            deletions: 0,
            mergeStatus: 'unknown',
          },
          workspaceId,
        }
      }

      const [diffStats, aheadBehind, mergeStatus] = await Promise.all([
        this.getDiffStats(workspace.worktreePath, baseRef),
        this.getAheadBehind(workspace.worktreePath, baseRef),
        this.detectMergeStatus(workspace.worktreePath, baseRef),
      ])

      const resolvedMergeStatus =
        aheadBehind.ahead === 0 && aheadBehind.behind === 0
          ? 'up-to-date'
          : mergeStatus

      return {
        ok: true,
        stats: {
          additions: diffStats.additions,
          aheadCount: aheadBehind.ahead,
          behindCount: aheadBehind.behind,
          deletions: diffStats.deletions,
          mergeStatus: resolvedMergeStatus,
        },
        workspaceId,
      }
    } catch (error) {
      return classifyWorkspaceGitStatusError(error)
    }
  }

  public async importProject(repoPath: string): Promise<ImportProjectResult> {
    const metadata = await this.inspectRepository(repoPath)
    const existingProject = this.store.findProjectByRepoRoot(metadata.repoRoot)
    const project = existingProject
      ? this.syncProjectMetadata(existingProject, metadata)
      : this.store.createProject({
          defaultBranch: metadata.defaultBranch,
          name: metadata.projectName,
          remoteUrl: metadata.remoteUrl,
          repoRoot: metadata.repoRoot,
        })
    const createdProject = !existingProject

    try {
      const workspace = this.ensureRootWorkspace(project, metadata)

      return {
        projectId: project.id,
        snapshot: this.store.getSnapshot(),
        workspaceId: workspace.id,
      }
    } catch (error) {
      if (createdProject) {
        this.store.deleteProject(project.id)
      }

      throw error
    }
  }

  public async listProjectRefs(projectId: string): Promise<ProjectRefRecord[]> {
    const project = this.store.getProject(projectId)

    if (!project) {
      throw new Error('Project does not exist.')
    }

    const output = await this.runGit(
      [
        'for-each-ref',
        '--format=%(refname:short)\t%(refname)',
        'refs/heads',
        'refs/remotes',
      ],
      project.repoRoot,
    )

    const refs = output
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [displayName, refName] = line.split('\t')
        const source: ProjectRefRecord['source'] = refName?.startsWith(
          'refs/heads/',
        )
          ? 'local'
          : 'remote'

        return {
          displayName,
          name: displayName,
          source,
        }
      })
      .filter((candidate) => candidate.name !== 'origin/HEAD')

    return refs.sort((left, right) => {
      if (left.source !== right.source) {
        return left.source === 'local' ? -1 : 1
      }

      return left.displayName.localeCompare(right.displayName)
    })
  }

  public async createWorkspace(
    input: CreateWorkspaceRequest,
  ): Promise<PersistenceSnapshot> {
    const project = this.store.getProject(input.projectId)

    if (!project) {
      throw new Error('Project does not exist.')
    }

    const branchName = input.branchName.trim()
    const baseBranch = input.baseBranch.trim()
    const name = input.name.trim()
    const worktreePath = path.resolve(input.worktreePath.trim())

    if (!name || !branchName || !baseBranch || !worktreePath) {
      throw new Error(
        'Name, branch name, base branch, and worktree path are required.',
      )
    }

    const repoRoot = await this.resolveRepoRoot(project.repoRoot)

    if (existsSync(worktreePath)) {
      throw new Error(`Worktree path "${worktreePath}" already exists.`)
    }

    const branchExists = await this.localBranchExists(repoRoot, branchName)
    const gitArgs = branchExists
      ? ['worktree', 'add', worktreePath, branchName]
      : ['worktree', 'add', '-b', branchName, worktreePath, baseBranch]

    let worktreeCreated = false

    try {
      await this.runGit(gitArgs, repoRoot)
      worktreeCreated = true

      this.store.createWorkspace({
        branchName,
        name,
        projectId: project.id,
        windowId: input.windowId,
        worktreePath,
      })

      return this.store.getSnapshot()
    } catch (error) {
      if (worktreeCreated) {
        await this.rollbackWorktree(repoRoot, worktreePath, error)
      }

      throw formatGitError(error, 'Workspace creation failed.')
    }
  }

  public async detectWorktreeBranch(
    worktreePath: string,
  ): Promise<DetectWorktreeBranchResult> {
    const resolved = path.resolve(worktreePath.trim())

    if (!resolved || !existsSync(resolved)) {
      throw new Error(`Folder "${resolved}" does not exist.`)
    }

    const branchName = await this.resolveCurrentBranchLabel(resolved)

    return {
      branchName: branchName.startsWith('detached-') ? null : branchName,
      worktreePath: resolved,
    }
  }

  public async attachWorkspace(
    input: AttachWorkspaceRequest,
  ): Promise<PersistenceSnapshot> {
    const project = this.store.getProject(input.projectId)

    if (!project) {
      throw new Error('Project does not exist.')
    }

    const name = input.name.trim()
    const worktreePath = path.resolve(input.worktreePath.trim())

    if (!name || !worktreePath) {
      throw new Error('Name and worktree path are required.')
    }

    if (!existsSync(worktreePath)) {
      throw new Error(`Folder "${worktreePath}" does not exist.`)
    }

    const projectCommonDir = await this.resolveGitCommonDir(project.repoRoot)
    let folderCommonDir: string

    try {
      folderCommonDir = await this.resolveGitCommonDir(worktreePath)
    } catch {
      throw new Error('Selected folder is not inside a Git repository.')
    }

    if (folderCommonDir !== projectCommonDir) {
      throw new Error(
        'Selected folder is not a worktree of this project. Pick a worktree that shares the same Git repository.',
      )
    }

    const existing = this.store.findWorkspaceByWorktreePath(
      project.id,
      worktreePath,
    )

    if (existing) {
      throw new Error('A workspace already references this folder.')
    }

    const branchName = await this.resolveCurrentBranchLabel(worktreePath)

    this.store.createWorkspace({
      branchName,
      name,
      projectId: project.id,
      windowId: input.windowId,
      worktreePath,
    })

    return this.store.getSnapshot()
  }

  private ensureRootWorkspace(
    project: ProjectRecord,
    metadata: RepositoryMetadata,
  ): WorkspaceRecord {
    const existingWorkspace = this.store.findWorkspaceByWorktreePath(
      project.id,
      metadata.repoRoot,
    )

    if (!existingWorkspace) {
      return this.store.createWorkspace({
        branchName: metadata.currentBranchLabel,
        name: metadata.currentBranchLabel,
        projectId: project.id,
        windowId: null,
        worktreePath: metadata.repoRoot,
      })
    }

    return (
      this.store.updateWorkspace(existingWorkspace.id, {
        branchName: metadata.currentBranchLabel,
        name: metadata.currentBranchLabel,
        worktreePath: metadata.repoRoot,
      }) ?? existingWorkspace
    )
  }

  private syncProjectMetadata(
    project: ProjectRecord,
    metadata: RepositoryMetadata,
  ): ProjectRecord {
    return (
      this.store.updateProject(project.id, {
        defaultBranch: metadata.defaultBranch,
        name: metadata.projectName,
        remoteUrl: metadata.remoteUrl,
        repoRoot: metadata.repoRoot,
      }) ?? project
    )
  }

  private async inspectRepository(
    repoPath: string,
  ): Promise<RepositoryMetadata> {
    const repoRoot = await this.resolveRepoRoot(repoPath)
    const currentBranch = await this.resolveCurrentBranchLabel(repoRoot)
    const defaultBranch = await this.resolveDefaultBranch(
      repoRoot,
      currentBranch,
    )
    const remoteUrl = await this.readGitValue(
      ['config', '--get', 'remote.origin.url'],
      repoRoot,
    )

    return {
      currentBranchLabel: currentBranch,
      defaultBranch,
      projectName: resolveProjectName(repoRoot),
      remoteUrl,
      repoRoot,
    }
  }

  private async buildDiffSections(
    workspace: WorkspaceRecord,
    file: WorkspaceGitFileStatus,
  ): Promise<WorkspaceGitDiffSection[]> {
    const sections: WorkspaceGitDiffSection[] = []

    if (file.isStaged) {
      const patch = await this.runGit(
        ['diff', '--no-ext-diff', '--cached', '--unified=3', '--', file.path],
        workspace.worktreePath,
      )
      const truncated = truncateDiffOutput(patch)

      sections.push({
        isTruncated: truncated.isTruncated,
        kind: 'staged',
        patch: truncated.patch,
        title: 'Staged diff',
      })
    }

    if (file.isUnstaged) {
      if (file.unstaged === 'untracked') {
        const content = await readFile(
          path.join(workspace.worktreePath, file.path),
          'utf8',
        )
        const truncated = truncateDiffOutput(
          buildUntrackedPatch(file.path, content),
        )

        sections.push({
          isTruncated: truncated.isTruncated,
          kind: 'untracked',
          patch: truncated.patch,
          title: 'Untracked file',
        })
      } else {
        const patch = await this.runGit(
          ['diff', '--no-ext-diff', '--unified=3', '--', file.path],
          workspace.worktreePath,
        )
        const truncated = truncateDiffOutput(patch)

        sections.push({
          isTruncated: truncated.isTruncated,
          kind: 'unstaged',
          patch: truncated.patch,
          title: 'Working tree diff',
        })
      }
    }

    return sections
  }

  private async resolveComparisonBase(
    worktreePath: string,
    defaultBranch: string,
  ): Promise<string | null> {
    const remoteRef = `refs/remotes/origin/${defaultBranch}`

    try {
      await this.runGit(
        ['show-ref', '--verify', '--quiet', remoteRef],
        worktreePath,
      )

      return `origin/${defaultBranch}`
    } catch {
      // Remote ref not available, try local
    }

    const localRef = `refs/heads/${defaultBranch}`

    try {
      await this.runGit(
        ['show-ref', '--verify', '--quiet', localRef],
        worktreePath,
      )

      return defaultBranch
    } catch {
      return null
    }
  }

  private async getDiffStats(
    worktreePath: string,
    baseRef: string,
  ): Promise<{ additions: number; deletions: number }> {
    try {
      const output = await this.runGit(
        ['diff', '--shortstat', `${baseRef}...HEAD`],
        worktreePath,
      )

      if (!output.trim()) {
        return { additions: 0, deletions: 0 }
      }

      const insertionsMatch = output.match(/(\d+) insertion/)
      const deletionsMatch = output.match(/(\d+) deletion/)

      return {
        additions: insertionsMatch
          ? Number.parseInt(insertionsMatch[1], 10)
          : 0,
        deletions: deletionsMatch ? Number.parseInt(deletionsMatch[1], 10) : 0,
      }
    } catch {
      return { additions: 0, deletions: 0 }
    }
  }

  private async getAheadBehind(
    worktreePath: string,
    baseRef: string,
  ): Promise<{ ahead: number; behind: number }> {
    try {
      const output = await this.runGit(
        ['rev-list', '--left-right', '--count', `${baseRef}...HEAD`],
        worktreePath,
      )
      const [behind = '0', ahead = '0'] = output.trim().split(/\s+/)

      return {
        ahead: Number.parseInt(ahead, 10),
        behind: Number.parseInt(behind, 10),
      }
    } catch {
      return { ahead: 0, behind: 0 }
    }
  }

  private async detectMergeStatus(
    worktreePath: string,
    baseRef: string,
  ): Promise<WorktreeBranchStats['mergeStatus']> {
    try {
      const mergeBase = await this.runGit(
        ['merge-base', baseRef, 'HEAD'],
        worktreePath,
      )

      if (!mergeBase.trim()) {
        return 'unknown'
      }

      try {
        const output = await this.runGit(
          ['merge-tree', mergeBase.trim(), baseRef, 'HEAD'],
          worktreePath,
        )

        if (output.includes('<<<<<<<') || output.includes('=======')) {
          return 'conflicts'
        }

        return 'clean'
      } catch {
        return 'unknown'
      }
    } catch {
      return 'unknown'
    }
  }

  private async resolveGitCommonDir(repoPath: string): Promise<string> {
    const candidatePath = path.resolve(repoPath.trim())

    const commonDir = await this.runGit(
      ['rev-parse', '--git-common-dir'],
      candidatePath,
    )

    return path.resolve(candidatePath, commonDir)
  }

  private async resolveRepoRoot(repoPath: string): Promise<string> {
    const candidatePath = path.resolve(repoPath.trim())

    if (!candidatePath) {
      throw new Error('Project path is required.')
    }

    try {
      const repoRoot = await this.runGit(
        ['rev-parse', '--show-toplevel'],
        candidatePath,
      )

      return path.resolve(repoRoot)
    } catch (error) {
      const message = formatGitError(error, '').message

      if (message.includes('Configured executable "git"')) {
        throw new Error(message)
      }

      throw new Error('Selected folder is not inside a Git repository.')
    }
  }

  private async resolveCurrentBranchLabel(repoRoot: string): Promise<string> {
    const branchName = await this.readGitValue(
      ['symbolic-ref', '--quiet', '--short', 'HEAD'],
      repoRoot,
    )

    if (branchName) {
      return branchName
    }

    const shortSha = await this.runGit(
      ['rev-parse', '--short', 'HEAD'],
      repoRoot,
    )

    return `detached-${shortSha}`
  }

  private async resolveDefaultBranch(
    repoRoot: string,
    currentBranchLabel: string,
  ): Promise<string> {
    const remoteHead = await this.readGitValue(
      ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'],
      repoRoot,
    )

    if (remoteHead) {
      return remoteHead.replace(/^origin\//, '')
    }

    if (!currentBranchLabel.startsWith('detached-')) {
      return currentBranchLabel
    }

    return 'main'
  }

  private async localBranchExists(
    repoRoot: string,
    branchName: string,
  ): Promise<boolean> {
    try {
      await this.runGit(
        ['show-ref', '--verify', '--quiet', `refs/heads/${branchName}`],
        repoRoot,
      )
      return true
    } catch {
      return false
    }
  }

  private async rollbackWorktree(
    repoRoot: string,
    worktreePath: string,
    originalError: unknown,
  ): Promise<never> {
    try {
      await this.runGit(
        ['worktree', 'remove', '--force', worktreePath],
        repoRoot,
      )
    } catch (rollbackError) {
      const rollbackMessage = formatGitError(
        rollbackError,
        'Rollback failed after workspace creation error.',
      ).message
      const originalMessage = formatGitError(
        originalError,
        'Workspace creation failed.',
      ).message

      throw new Error(`${originalMessage} Rollback failed: ${rollbackMessage}`)
    }

    throw originalError
  }

  private async readGitValue(
    args: string[],
    cwd: string,
  ): Promise<string | null> {
    try {
      const value = await this.runGit(args, cwd)

      return value || null
    } catch {
      return null
    }
  }

  private async resolveManagedSessionWorktree(
    config: ManagedSessionConfig,
  ): Promise<string> {
    const workspace = this.store.getWorkspace(config.workspaceId)

    if (!workspace) {
      throw new Error('Managed session workspace does not exist.')
    }

    let worktreePath: string
    let configuredCwd: string

    try {
      ;[worktreePath, configuredCwd] = await Promise.all([
        realpath(workspace.worktreePath),
        realpath(config.cwd),
      ])
    } catch {
      throw new Error(
        'Managed session working directory does not resolve to its workspace worktree.',
      )
    }

    if (configuredCwd !== worktreePath) {
      throw new Error(
        'Managed session working directory does not match its workspace worktree.',
      )
    }

    return worktreePath
  }

  private async copyGitVisibleFiles(
    worktreePath: string,
    destination: string,
    signal?: AbortSignal,
  ): Promise<ManagedTurnSnapshotCopy> {
    const root = await this.openManagedTurnSnapshotRoot(worktreePath, signal)

    try {
      await this.managedTurnSnapshotHooks.afterRootOpen?.()
      throwIfManagedTurnSnapshotAborted(signal)
      const output = await this.runGitRaw(
        ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
        worktreePath,
        MAX_MANAGED_TURN_GIT_LIST_BYTES,
        signal,
        root.fd,
      )
      const files = output.split('\0').filter(Boolean)
      const gitlinks = await this.getGitlinkPaths(worktreePath, signal, root.fd)

      if (files.length > MAX_MANAGED_TURN_SNAPSHOT_FILES) {
        throw new ManagedTurnSnapshotLimitError(
          `Managed turn snapshot exceeds the ${MAX_MANAGED_TURN_SNAPSHOT_FILES.toLocaleString()} Git-visible file limit.`,
        )
      }

      let snapshotBytes = 0
      let gitlinkCount = 0

      for (const filePath of files) {
        throwIfManagedTurnSnapshotAborted(signal)
        if (!isSafeGitRelativePath(filePath)) {
          throw new Error('Git returned a path outside the managed worktree.')
        }

        if (gitlinks.has(filePath)) {
          gitlinkCount += 1
          continue
        }

        const target = path.resolve(destination, filePath)
        const relativeTarget = path.relative(destination, target)

        if (
          relativeTarget === '' ||
          relativeTarget.startsWith(`..${path.sep}`) ||
          path.isAbsolute(relativeTarget)
        ) {
          throw new Error('Git returned a path outside the turn snapshot.')
        }

        const entry = await this.openManagedTurnSnapshotEntry(
          root,
          filePath,
          signal,
        )

        if (!entry) {
          // A file deleted before this turn is absent from its baseline, so a
          // later restoration is correctly attributed as an addition.
          continue
        }

        try {
          snapshotBytes += entry.size
          if (snapshotBytes > MAX_MANAGED_TURN_SNAPSHOT_BYTES) {
            throw new ManagedTurnSnapshotLimitError(
              `Managed turn snapshot exceeds the ${MAX_MANAGED_TURN_SNAPSHOT_BYTES / (1024 * 1024)} MiB aggregate byte limit.`,
            )
          }

          await mkdir(path.dirname(target), { recursive: true })

          if (entry.symbolicLinkTarget !== null) {
            await symlink(entry.symbolicLinkTarget, target)
          } else if (entry.source) {
            const copiedBytes = await this.copyManagedTurnRegularFile(
              entry.source,
              entry.mode,
              target,
              MAX_MANAGED_TURN_SNAPSHOT_BYTES - (snapshotBytes - entry.size),
              signal,
            )
            snapshotBytes += copiedBytes - entry.size
          } else {
            throw new Error(
              'Managed turn snapshot entry has no readable source.',
            )
          }
        } finally {
          await entry.source?.close().catch(() => undefined)
        }
      }

      return { gitlinkCount }
    } finally {
      await root.close().catch(() => undefined)
    }
  }

  private async copyManagedTurnRegularFile(
    source: Awaited<ReturnType<typeof open>>,
    mode: number,
    target: string,
    availableBytes: number,
    signal?: AbortSignal,
  ): Promise<number> {
    let destination: Awaited<ReturnType<typeof open>> | null = null
    let copiedBytes = 0
    let copiedSuccessfully = false
    const abort = () => {
      void source.close().catch(() => undefined)
      void destination?.close().catch(() => undefined)
    }
    signal?.addEventListener('abort', abort, { once: true })

    try {
      throwIfManagedTurnSnapshotAborted(signal)
      destination = await open(
        target,
        fsConstants.O_WRONLY | fsConstants.O_CREAT | fsConstants.O_EXCL,
        mode,
      )
      const chunk = Buffer.allocUnsafe(64 * 1024)

      for (;;) {
        throwIfManagedTurnSnapshotAborted(signal)
        const { bytesRead } = await source.read(chunk, 0, chunk.length, null)
        throwIfManagedTurnSnapshotAborted(signal)
        if (bytesRead === 0) {
          break
        }

        copiedBytes += bytesRead
        if (copiedBytes > availableBytes) {
          throw new ManagedTurnSnapshotLimitError(
            `Managed turn snapshot exceeds the ${MAX_MANAGED_TURN_SNAPSHOT_BYTES / (1024 * 1024)} MiB aggregate byte limit.`,
          )
        }

        let writtenBytes = 0
        while (writtenBytes < bytesRead) {
          throwIfManagedTurnSnapshotAborted(signal)
          const { bytesWritten } = await destination.write(
            chunk,
            writtenBytes,
            bytesRead - writtenBytes,
            null,
          )
          if (bytesWritten === 0) {
            throw new Error('Unable to write managed turn snapshot.')
          }
          writtenBytes += bytesWritten
        }
      }
      await chmod(target, mode)
      throwIfManagedTurnSnapshotAborted(signal)
      copiedSuccessfully = true
      return copiedBytes
    } finally {
      signal?.removeEventListener('abort', abort)
      await destination?.close().catch(() => undefined)
      if (!copiedSuccessfully) {
        await rm(target, { force: true })
      }
    }
  }

  private async getGitlinkPaths(
    worktreePath: string,
    signal?: AbortSignal,
    workingDirectoryFd?: number,
  ): Promise<Set<string>> {
    const output = await this.runGitRaw(
      ['ls-files', '--cached', '--stage', '-z'],
      worktreePath,
      MAX_MANAGED_TURN_GIT_LIST_BYTES,
      signal,
      workingDirectoryFd,
    )
    const gitlinks = new Set<string>()

    for (const entry of output.split('\0')) {
      const separator = entry.indexOf('\t')
      if (separator < 0) {
        continue
      }

      const metadata = entry.slice(0, separator).split(' ')
      const filePath = entry.slice(separator + 1)

      if (metadata[0] === '160000') {
        if (!isSafeGitRelativePath(filePath)) {
          throw new Error('Git returned a path outside the managed worktree.')
        }
        gitlinks.add(filePath)
      }
    }

    return gitlinks
  }

  /**
   * Node does not expose openat(2), so pathname rechecks followed by a normal
   * open cannot close an intermediate-directory TOCTOU window. Linux exposes
   * descriptor-relative paths through /proc/self/fd; traverse one component at
   * a time with O_NOFOLLOW, then open the leaf through the pinned parent
   * descriptor. Other platforms deliberately fail closed rather than claim a
   * snapshot whose contents might have escaped the configured worktree.
   */
  private async openManagedTurnSnapshotRoot(
    worktreePath: string,
    signal?: AbortSignal,
  ): Promise<Awaited<ReturnType<typeof open>>> {
    throwIfManagedTurnSnapshotAborted(signal)
    if (process.platform !== 'linux') {
      throw new Error(
        'Managed turn snapshot capture requires Linux descriptor-relative filesystem support.',
      )
    }

    const root = await open(
      worktreePath,
      fsConstants.O_RDONLY |
        fsConstants.O_DIRECTORY |
        fsConstants.O_NOFOLLOW |
        fsConstants.O_NONBLOCK,
    )

    try {
      const openedWorktreePath = await realpath(`/proc/self/fd/${root.fd}`)
      if (openedWorktreePath !== worktreePath) {
        throw new Error(
          'Managed session working directory changed while preparing the turn snapshot.',
        )
      }
      return root
    } catch (error) {
      await root.close().catch(() => undefined)
      throw error
    }
  }

  private async openManagedTurnSnapshotEntry(
    root: Awaited<ReturnType<typeof open>>,
    filePath: string,
    signal?: AbortSignal,
  ): Promise<ManagedTurnSnapshotEntry | null> {
    throwIfManagedTurnSnapshotAborted(signal)
    const components = filePath.split(/[\\/]/)
    let parent = root

    try {
      for (const component of components.slice(0, -1)) {
        throwIfManagedTurnSnapshotAborted(signal)
        try {
          const child = await open(
            `/proc/self/fd/${parent.fd}/${component}`,
            fsConstants.O_RDONLY |
              fsConstants.O_DIRECTORY |
              fsConstants.O_NOFOLLOW |
              fsConstants.O_NONBLOCK,
          )
          if (parent !== root) {
            await parent.close()
          }
          parent = child
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
            return null
          }
          throw new Error(
            'Git-visible path contains an intermediate symlink or non-directory component.',
            { cause: error },
          )
        }
      }

      const leaf = components.at(-1)
      if (!leaf) {
        throw new Error('Git returned an empty managed turn snapshot path.')
      }
      const anchoredLeafPath = `/proc/self/fd/${parent.fd}/${leaf}`

      let stat: Awaited<ReturnType<typeof lstat>>
      try {
        stat = await lstat(anchoredLeafPath)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return null
        }
        throw error
      }

      await this.managedTurnSnapshotHooks.beforeLeafOpen?.(filePath)
      throwIfManagedTurnSnapshotAborted(signal)

      if (stat.isSymbolicLink()) {
        const symbolicLinkTarget = await readlink(anchoredLeafPath)
        return {
          mode: stat.mode,
          size: Buffer.byteLength(symbolicLinkTarget),
          source: null,
          symbolicLinkTarget,
        }
      }

      if (!stat.isFile()) {
        throw new Error('Git-visible path is not a regular file or symlink.')
      }

      let source: Awaited<ReturnType<typeof open>>
      try {
        source = await open(
          anchoredLeafPath,
          fsConstants.O_RDONLY |
            fsConstants.O_NOFOLLOW |
            fsConstants.O_NONBLOCK,
        )
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
          return null
        }
        throw new Error('Git-visible path changed before it could be opened.', {
          cause: error,
        })
      }

      try {
        const sourceStat = await source.stat()
        if (!sourceStat.isFile()) {
          throw new Error('Git-visible path changed before it could be copied.')
        }

        return {
          mode: sourceStat.mode,
          size: sourceStat.size,
          source,
          symbolicLinkTarget: null,
        }
      } catch (error) {
        await source.close()
        throw error
      }
    } finally {
      if (parent !== root) {
        await parent.close()
      }
    }
  }

  private async inspectManagedTurnChanges(
    beforeDirectory: string,
    afterDirectory: string,
    signal?: AbortSignal,
  ): Promise<{ changedFileCount: number; truncated: boolean }> {
    const result = await this.runGitDiff(
      [
        'diff',
        '--no-index',
        '--find-renames',
        `-l${MANAGED_TURN_RENAME_LIMIT}`,
        '--name-status',
        '-z',
        '--',
        beforeDirectory,
        afterDirectory,
      ],
      beforeDirectory,
      MAX_MANAGED_TURN_NAME_STATUS_BYTES,
      signal,
    )

    if (result.truncated || result.timedOut) {
      return { changedFileCount: 0, truncated: true }
    }

    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(result.stderr || 'Unable to inspect turn Git changes.')
    }

    const fields = result.stdout.split('\0')
    let changedFileCount = 0

    for (let index = 0; index < fields.length; ) {
      const status = fields[index++]

      if (!status) {
        continue
      }

      changedFileCount += 1
      index += status.startsWith('R') || status.startsWith('C') ? 2 : 1
    }

    return { changedFileCount, truncated: false }
  }

  private async captureManagedTurnDiff(
    beforeDirectory: string,
    afterDirectory: string,
    signal?: AbortSignal,
  ): Promise<{ output: string; truncated: boolean }> {
    const result = await this.runGitDiff(
      [
        'diff',
        '--no-index',
        '--no-ext-diff',
        '--binary',
        '--full-index',
        '--find-renames',
        `-l${MANAGED_TURN_RENAME_LIMIT}`,
        '--src-prefix=a/',
        '--dst-prefix=b/',
        '--',
        beforeDirectory,
        afterDirectory,
      ],
      beforeDirectory,
      MAX_MANAGED_TURN_PATCH_BYTES,
      signal,
    )

    if (result.timedOut || result.truncated) {
      return { output: result.stdout, truncated: true }
    }

    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(result.stderr || 'Unable to capture turn Git patch.')
    }

    return { output: result.stdout, truncated: result.truncated }
  }

  private async runGitRaw(
    args: string[],
    cwd: string,
    maxOutputBytes: number,
    signal?: AbortSignal,
    workingDirectoryFd?: number,
  ): Promise<string> {
    const result = await this.runGitDiff(
      args,
      cwd,
      maxOutputBytes,
      signal,
      workingDirectoryFd,
    )

    throwIfManagedTurnSnapshotAborted(signal)
    if (result.timedOut) {
      throw new Error(
        'Git command timed out while preparing the turn snapshot.',
      )
    }
    if (result.truncated) {
      throw new ManagedTurnSnapshotLimitError(
        'Git-visible file list exceeded its output limit.',
      )
    }
    if (result.exitCode !== 0) {
      throw new Error(result.stderr || 'Unable to list Git-visible files.')
    }

    return result.stdout
  }

  private async runGitDiff(
    args: string[],
    cwd: string,
    maxOutputBytes = 1024 * 1024,
    signal?: AbortSignal,
    workingDirectoryFd?: number,
  ): Promise<{
    exitCode: number | null
    stderr: string
    stdout: string
    timedOut: boolean
    truncated: boolean
  }> {
    throwIfManagedTurnSnapshotAborted(signal)
    const gitPath = await this.resolveGitPath()

    return new Promise((resolve, reject) => {
      const child = spawn(gitPath, args, {
        cwd:
          workingDirectoryFd === undefined ? cwd : '/proc/self/fd/3',
        env: process.env,
        stdio:
          workingDirectoryFd === undefined
            ? ['ignore', 'pipe', 'pipe']
            : ['ignore', 'pipe', 'pipe', workingDirectoryFd],
      }) as ChildProcessWithoutNullStreams
      const stdout: Buffer[] = []
      const stderr: Buffer[] = []
      let stdoutBytes = 0
      let stderrBytes = 0
      let timedOut = false
      let truncated = false
      let cancelled = false
      const abort = () => {
        cancelled = true
        child.kill()
      }
      signal?.addEventListener('abort', abort, { once: true })
      if (signal?.aborted) {
        abort()
      }
      const timeout = setTimeout(() => {
        timedOut = true
        child.kill()
      }, MANAGED_TURN_GIT_TIMEOUT_MS)

      child.once('error', (error) => {
        signal?.removeEventListener('abort', abort)
        clearTimeout(timeout)
        reject(error)
      })
      child.stdout.on('data', (chunk: Buffer) => {
        if (truncated) {
          return
        }

        stdoutBytes += chunk.length
        if (stdoutBytes > maxOutputBytes) {
          truncated = true
          child.kill()
          return
        }

        stdout.push(chunk)
      })
      child.stderr.on('data', (chunk: Buffer) => {
        if (stderrBytes >= 16 * 1024) {
          return
        }

        const remaining = 16 * 1024 - stderrBytes
        stderr.push(chunk.subarray(0, remaining))
        stderrBytes += Math.min(chunk.length, remaining)
      })
      child.once('close', (exitCode) => {
        signal?.removeEventListener('abort', abort)
        clearTimeout(timeout)
        resolve({
          exitCode,
          stderr: Buffer.concat(stderr).toString('utf8').trim(),
          stdout: Buffer.concat(stdout).toString('utf8'),
          timedOut: timedOut || cancelled,
          truncated,
        })
      })
    })
  }

  private async runGit(args: string[], cwd: string): Promise<string> {
    const gitPath = await this.resolveGitPath()
    const result = await execFileAsync(gitPath, args, {
      cwd,
      env: process.env,
      timeout: 10000,
    })

    return `${result.stdout}`.trim()
  }

  private async resolveGitPath(): Promise<string> {
    this.gitPathPromise ??= resolveExecutablePath('git')
    return this.gitPathPromise
  }
}

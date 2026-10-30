import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { constants, existsSync } from 'node:fs'
import { lstat, open, readlink, realpath, rm, stat } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import type {
  AttachWorkspaceRequest,
  CreateWorkspaceRequest,
  DetectWorktreeBranchResult,
  GitChangeKind,
  ImportProjectResult,
  ProjectRefRecord,
  WorkspaceDiffScope,
  WorkspaceGitCommitInput,
  WorkspaceGitDiffResult,
  WorkspaceGitDiffSection,
  WorkspaceGitFileMutationInput,
  WorkspaceGitFileStatus,
  WorkspaceGitMessageInput,
  WorkspaceGitMessageKind,
  WorkspaceGitMessageResult,
  WorkspaceGitMutationResult,
  WorkspaceGitPullResult,
  WorkspaceGitPullRequest,
  WorkspaceGitPullRequestInput,
  WorkspaceGitPullRequestResult,
  WorkspaceGitRevertInput,
  WorkspaceGitStatusFailure,
  WorkspaceGitStatusResult,
  WorkspaceScopeDiffResult,
  WorktreeBranchStats,
  WorktreeBranchStatsResult,
} from '../shared/git'
import type {
  CreateProjectInput,
  CreateWorkspaceInput,
  PersistenceSnapshot,
  ProjectRecord,
  UpdateProjectInput,
  UpdateWorkspaceInput,
  WorkspaceRecord,
} from '../shared/persistence'
import { isLinkedWorktree } from '../shared/persistence'
import { resolveExecutablePath } from './executable-resolution'
import { parseTurnDiffPatch } from './turn-checkpoints'

const execFileAsync = promisify(execFile)
const MAX_DIFF_OUTPUT_CHARACTERS = 20_000
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024
const MAX_COMMIT_MESSAGE_LENGTH = 4_096
const MAX_PULL_REQUEST_BODY_LENGTH = 65_536
const MAX_PULL_REQUEST_TITLE_LENGTH = 256

interface RepositoryMetadata {
  currentBranchLabel: string
  defaultBranch: string
  kind: ProjectRecord['kind']
  projectName: string
  remoteUrl: string | null
  repoRoot: string
}

class NotGitRepositoryError extends Error {}

export interface CreatedWorkspaceResult {
  readonly snapshot: PersistenceSnapshot
  readonly workspaceId: string
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
  deleteWorkspace(workspaceId: string): boolean
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

export type GitHubCommandRunner = (
  args: readonly string[],
  cwd: string,
) => Promise<string>

export type GitMessageGenerator = (input: {
  prompt: string
  workspaceId: string
}) => Promise<string>

const GIT_MESSAGE_KINDS: readonly WorkspaceGitMessageKind[] = [
  'commit',
  'pull-request-body',
  'pull-request-title',
]

function resolveProjectName(repoRoot: string): string {
  return path.basename(repoRoot) || 'project'
}

function formatPathList(paths: readonly string[]): string {
  const head = paths.slice(0, 3)
  const remaining = paths.length - head.length

  if (remaining > 0) {
    return `${head.join(', ')} and ${remaining} more files`
  }

  if (head.length < 2) {
    return head[0] ?? 'files'
  }

  return `${head.slice(0, -1).join(', ')} and ${head.at(-1)}`
}

function fallbackGitMessage(
  kind: WorkspaceGitMessageKind,
  paths: readonly string[],
): string {
  const list = formatPathList(paths)

  return kind === 'pull-request-body' ? `Updates ${list}.` : `Update ${list}`
}

function gitMessagePrompt(
  kind: WorkspaceGitMessageKind,
  paths: readonly string[],
  diff: string,
): string {
  const goal =
    kind === 'pull-request-body'
      ? 'Return only a pull request description of at most three sentences for this change.'
      : `Return only a ${kind === 'commit' ? 'commit subject line' : 'pull request title'} of at most 72 characters for this change.`

  return [
    goal,
    'Use no tools, commands, files, or outside context.',
    `Changed files: ${paths.join(', ') || 'none'}`,
    'Diff:',
    truncateDiffOutput(diff).patch,
  ].join('\n')
}

function normalizeGeneratedMessage(
  kind: WorkspaceGitMessageKind,
  value: string,
): string | null {
  const text = value.trim()

  if (kind === 'pull-request-body') {
    return text.slice(0, MAX_PULL_REQUEST_BODY_LENGTH) || null
  }

  const subject = (text.split(/\r?\n/, 1)[0] ?? '')
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[.]+$/, '')
    .trim()

  return subject && subject.length <= MAX_PULL_REQUEST_TITLE_LENGTH
    ? subject
    : null
}

function featureBranchName(message: string, now: Date): string {
  const slug = message
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 48)
    .replace(/^-+|-+$/g, '')

  if (slug) {
    return slug
  }

  const pad = (value: number): string => `${value}`.padStart(2, '0')

  return `work/${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`
}

function splitPathLines(output: string | null): string[] {
  return (output ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
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

function parseWorkspacePullRequest(output: string): WorkspaceGitPullRequest {
  const value: unknown = JSON.parse(output)
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('GitHub CLI returned an invalid pull request response.')
  }

  const pullRequest = value as Record<string, unknown>
  const requiredText = (field: string): string => {
    const item = pullRequest[field]
    if (typeof item !== 'string' || !item) {
      throw new Error('GitHub CLI returned an invalid pull request response.')
    }
    return item
  }
  const number = pullRequest.number
  if (typeof number !== 'number' || !Number.isSafeInteger(number)) {
    throw new Error('GitHub CLI returned an invalid pull request response.')
  }

  const statusCheckRollup = pullRequest.statusCheckRollup
  const checks = Array.isArray(statusCheckRollup)
    ? statusCheckRollup.flatMap((check) => {
        if (!check || typeof check !== 'object' || Array.isArray(check)) {
          return []
        }
        const value = check as Record<string, unknown>
        return typeof value.name === 'string' && value.name
          ? [
              {
                conclusion:
                  typeof value.conclusion === 'string'
                    ? value.conclusion
                    : null,
                detailsUrl:
                  typeof value.detailsUrl === 'string'
                    ? value.detailsUrl
                    : null,
                name: value.name,
                status: typeof value.status === 'string' ? value.status : null,
              },
            ]
          : []
      })
    : []

  return {
    baseRefName: requiredText('baseRefName'),
    checks,
    headRefName: requiredText('headRefName'),
    isDraft: pullRequest.isDraft === true,
    number,
    state: requiredText('state'),
    title: requiredText('title'),
    url: requiredText('url'),
  }
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

function buildUntrackedSymlinkPatch(filePath: string): string {
  return [
    `diff --git a/${filePath} b/${filePath}`,
    'new file mode 120000',
    '--- /dev/null',
    `+++ b/${filePath}`,
    '@@ -0,0 +1 @@',
    '+[symbolic link]',
  ].join('\n')
}

async function readUntrackedPatch(
  workspaceRoot: string,
  filePath: string,
): Promise<string> {
  const requestedPath = path.resolve(workspaceRoot, filePath)
  const resolvedRoot = path.resolve(workspaceRoot)
  if (!isInsideRoot(resolvedRoot, requestedPath)) {
    throw new Error('Untracked file path must stay inside the workspace root.')
  }

  if ((await lstat(requestedPath)).isSymbolicLink()) {
    return buildUntrackedSymlinkPatch(filePath)
  }

  const [realWorkspaceRoot, resolvedPath] = await Promise.all([
    realpath(workspaceRoot),
    realpath(requestedPath),
  ])
  if (!isInsideRoot(realWorkspaceRoot, resolvedPath)) {
    throw new Error('Untracked file path must stay inside the workspace root.')
  }

  const noFollow =
    typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
  const file = await open(resolvedPath, constants.O_RDONLY | noFollow)
  try {
    if (!(await file.stat()).isFile()) {
      throw new Error('Untracked path must be a regular file.')
    }
    return buildUntrackedPatch(
      filePath,
      await file.readFile({ encoding: 'utf8' }),
    )
  } finally {
    await file.close()
  }
}

async function readWorkspaceFileDigest(
  workspaceRoot: string,
  filePath: string,
): Promise<string> {
  const requestedPath = path.resolve(workspaceRoot, filePath)
  const resolvedRoot = path.resolve(workspaceRoot)
  if (!isInsideRoot(resolvedRoot, requestedPath)) {
    throw new Error('File path must stay inside the workspace root.')
  }

  const fileStatus = await lstat(requestedPath).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  })
  if (!fileStatus) return 'missing'

  if (fileStatus.isSymbolicLink()) {
    return createHash('sha256')
      .update('symlink\0')
      .update(await readlink(requestedPath))
      .digest('hex')
  }
  if (!fileStatus.isFile()) {
    throw new Error('Only regular files can be reverted.')
  }

  const [realWorkspaceRoot, resolvedPath] = await Promise.all([
    realpath(workspaceRoot),
    realpath(requestedPath),
  ])
  if (!isInsideRoot(realWorkspaceRoot, resolvedPath)) {
    throw new Error('File path must stay inside the workspace root.')
  }

  const noFollow =
    typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
  const file = await open(resolvedPath, constants.O_RDONLY | noFollow)
  try {
    return createHash('sha256')
      .update(await file.readFile())
      .digest('hex')
  } finally {
    await file.close()
  }
}

export class GitWorkspaceService {
  private readonly activeWorkspaceMutations = new Set<string>()
  private gitPathPromise: Promise<string> | null = null
  private ghPathPromise: Promise<string> | null = null

  public constructor(
    private readonly store: GitWorkspaceStore,
    private readonly runGitHubCommand?: GitHubCommandRunner,
    private readonly generateMessage?: GitMessageGenerator,
  ) {}

  public async runWorkspaceMutation<Result>(
    workspaceId: string,
    operation: () => Promise<Result>,
  ): Promise<Result> {
    if (this.activeWorkspaceMutations.has(workspaceId)) {
      throw new Error(
        'A workspace change is already running. Wait for it to finish before trying again.',
      )
    }

    this.activeWorkspaceMutations.add(workspaceId)
    try {
      return await operation()
    } finally {
      this.activeWorkspaceMutations.delete(workspaceId)
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

    const project = this.store.getProject(workspace.projectId)
    if (project?.kind === 'folder') {
      return {
        code: 'not-a-git-worktree',
        error: 'Git actions are unavailable for folder projects.',
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
          defaultBranch: project?.defaultBranch ?? '',
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
      const fileDiff = await this.buildDiffSections(workspace, file)

      return {
        diff: {
          branchName: statusResult.status.branchName,
          fingerprint: fileDiff.fingerprint,
          path: file.path,
          sections: fileDiff.sections,
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

    if (project.kind === 'folder') {
      return {
        code: 'not-a-git-worktree',
        error: 'Git actions are unavailable for folder projects.',
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

  /** Changed files with patches for the branch against its base, or for uncommitted work including untracked files. */
  public async getWorkspaceScopeDiff(
    workspaceId: string,
    scope: Exclude<WorkspaceDiffScope, 'turn'>,
  ): Promise<WorkspaceScopeDiffResult> {
    if (scope !== 'branch' && scope !== 'uncommitted') {
      return this.invalidInput('Choose the branch or uncommitted scope.')
    }
    const owned = await this.getOwnedWorkspace(workspaceId)
    if (!owned.ok) return owned
    const { project, workspace } = owned
    const patchArgs = [
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--src-prefix=a/',
      '--dst-prefix=b/',
    ]

    try {
      let patch = ''
      if (scope === 'branch') {
        const baseRef = await this.resolveComparisonBase(
          workspace.worktreePath,
          project.defaultBranch,
        )
        if (baseRef) {
          patch = await this.runGit(
            [...patchArgs, `${baseRef}...HEAD`],
            workspace.worktreePath,
          )
        }
      } else {
        const [tracked, untracked] = await Promise.all([
          this.runGit([...patchArgs, 'HEAD'], workspace.worktreePath),
          this.runGit(
            ['ls-files', '--others', '--exclude-standard', '-z'],
            workspace.worktreePath,
          ),
        ])
        const untrackedPatches = await Promise.all(
          untracked
            .split('\0')
            .filter(Boolean)
            .map((filePath) =>
              readUntrackedPatch(workspace.worktreePath, filePath),
            ),
        )
        patch = [tracked, ...untrackedPatches].join('\n')
      }

      const files = parseTurnDiffPatch(patch).map((file) => ({
        ...file,
        patch: truncateDiffOutput(file.patch).patch,
      }))
      return {
        diff: {
          additions: files.reduce((total, file) => total + file.additions, 0),
          deletions: files.reduce((total, file) => total + file.deletions, 0),
          files,
        },
        ok: true,
      }
    } catch (error) {
      return classifyWorkspaceGitStatusError(error)
    }
  }

  public async stageWorkspaceFile(
    input: WorkspaceGitFileMutationInput,
  ): Promise<WorkspaceGitMutationResult> {
    const context = await this.getMutableWorkspaceFile(input)
    if (!context.ok) return context

    if (!context.file.isUnstaged) {
      return this.invalidInput('The selected file has no unstaged changes.')
    }

    try {
      await this.runGit(
        ['add', '--', ...this.getGitFilePaths(context.file)],
        context.workspace.worktreePath,
      )
      return this.getMutationStatus(context.workspace.id)
    } catch (error) {
      return classifyWorkspaceGitStatusError(error)
    }
  }

  public async unstageWorkspaceFile(
    input: WorkspaceGitFileMutationInput,
  ): Promise<WorkspaceGitMutationResult> {
    const context = await this.getMutableWorkspaceFile(input)
    if (!context.ok) return context

    if (!context.file.isStaged) {
      return this.invalidInput('The selected file has no staged changes.')
    }

    try {
      await this.runGit(
        ['restore', '--staged', '--', ...this.getGitFilePaths(context.file)],
        context.workspace.worktreePath,
      )
      return this.getMutationStatus(context.workspace.id)
    } catch (error) {
      return classifyWorkspaceGitStatusError(error)
    }
  }

  public async revertWorkspaceFile(
    input: WorkspaceGitRevertInput,
  ): Promise<WorkspaceGitMutationResult> {
    const context = await this.getMutableWorkspaceFile(input)
    if (!context.ok) return context

    if (!this.isValidFingerprint(input?.fingerprint)) {
      return this.invalidInput(
        'The revert preview is invalid. Refresh the file diff.',
      )
    }

    try {
      const fileDiff = await this.buildDiffSections(
        context.workspace,
        context.file,
      )
      if (fileDiff.fingerprint !== input.fingerprint) {
        return {
          code: 'stale-diff',
          error:
            'The file changed after this revert preview. Refresh the file diff.',
          ok: false,
        }
      }

      if (context.file.unstaged === 'untracked' && !context.file.isStaged) {
        await rm(
          this.resolveWorkspaceFilePath(
            context.workspace.worktreePath,
            context.file.path,
          ),
        )
      } else {
        await this.runGit(
          [
            'restore',
            '--source=HEAD',
            '--staged',
            '--worktree',
            '--',
            ...this.getGitFilePaths(context.file),
          ],
          context.workspace.worktreePath,
        )
      }

      return this.getMutationStatus(context.workspace.id)
    } catch (error) {
      return classifyWorkspaceGitStatusError(error)
    }
  }

  public async commitWorkspaceIndex(
    input: WorkspaceGitCommitInput,
  ): Promise<WorkspaceGitMutationResult> {
    if (
      !input ||
      typeof input.workspaceId !== 'string' ||
      typeof input.message !== 'string'
    ) {
      return this.invalidInput('A workspace and commit message are required.')
    }
    const context = await this.getOwnedWorkspace(input.workspaceId)
    if (!context.ok) return context

    const message = input.message.trim()
    if (
      !message ||
      message.length > MAX_COMMIT_MESSAGE_LENGTH ||
      message.includes('\0')
    ) {
      return this.invalidInput(
        'A commit message of up to 4,096 characters is required.',
      )
    }

    try {
      await this.runGit(
        ['commit', '-m', message],
        context.workspace.worktreePath,
      )
      return this.getMutationStatus(context.workspace.id)
    } catch (error) {
      return classifyWorkspaceGitStatusError(error)
    }
  }

  public async pushWorkspaceBranch(
    workspaceId: string,
  ): Promise<WorkspaceGitMutationResult> {
    const context = await this.getOwnedWorkspace(workspaceId)
    if (!context.ok) return context

    try {
      const branchName = await this.resolvePushBranch(
        context.workspace.worktreePath,
      )
      await this.runGit(
        ['push', '--set-upstream', 'origin', branchName],
        context.workspace.worktreePath,
      )
      return this.getMutationStatus(context.workspace.id)
    } catch (error) {
      return this.classifyPushError(error)
    }
  }

  public async pullWorkspaceBranch(
    workspaceId: string,
  ): Promise<WorkspaceGitPullResult> {
    const context = await this.getOwnedWorkspace(workspaceId)
    if (!context.ok) return context

    const worktreePath = context.workspace.worktreePath

    try {
      const branchName = await this.resolvePushBranch(worktreePath)
      const upstream = await this.readGitValue(
        ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'],
        worktreePath,
      )
      const remoteArguments = upstream ? [] : ['origin', branchName]
      const comparisonRef = upstream ?? `origin/${branchName}`

      await this.runGit(['fetch', ...remoteArguments], worktreePath)
      const pulledCount = (
        await this.getAheadBehind(worktreePath, comparisonRef)
      ).behind
      await this.runGit(
        ['pull', '--rebase', '--autostash', ...remoteArguments],
        worktreePath,
      )
      const aheadBehind = await this.getAheadBehind(worktreePath, comparisonRef)
      const status = await this.getWorkspaceStatus(context.workspace.id)
      if (!status.ok) return status

      return {
        ok: true,
        pull: {
          aheadCount: aheadBehind.ahead,
          behindCount: aheadBehind.behind,
          pulledCount,
        },
        status: status.status,
      }
    } catch (error) {
      const conflictedPaths = splitPathLines(
        await this.readGitValue(
          ['diff', '--name-only', '--diff-filter=U'],
          worktreePath,
        ),
      )

      if (conflictedPaths.length > 0) {
        return {
          code: 'pull-conflict',
          error: `Pull stopped with conflicts in ${conflictedPaths.join(', ')}.`,
          ok: false,
        }
      }

      return this.classifyPushError(error)
    }
  }

  public async abortWorkspacePull(
    workspaceId: string,
  ): Promise<WorkspaceGitMutationResult> {
    const context = await this.getOwnedWorkspace(workspaceId)
    if (!context.ok) return context

    try {
      await this.runGit(['rebase', '--abort'], context.workspace.worktreePath)
      return this.getMutationStatus(context.workspace.id)
    } catch (error) {
      return classifyWorkspaceGitStatusError(error)
    }
  }

  public async commitAllAndPushWorkspace(
    input: WorkspaceGitCommitInput,
  ): Promise<WorkspaceGitMutationResult> {
    if (!input || typeof input.message !== 'string' || !input.message.trim()) {
      return this.invalidInput('A workspace and commit message are required.')
    }
    const context = await this.getOwnedWorkspace(input.workspaceId)
    if (!context.ok) return context

    const status = await this.getWorkspaceStatus(context.workspace.id)
    if (!status.ok) return status

    if (
      status.status.files.some(
        (file) => file.staged === 'unmerged' || file.unstaged === 'unmerged',
      )
    ) {
      return {
        code: 'pull-conflict',
        error: 'Resolve the conflicts or abort the pull before committing.',
        ok: false,
      }
    }

    if (status.status.files.length > 0) {
      try {
        await this.runGit(['add', '--all'], context.workspace.worktreePath)
      } catch (error) {
        return classifyWorkspaceGitStatusError(error)
      }

      const committed = await this.commitWorkspaceIndex(input)
      if (!committed.ok) return committed
    }

    const pushed = await this.pushWorkspaceBranch(context.workspace.id)
    if (pushed.ok || pushed.code !== 'push-rejected') return pushed

    const pulled = await this.pullWorkspaceBranch(context.workspace.id)
    if (!pulled.ok) return pulled

    return this.pushWorkspaceBranch(context.workspace.id)
  }

  public async startWorkspaceFeatureBranch(
    input: WorkspaceGitCommitInput,
  ): Promise<WorkspaceGitMutationResult> {
    if (!input || typeof input.message !== 'string') {
      return this.invalidInput('A workspace and commit message are required.')
    }
    const context = await this.getOwnedWorkspace(input.workspaceId)
    if (!context.ok) return context

    try {
      await this.runGit(
        ['checkout', '-b', featureBranchName(input.message, new Date())],
        context.workspace.worktreePath,
      )
      return this.getMutationStatus(context.workspace.id)
    } catch (error) {
      return classifyWorkspaceGitStatusError(error)
    }
  }

  public async generateWorkspaceGitMessage(
    input: WorkspaceGitMessageInput,
  ): Promise<WorkspaceGitMessageResult> {
    if (!input || !GIT_MESSAGE_KINDS.includes(input.kind)) {
      return this.invalidInput('A workspace and a message kind are required.')
    }
    const context = await this.getOwnedWorkspace(input.workspaceId)
    if (!context.ok) return context

    const status = await this.getWorkspaceStatus(context.workspace.id)
    if (!status.ok) return status

    let changes: { diff: string; paths: readonly string[] }
    try {
      changes = await this.collectMessageChanges(
        context.workspace.worktreePath,
        context.project.defaultBranch,
        status.status.files.map((file) => file.path),
      )
    } catch (error) {
      return classifyWorkspaceGitStatusError(error)
    }

    if (changes.paths.length === 0 && !changes.diff.trim()) {
      return this.invalidInput('There are no changes to describe.')
    }

    const fallback = fallbackGitMessage(input.kind, changes.paths)
    if (
      !this.generateMessage ||
      process.env.AIDE_FAKE_MANAGED_PROVIDERS === '1'
    ) {
      return { message: fallback, ok: true }
    }

    try {
      const generated = await this.generateMessage({
        prompt: gitMessagePrompt(input.kind, changes.paths, changes.diff),
        workspaceId: context.workspace.id,
      })

      return {
        message: normalizeGeneratedMessage(input.kind, generated) ?? fallback,
        ok: true,
      }
    } catch {
      return { message: fallback, ok: true }
    }
  }

  public async createWorkspacePullRequest(
    input: WorkspaceGitPullRequestInput,
  ): Promise<WorkspaceGitPullRequestResult> {
    if (
      !input ||
      typeof input.workspaceId !== 'string' ||
      typeof input.title !== 'string' ||
      typeof input.body !== 'string'
    ) {
      return this.invalidInput(
        'A workspace, pull request title, and body are required.',
      )
    }
    const context = await this.getOwnedWorkspace(input.workspaceId)
    if (!context.ok) return context

    const title = input.title.trim()
    const body = input.body.trim()
    if (
      !title ||
      title.length > MAX_PULL_REQUEST_TITLE_LENGTH ||
      body.length > MAX_PULL_REQUEST_BODY_LENGTH ||
      title.includes('\0') ||
      body.includes('\0')
    ) {
      return this.invalidInput(
        'A pull request title and an optional body within the size limits are required.',
      )
    }

    try {
      const branchName = await this.resolvePushBranch(
        context.workspace.worktreePath,
      )
      await this.requireGitHubAuthentication(context.workspace.worktreePath)
      await this.runGh(
        [
          'pr',
          'create',
          '--base',
          context.project.defaultBranch,
          '--head',
          branchName,
          '--title',
          title,
          '--body',
          body,
        ],
        context.workspace.worktreePath,
      )
      return this.getWorkspacePullRequest(context.workspace.id)
    } catch (error) {
      return this.classifyPullRequestError(error)
    }
  }

  public async getWorkspacePullRequest(
    workspaceId: string,
  ): Promise<WorkspaceGitPullRequestResult> {
    const context = await this.getOwnedWorkspace(workspaceId)
    if (!context.ok) return context

    try {
      await this.requireGitHubAuthentication(context.workspace.worktreePath)
      const output = await this.runGh(
        [
          'pr',
          'view',
          '--json',
          'number,title,url,state,isDraft,headRefName,baseRefName,statusCheckRollup',
        ],
        context.workspace.worktreePath,
      )
      return { ok: true, pullRequest: parseWorkspacePullRequest(output) }
    } catch (error) {
      const message = formatGitError(
        error,
        'Unable to inspect the pull request.',
      ).message
      if (message.includes('no pull requests found')) {
        return { ok: true, pullRequest: null }
      }
      return this.classifyPullRequestError(error)
    }
  }

  public async importProject(repoPath: string): Promise<ImportProjectResult> {
    const projectDirectory = await this.resolveProjectDirectory(repoPath)
    let metadata: RepositoryMetadata

    try {
      metadata = await this.inspectRepository(projectDirectory)
    } catch (error) {
      if (!(error instanceof NotGitRepositoryError)) throw error

      metadata = {
        currentBranchLabel: '',
        defaultBranch: '',
        kind: 'folder',
        projectName: resolveProjectName(projectDirectory),
        remoteUrl: null,
        repoRoot: projectDirectory,
      }
    }
    const existingProject = this.store.findProjectByRepoRoot(metadata.repoRoot)
    const project = existingProject
      ? this.syncProjectMetadata(existingProject, metadata)
      : this.store.createProject({
          defaultBranch: metadata.defaultBranch,
          kind: metadata.kind,
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

    if (project.kind === 'folder') {
      throw new Error('Git workspaces are unavailable for folder projects.')
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
    return (await this.createWorkspaceWithResult(input)).snapshot
  }

  /**
   * The explicit workspace id lets main-process post-create services (setup,
   * preview, future runtime ownership) start only after durable persistence
   * has succeeded. Git rollback remains entirely inside this service.
   */
  public async createWorkspaceWithResult(
    input: CreateWorkspaceRequest,
  ): Promise<CreatedWorkspaceResult> {
    const project = this.store.getProject(input.projectId)

    if (!project) {
      throw new Error('Project does not exist.')
    }

    if (project.kind === 'folder') {
      throw new Error('Git workspaces are unavailable for folder projects.')
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

      const workspace = this.store.createWorkspace({
        branchName,
        name,
        nameSource: 'manual',
        projectId: project.id,
        windowId: input.windowId,
        worktreePath,
      })

      return {
        snapshot: this.store.getSnapshot(),
        workspaceId: workspace.id,
      }
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

    if (project.kind === 'folder') {
      throw new Error('Git workspaces are unavailable for folder projects.')
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
      nameSource: 'manual',
      projectId: project.id,
      windowId: input.windowId,
      worktreePath,
    })

    return this.store.getSnapshot()
  }

  /**
   * `removeWorktree` runs `git worktree remove` without `--force`, so Git
   * refuses when the worktree has modified or untracked files. The branch is
   * kept either way.
   */
  public async deleteWorkspace(
    workspaceId: string,
    removeWorktree: boolean,
  ): Promise<PersistenceSnapshot> {
    const workspace = this.store.getWorkspace(workspaceId)
    if (!workspace) {
      throw new Error('Workspace does not exist.')
    }

    if (removeWorktree) {
      const project = this.store.getProject(workspace.projectId)
      if (!project || !isLinkedWorktree(project, workspace)) {
        throw new Error('This workspace is not a separate Git worktree.')
      }
      if (existsSync(workspace.worktreePath)) {
        try {
          await this.runGit(
            ['worktree', 'remove', workspace.worktreePath],
            await this.resolveRepoRoot(project.repoRoot),
          )
        } catch (error) {
          throw formatGitError(error, 'Worktree removal failed.')
        }
      }
    }

    this.store.deleteWorkspace(workspaceId)
    return this.store.getSnapshot()
  }

  private invalidInput(error: string): WorkspaceGitStatusFailure {
    return { code: 'invalid-input', error, ok: false }
  }

  private async getOwnedWorkspace(
    workspaceId: string,
  ): Promise<
    | WorkspaceGitStatusFailure
    | { ok: true; project: ProjectRecord; workspace: WorkspaceRecord }
  > {
    if (typeof workspaceId !== 'string' || !workspaceId.trim()) {
      return this.invalidInput('A workspace is required.')
    }

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
        code: 'workspace-not-owned',
        error: 'Workspace does not belong to a configured project.',
        ok: false,
      }
    }
    if (project.kind === 'folder') {
      return {
        code: 'not-a-git-worktree',
        error: 'Git actions are unavailable for folder projects.',
        ok: false,
      }
    }

    try {
      const [projectCommonDir, workspaceCommonDir] = await Promise.all([
        this.resolveGitCommonDir(project.repoRoot),
        this.resolveGitCommonDir(workspace.worktreePath),
      ])
      if (projectCommonDir !== workspaceCommonDir) {
        return {
          code: 'workspace-not-owned',
          error: 'Workspace is not a worktree of its configured project.',
          ok: false,
        }
      }
      return { ok: true, project, workspace }
    } catch (error) {
      return classifyWorkspaceGitStatusError(error)
    }
  }

  private async getMutableWorkspaceFile(
    input: WorkspaceGitFileMutationInput,
  ): Promise<
    | WorkspaceGitStatusFailure
    | { file: WorkspaceGitFileStatus; ok: true; workspace: WorkspaceRecord }
  > {
    if (
      !input ||
      typeof input.workspaceId !== 'string' ||
      typeof input.filePath !== 'string'
    ) {
      return this.invalidInput('A workspace and file path are required.')
    }
    const context = await this.getOwnedWorkspace(input.workspaceId)
    if (!context.ok) return context

    if (
      !this.isSafeWorkspaceFilePath(
        input.filePath,
        context.workspace.worktreePath,
      )
    ) {
      return this.invalidInput(
        'File path must name a changed file inside the workspace.',
      )
    }

    const statusResult = await this.getWorkspaceStatus(context.workspace.id)
    if (!statusResult.ok) return statusResult
    const file = statusResult.status.files.find(
      (candidate) => candidate.path === input.filePath,
    )
    if (!file) {
      return {
        code: 'file-not-found',
        error: 'Changed file does not exist in workspace Git status.',
        ok: false,
      }
    }
    return { file, ok: true, workspace: context.workspace }
  }

  private async getMutationStatus(
    workspaceId: string,
  ): Promise<WorkspaceGitMutationResult> {
    return this.getWorkspaceStatus(workspaceId)
  }

  private isSafeWorkspaceFilePath(
    filePath: string,
    workspaceRoot: string,
  ): boolean {
    if (
      typeof filePath !== 'string' ||
      !filePath ||
      filePath.includes('\0') ||
      path.isAbsolute(filePath) ||
      path.posix.isAbsolute(filePath)
    ) {
      return false
    }
    const segments = filePath.split('/')
    if (
      segments.some(
        (segment) => !segment || segment === '.' || segment === '..',
      )
    ) {
      return false
    }
    return isInsideRoot(
      path.resolve(workspaceRoot),
      this.resolveWorkspaceFilePath(workspaceRoot, filePath),
    )
  }

  private resolveWorkspaceFilePath(
    workspaceRoot: string,
    filePath: string,
  ): string {
    return path.resolve(workspaceRoot, filePath)
  }

  private getGitFilePaths(file: WorkspaceGitFileStatus): string[] {
    return file.originalPath && file.originalPath !== file.path
      ? [file.originalPath, file.path]
      : [file.path]
  }

  private isValidFingerprint(fingerprint: string): boolean {
    return typeof fingerprint === 'string' && /^[a-f0-9]{64}$/.test(fingerprint)
  }

  private async resolvePushBranch(worktreePath: string): Promise<string> {
    try {
      return await this.runGit(
        ['symbolic-ref', '--quiet', '--short', 'HEAD'],
        worktreePath,
      )
    } catch (error) {
      if (
        formatGitError(error, '').message.includes(
          'Configured executable "git"',
        )
      ) {
        throw error
      }
      throw new Error('DETACHED_HEAD')
    }
  }

  private classifyPushError(error: unknown): WorkspaceGitStatusFailure {
    const message = formatGitError(error, '').message

    if (message === 'DETACHED_HEAD') {
      return {
        code: 'detached-head',
        error: 'Push requires a checked out branch.',
        ok: false,
      }
    }
    if (/\[rejected]|non-fast-forward|fetch first/i.test(message)) {
      return {
        code: 'push-rejected',
        error: 'Remote has new commits.',
        ok: false,
      }
    }
    return classifyWorkspaceGitStatusError(error)
  }

  private async collectMessageChanges(
    worktreePath: string,
    defaultBranch: string,
    changedPaths: readonly string[],
  ): Promise<{ diff: string; paths: readonly string[] }> {
    if (changedPaths.length > 0) {
      return {
        diff: await this.runGit(['diff', 'HEAD'], worktreePath),
        paths: changedPaths,
      }
    }

    const baseRef = await this.resolveComparisonBase(
      worktreePath,
      defaultBranch,
    )
    if (!baseRef) {
      return { diff: '', paths: [] }
    }

    const [diff, names] = await Promise.all([
      this.runGit(['diff', `${baseRef}...HEAD`], worktreePath),
      this.runGit(['diff', '--name-only', `${baseRef}...HEAD`], worktreePath),
    ])

    return { diff, paths: splitPathLines(names) }
  }

  private async requireGitHubAuthentication(
    worktreePath: string,
  ): Promise<void> {
    try {
      await this.runGh(['auth', 'status'], worktreePath)
    } catch (error) {
      const message = formatGitError(
        error,
        'GitHub CLI authentication is required.',
      ).message
      if (message.includes('Configured executable "gh"')) {
        throw error
      }
      throw new Error(`GH_AUTH_REQUIRED: ${message}`)
    }
  }

  private classifyPullRequestError(error: unknown): WorkspaceGitStatusFailure {
    const message = formatGitError(
      error,
      'Unable to use the GitHub CLI.',
    ).message
    if (message.includes('DETACHED_HEAD')) {
      return {
        code: 'detached-head',
        error: 'Pull requests require a checked out branch.',
        ok: false,
      }
    }
    if (message.includes('Configured executable "gh"')) {
      return { code: 'gh-unavailable', error: message, ok: false }
    }
    if (message.startsWith('GH_AUTH_REQUIRED:')) {
      return {
        code: 'gh-auth-required',
        error: message.slice('GH_AUTH_REQUIRED:'.length).trim(),
        ok: false,
      }
    }
    return { code: 'gh-command-failed', error: message, ok: false }
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
        name: metadata.currentBranchLabel || metadata.projectName,
        projectId: project.id,
        windowId: null,
        worktreePath: metadata.repoRoot,
      })
    }

    return (
      this.store.updateWorkspace(existingWorkspace.id, {
        branchName: metadata.currentBranchLabel,
        ...(existingWorkspace.nameSource === 'default'
          ? { name: metadata.currentBranchLabel || metadata.projectName }
          : {}),
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
        kind: metadata.kind,
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
      kind: 'git',
      projectName: resolveProjectName(repoRoot),
      remoteUrl,
      repoRoot,
    }
  }

  private async buildDiffSections(
    workspace: WorkspaceRecord,
    file: WorkspaceGitFileStatus,
  ): Promise<{
    fingerprint: string
    sections: WorkspaceGitDiffSection[]
  }> {
    const patches: { kind: WorkspaceGitDiffSection['kind']; patch: string }[] =
      []

    if (file.isStaged) {
      const patch = await this.runGit(
        [
          'diff',
          '--no-ext-diff',
          '--src-prefix=a/',
          '--dst-prefix=b/',
          '--cached',
          '--unified=3',
          '--',
          file.path,
        ],
        workspace.worktreePath,
      )
      patches.push({ kind: 'staged', patch })
    }

    if (file.isUnstaged) {
      if (file.unstaged === 'untracked') {
        patches.push({
          kind: 'untracked',
          patch: await readUntrackedPatch(workspace.worktreePath, file.path),
        })
      } else {
        const patch = await this.runGit(
          [
            'diff',
            '--no-ext-diff',
            '--src-prefix=a/',
            '--dst-prefix=b/',
            '--unified=3',
            '--',
            file.path,
          ],
          workspace.worktreePath,
        )
        patches.push({ kind: 'unstaged', patch })
      }
    }

    const [indexEntries, workingTreeDigest] = await Promise.all([
      file.isStaged
        ? this.runGit(
            ['ls-files', '--stage', '--', ...this.getGitFilePaths(file)],
            workspace.worktreePath,
          )
        : Promise.resolve(''),
      file.isUnstaged
        ? readWorkspaceFileDigest(workspace.worktreePath, file.path)
        : Promise.resolve(null),
    ])

    return {
      fingerprint: createHash('sha256')
        .update(
          JSON.stringify({
            file: {
              originalPath: file.originalPath,
              path: file.path,
              staged: file.staged,
              unstaged: file.unstaged,
            },
            indexEntries,
            patches,
            workingTreeDigest,
          }),
        )
        .digest('hex'),
      sections: patches.map(({ kind, patch }) => {
        const truncated = truncateDiffOutput(patch)
        return {
          isTruncated: truncated.isTruncated,
          kind,
          patch: truncated.patch,
          title:
            kind === 'staged'
              ? 'Staged diff'
              : kind === 'unstaged'
                ? 'Working tree diff'
                : 'Untracked file',
        }
      }),
    }
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

  private async resolveProjectDirectory(projectPath: string): Promise<string> {
    const candidatePath = path.resolve(projectPath.trim())

    if (!projectPath.trim()) {
      throw new Error('Project path is required.')
    }

    const projectStatus = await stat(candidatePath).catch((error: unknown) => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        throw new Error(`Folder "${candidatePath}" does not exist.`)
      }
      throw error
    })

    if (!projectStatus.isDirectory()) {
      throw new Error(`Path "${candidatePath}" is not a folder.`)
    }

    return realpath(candidatePath)
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

      if (
        /not a git repository|not a git directory|not a git work tree/i.test(
          message,
        )
      ) {
        throw new NotGitRepositoryError(message)
      }

      throw formatGitError(error, 'Unable to inspect the selected folder.')
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

  private async runGit(args: string[], cwd: string): Promise<string> {
    const gitPath = await this.resolveGitPath()
    const result = await execFileAsync(gitPath, args, {
      cwd,
      env: process.env,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
      timeout: 10000,
    })

    return `${result.stdout}`.trim()
  }

  private async runGh(args: readonly string[], cwd: string): Promise<string> {
    if (this.runGitHubCommand) {
      return this.runGitHubCommand(args, cwd)
    }
    const ghPath = await this.resolveGhPath()
    const result = await execFileAsync(ghPath, args, {
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

  private async resolveGhPath(): Promise<string> {
    this.ghPathPromise ??= resolveExecutablePath('gh')
    return this.ghPathPromise
  }
}

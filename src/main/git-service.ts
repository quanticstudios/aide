import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { promisify } from 'node:util'

import type {
  CreateWorkspaceRequest,
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

const execFileAsync = promisify(execFile)
const MAX_DIFF_OUTPUT_CHARACTERS = 20_000

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

export class GitWorkspaceService {
  private gitPathPromise: Promise<string> | null = null

  public constructor(private readonly store: GitWorkspaceStore) {}

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

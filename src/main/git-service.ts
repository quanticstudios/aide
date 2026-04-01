import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

import type {
  CreateWorkspaceRequest,
  ImportProjectResult,
  ProjectRefRecord,
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

export class GitWorkspaceService {
  private gitPathPromise: Promise<string> | null = null

  public constructor(private readonly store: GitWorkspaceStore) {}

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

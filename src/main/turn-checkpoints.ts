import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  readlink,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'

import type {
  CheckpointRestoreMode,
  ManagedTurnCheckpointRecorder,
  TurnCheckpointCaptureInput,
  TurnCheckpointChange,
  TurnCheckpointPreview,
  TurnCheckpointRestoreSeed,
  TurnCheckpointSummary,
} from '../shared/checkpoints'
import type { ManagedSessionSnapshot } from '../shared/managed-session'

const execFileAsync = promisify(execFile)
const checkpointVersion = 1
const previewLifetimeMs = 10 * 60 * 1_000
const maxGitOutputBytes = 16 * 1024 * 1024

interface StoredTurnCheckpoint {
  afterTreeHash?: string
  capturedAt: string
  checkpointId: string
  commitHash: string
  config: TurnCheckpointCaptureInput['config']
  editedPrompt: string
  repositoryRoot: string
  snapshot: ManagedSessionSnapshot
  treeHash: string
  version: typeof checkpointVersion
}

interface PendingCheckpointPreview {
  checkpoint: StoredTurnCheckpoint
  currentTreeHash: string
  expiresAtMs: number
  preview: TurnCheckpointPreview
}

export interface TurnCheckpointServiceOptions {
  getSessionSnapshot: (
    sessionId: string,
  ) => ManagedSessionSnapshot | null | undefined
  isSessionActive: (sessionId: string) => boolean
  now?: () => Date
  storageDirectory: string
}

interface GitTreeSnapshot {
  commitHash: string
  treeHash: string
}

function cloneValue<T>(value: T): T {
  return structuredClone(value)
}

function checkpointFileName(checkpointId: string): string {
  return `${checkpointId}.json`
}

function validateCheckpointId(checkpointId: string): void {
  if (!/^[0-9a-f-]{36}$/.test(checkpointId)) {
    throw new Error('The checkpoint identifier is invalid.')
  }
}

function validateRelativeGitPath(filePath: string): void {
  const segments = filePath.split('/')
  if (
    filePath.length === 0 ||
    filePath.includes('\0') ||
    path.isAbsolute(filePath) ||
    path.win32.isAbsolute(filePath) ||
    segments.some(
      (segment) =>
        segment.length === 0 ||
        segment === '.' ||
        segment === '..' ||
        segment === '.git',
    )
  ) {
    throw new Error('Git returned a path outside the checkpoint workspace.')
  }
}

function parseNameStatus(output: string): TurnCheckpointChange[] {
  const fields = output.split('\0')
  if (fields.at(-1) === '') fields.pop()
  const changes: TurnCheckpointChange[] = []

  for (let index = 0; index < fields.length; ) {
    const statusField = fields[index++]
    const statusCode = statusField?.[0]
    const firstPath = fields[index++]
    if (!statusCode || !firstPath) {
      throw new Error('Git returned an incomplete checkpoint diff.')
    }
    validateRelativeGitPath(firstPath)

    if (statusCode === 'R' || statusCode === 'C') {
      const nextPath = fields[index++]
      if (!nextPath) throw new Error('Git returned an incomplete rename.')
      validateRelativeGitPath(nextPath)
      changes.push({
        path: nextPath,
        previousPath: firstPath,
        status: statusCode === 'R' ? 'renamed' : 'copied',
      })
      continue
    }

    const statusByCode: Partial<
      Record<string, TurnCheckpointChange['status']>
    > = {
      A: 'added',
      D: 'deleted',
      M: 'modified',
      T: 'type-changed',
    }
    const status = statusByCode[statusCode]
    if (!status)
      throw new Error(`Git returned unsupported status ${statusCode}.`)
    changes.push({ path: firstPath, status })
  }

  return changes
}

function isStoredCheckpoint(value: unknown): value is StoredTurnCheckpoint {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    record.version === checkpointVersion &&
    typeof record.capturedAt === 'string' &&
    typeof record.checkpointId === 'string' &&
    typeof record.commitHash === 'string' &&
    typeof record.editedPrompt === 'string' &&
    typeof record.repositoryRoot === 'string' &&
    typeof record.treeHash === 'string' &&
    typeof record.config === 'object' &&
    typeof record.snapshot === 'object'
  )
}

export class TurnCheckpointService implements ManagedTurnCheckpointRecorder {
  private readonly previews = new Map<string, PendingCheckpointPreview>()

  public constructor(private readonly options: TurnCheckpointServiceOptions) {}

  public async captureTurn(
    input: TurnCheckpointCaptureInput,
  ): Promise<TurnCheckpointSummary> {
    if (
      input.config.sessionId !== input.snapshot.sessionId ||
      input.config.workspaceId !== input.snapshot.workspaceId
    ) {
      throw new Error(
        'The managed session does not match its checkpoint input.',
      )
    }

    const repositoryRoot = await this.resolveRepositoryRoot(input.config.cwd)
    await this.prepareStorage()
    const checkpointId = randomUUID()
    const tree = await this.captureGitTree(repositoryRoot, checkpointId)
    const capturedAt = this.getNow().toISOString()
    const checkpoint: StoredTurnCheckpoint = {
      capturedAt,
      checkpointId,
      commitHash: tree.commitHash,
      config: cloneValue(input.config),
      editedPrompt: input.editedPrompt,
      repositoryRoot,
      snapshot: cloneValue(input.snapshot),
      treeHash: tree.treeHash,
      version: checkpointVersion,
    }

    await this.writeCheckpoint(checkpoint)
    return this.toSummary(checkpoint)
  }

  public async completeTurn(checkpointId: string): Promise<void> {
    const checkpoint = await this.readCheckpoint(checkpointId)
    if (checkpoint.afterTreeHash) return
    const tree = await this.captureGitTree(checkpoint.repositoryRoot)
    checkpoint.afterTreeHash = tree.treeHash
    await this.writeCheckpoint(checkpoint)
  }

  public async listCheckpoints(
    sessionId: string,
  ): Promise<TurnCheckpointSummary[]> {
    await this.prepareStorage()
    const fileNames = await readdir(this.options.storageDirectory)
    const checkpoints = await Promise.all(
      fileNames
        .filter((fileName) => fileName.endsWith('.json'))
        .map((fileName) => this.readCheckpoint(fileName.slice(0, -5))),
    )

    return checkpoints
      .filter((checkpoint) => checkpoint.config.sessionId === sessionId)
      .sort((left, right) => left.capturedAt.localeCompare(right.capturedAt))
      .map((checkpoint) => this.toSummary(checkpoint))
  }

  public async previewRestore(
    sessionId: string,
    checkpointId: string,
  ): Promise<TurnCheckpointPreview> {
    this.assertSessionIdle(sessionId)
    const checkpoint = await this.readCheckpoint(checkpointId)
    if (checkpoint.config.sessionId !== sessionId) {
      throw new Error('The checkpoint belongs to another managed session.')
    }

    const currentSnapshot = this.requireSessionSnapshot(sessionId)
    const currentTree = await this.captureGitTree(checkpoint.repositoryRoot)
    const changes = await this.getRestoreChanges(
      checkpoint.repositoryRoot,
      checkpoint.treeHash,
      currentTree.treeHash,
    )
    const turnChanges = checkpoint.afterTreeHash
      ? await this.getTreeChanges(
          checkpoint.repositoryRoot,
          checkpoint.treeHash,
          checkpoint.afterTreeHash,
        )
      : null
    const createdAt = this.getNow()
    const previewId = randomUUID()
    const expiresAtMs = createdAt.getTime() + previewLifetimeMs
    const preview: TurnCheckpointPreview = {
      changes,
      checkpoint: this.toSummary(checkpoint),
      createdAt: createdAt.toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
      previewId,
      sessionRevision: currentSnapshot.revision,
      turnChanges,
    }
    this.previews.set(previewId, {
      checkpoint,
      currentTreeHash: currentTree.treeHash,
      expiresAtMs,
      preview,
    })
    return cloneValue(preview)
  }

  public async restore(
    previewId: string,
    mode: CheckpointRestoreMode,
  ): Promise<TurnCheckpointRestoreSeed> {
    if (mode !== 'conversation-only' && mode !== 'code-and-conversation') {
      throw new Error('Choose a supported checkpoint restore mode.')
    }
    const pending = this.previews.get(previewId)
    if (!pending)
      throw new Error('Preview the checkpoint again before restoring.')
    const { checkpoint, preview } = pending
    this.assertSessionIdle(checkpoint.config.sessionId)

    if (this.getNow().getTime() > pending.expiresAtMs) {
      this.previews.delete(previewId)
      throw new Error('The checkpoint preview expired. Preview it again.')
    }

    const currentSnapshot = this.requireSessionSnapshot(
      checkpoint.config.sessionId,
    )
    if (currentSnapshot.revision !== preview.sessionRevision) {
      throw new Error(
        'The conversation changed after the preview. Preview it again.',
      )
    }

    const currentTree = await this.captureGitTree(checkpoint.repositoryRoot)
    if (currentTree.treeHash !== pending.currentTreeHash) {
      throw new Error(
        'Workspace files changed after the preview. Preview them again.',
      )
    }

    if (mode === 'code-and-conversation') {
      await this.restoreGitTree(
        checkpoint.repositoryRoot,
        currentTree.treeHash,
        checkpoint.treeHash,
        previewId,
      )
    }

    this.previews.delete(previewId)
    return {
      checkpointId: checkpoint.checkpointId,
      config: cloneValue(checkpoint.config),
      editedPrompt: checkpoint.editedPrompt,
      mode,
      snapshot: cloneValue(checkpoint.snapshot),
      sourceSessionId: checkpoint.config.sessionId,
    }
  }

  private getNow(): Date {
    return this.options.now?.() ?? new Date()
  }

  private assertSessionIdle(sessionId: string): void {
    if (this.options.isSessionActive(sessionId)) {
      throw new Error('Stop the running task before using a checkpoint.')
    }
  }

  private requireSessionSnapshot(sessionId: string): ManagedSessionSnapshot {
    const snapshot = this.options.getSessionSnapshot(sessionId)
    if (!snapshot) throw new Error('The managed session is unavailable.')
    return snapshot
  }

  private async prepareStorage(): Promise<void> {
    await mkdir(this.options.storageDirectory, { mode: 0o700, recursive: true })
    await chmod(this.options.storageDirectory, 0o700)
  }

  private checkpointPath(checkpointId: string): string {
    validateCheckpointId(checkpointId)
    return path.join(
      this.options.storageDirectory,
      checkpointFileName(checkpointId),
    )
  }

  private async readCheckpoint(
    checkpointId: string,
  ): Promise<StoredTurnCheckpoint> {
    const contents = await readFile(
      this.checkpointPath(checkpointId),
      'utf8',
    ).catch(() => {
      throw new Error('The checkpoint is unavailable.')
    })
    let parsed: unknown
    try {
      parsed = JSON.parse(contents)
    } catch {
      throw new Error('The checkpoint file is damaged.')
    }
    if (!isStoredCheckpoint(parsed) || parsed.checkpointId !== checkpointId) {
      throw new Error('The checkpoint file is invalid.')
    }
    return parsed
  }

  private async writeCheckpoint(
    checkpoint: StoredTurnCheckpoint,
  ): Promise<void> {
    const destination = this.checkpointPath(checkpoint.checkpointId)
    const temporary = `${destination}.${randomUUID()}.tmp`
    await writeFile(temporary, JSON.stringify(checkpoint), {
      encoding: 'utf8',
      mode: 0o600,
    })
    await rename(temporary, destination)
  }

  private toSummary(checkpoint: StoredTurnCheckpoint): TurnCheckpointSummary {
    return {
      capturedAt: checkpoint.capturedAt,
      checkpointId: checkpoint.checkpointId,
      sessionId: checkpoint.config.sessionId,
      workspaceId: checkpoint.config.workspaceId,
    }
  }

  private async resolveRepositoryRoot(
    workingDirectory: string,
  ): Promise<string> {
    const resolvedWorkingDirectory = await realpath(workingDirectory)
    const { stdout } = await execFileAsync(
      'git',
      ['rev-parse', '--show-toplevel'],
      {
        cwd: resolvedWorkingDirectory,
        encoding: 'utf8',
        maxBuffer: maxGitOutputBytes,
      },
    )
    const repositoryRoot = await realpath(stdout.trim())
    if (repositoryRoot !== resolvedWorkingDirectory) {
      throw new Error('Checkpoint sessions must use the workspace root.')
    }
    return repositoryRoot
  }

  private async runGit(
    repositoryRoot: string,
    arguments_: string[],
    environment: NodeJS.ProcessEnv = process.env,
  ): Promise<string> {
    const { stdout } = await execFileAsync('git', arguments_, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      env: environment,
      maxBuffer: maxGitOutputBytes,
    })
    return stdout
  }

  private async captureGitTree(
    repositoryRoot: string,
    checkpointId?: string,
  ): Promise<GitTreeSnapshot> {
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), 'aide-turn-checkpoint-'),
    )
    const indexPath = path.join(temporaryDirectory, 'index')
    const environment = {
      ...process.env,
      GIT_INDEX_FILE: indexPath,
    }

    try {
      const hasHead = await this.runGit(
        repositoryRoot,
        ['rev-parse', '--verify', '--quiet', 'HEAD'],
        environment,
      ).then(
        () => true,
        () => false,
      )
      await this.runGit(
        repositoryRoot,
        hasHead ? ['read-tree', 'HEAD'] : ['read-tree', '--empty'],
        environment,
      )
      await this.runGit(repositoryRoot, ['add', '-A', '--', '.'], environment)
      const treeHash = (
        await this.runGit(repositoryRoot, ['write-tree'], environment)
      ).trim()
      const commitHash = (
        await this.runGit(
          repositoryRoot,
          ['commit-tree', treeHash, '-m', 'Aide turn checkpoint'],
          {
            ...environment,
            GIT_AUTHOR_EMAIL: 'checkpoint@aide.local',
            GIT_AUTHOR_NAME: 'Aide checkpoint',
            GIT_COMMITTER_EMAIL: 'checkpoint@aide.local',
            GIT_COMMITTER_NAME: 'Aide checkpoint',
          },
        )
      ).trim()

      if (checkpointId) {
        await this.runGit(repositoryRoot, [
          'update-ref',
          `refs/aide/checkpoints/${checkpointId}`,
          commitHash,
        ])
      }
      return { commitHash, treeHash }
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true })
    }
  }

  private async getTreeChanges(
    repositoryRoot: string,
    beforeTreeHash: string,
    afterTreeHash: string,
  ): Promise<TurnCheckpointChange[]> {
    if (beforeTreeHash === afterTreeHash) return []
    const output = await this.runGit(repositoryRoot, [
      'diff-tree',
      '--name-status',
      '-z',
      '-r',
      '-M',
      beforeTreeHash,
      afterTreeHash,
    ])
    return parseNameStatus(output)
  }

  private async getRestoreChanges(
    repositoryRoot: string,
    targetTreeHash: string,
    currentTreeHash: string,
  ): Promise<TurnCheckpointChange[]> {
    const output = await this.runGit(repositoryRoot, [
      'diff-tree',
      '--name-status',
      '-z',
      '-r',
      '--no-renames',
      targetTreeHash,
      currentTreeHash,
    ])
    return parseNameStatus(output).map((change) => ({
      ...change,
      status:
        change.status === 'added'
          ? 'deleted'
          : change.status === 'deleted'
            ? 'added'
            : change.status,
    }))
  }

  private async restoreGitTree(
    repositoryRoot: string,
    currentTreeHash: string,
    targetTreeHash: string,
    previewId: string,
  ): Promise<void> {
    if (currentTreeHash === targetTreeHash) return
    const changes = await this.getRestoreChanges(
      repositoryRoot,
      targetTreeHash,
      currentTreeHash,
    )
    const temporaryDirectory = await mkdtemp(
      path.join(tmpdir(), 'aide-turn-restore-'),
    )
    const indexPath = path.join(temporaryDirectory, 'index')
    const stagedTree = path.join(temporaryDirectory, 'tree')
    const environment = { ...process.env, GIT_INDEX_FILE: indexPath }

    try {
      await mkdir(stagedTree)
      await this.runGit(
        repositoryRoot,
        ['read-tree', targetTreeHash],
        environment,
      )
      await this.runGit(
        repositoryRoot,
        [
          'checkout-index',
          '--all',
          '--force',
          `--prefix=${stagedTree}${path.sep}`,
        ],
        environment,
      )
      const safetyCommit = (
        await this.runGit(
          repositoryRoot,
          ['commit-tree', currentTreeHash, '-m', 'Aide pre-restore recovery'],
          {
            ...environment,
            GIT_AUTHOR_EMAIL: 'checkpoint@aide.local',
            GIT_AUTHOR_NAME: 'Aide checkpoint',
            GIT_COMMITTER_EMAIL: 'checkpoint@aide.local',
            GIT_COMMITTER_NAME: 'Aide checkpoint',
          },
        )
      ).trim()
      await this.runGit(repositoryRoot, [
        'update-ref',
        `refs/aide/restores/${previewId}`,
        safetyCommit,
      ])

      await this.validateRestoreDestinations(repositoryRoot, changes)

      for (const change of changes
        .filter((candidate) => candidate.status === 'deleted')
        .sort((left, right) => right.path.length - left.path.length)) {
        await this.assertSafeParentPath(repositoryRoot, change.path)
        const destination = path.join(repositoryRoot, change.path)
        const destinationEntry = await lstat(destination).catch(() => null)
        if (destinationEntry?.isDirectory()) {
          throw new Error(
            'Checkpoint restore refuses to delete a workspace directory.',
          )
        }
        await rm(destination, { force: true })
      }

      for (const change of changes
        .filter((candidate) => candidate.status !== 'deleted')
        .sort((left, right) => left.path.length - right.path.length)) {
        await this.copyTreeEntry(stagedTree, repositoryRoot, change.path)
      }
    } finally {
      await rm(temporaryDirectory, { force: true, recursive: true })
    }
  }

  private async validateRestoreDestinations(
    repositoryRoot: string,
    changes: TurnCheckpointChange[],
  ): Promise<void> {
    for (const change of changes) {
      await this.assertSafeParentPath(repositoryRoot, change.path)
      const destination = path.join(repositoryRoot, change.path)
      const entry = await lstat(destination).catch(() => null)
      if (entry?.isDirectory()) {
        throw new Error(
          'Checkpoint restore refuses to replace a workspace directory. Move its contents, then preview again.',
        )
      }
    }
  }

  private async assertSafeParentPath(
    repositoryRoot: string,
    relativePath: string,
  ): Promise<void> {
    validateRelativeGitPath(relativePath)
    const segments = relativePath.split('/').slice(0, -1)
    let currentPath = repositoryRoot
    for (const segment of segments) {
      currentPath = path.join(currentPath, segment)
      const entry = await lstat(currentPath).catch(() => null)
      if (entry?.isSymbolicLink()) {
        throw new Error(
          'Checkpoint restore refuses to traverse a workspace symlink.',
        )
      }
      if (entry && !entry.isDirectory()) {
        throw new Error('Checkpoint restore found a non-directory parent path.')
      }
    }
  }

  private async copyTreeEntry(
    stagedTree: string,
    repositoryRoot: string,
    relativePath: string,
  ): Promise<void> {
    await this.assertSafeParentPath(repositoryRoot, relativePath)
    const source = path.join(stagedTree, relativePath)
    const destination = path.join(repositoryRoot, relativePath)
    const sourceEntry = await lstat(source)
    await mkdir(path.dirname(destination), { recursive: true })
    const destinationEntry = await lstat(destination).catch(() => null)
    if (destinationEntry?.isDirectory()) {
      throw new Error(
        'Checkpoint restore refuses to replace a workspace directory.',
      )
    }
    await rm(destination, { force: true })

    if (sourceEntry.isSymbolicLink()) {
      await symlink(await readlink(source), destination)
      return
    }
    if (!sourceEntry.isFile()) {
      throw new Error(
        'Checkpoint restore supports files and leaf symlinks only.',
      )
    }
    await copyFile(source, destination)
    await chmod(destination, sourceEntry.mode & 0o777)
  }
}

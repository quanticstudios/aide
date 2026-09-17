import { execFileSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type { TurnCheckpointCaptureInput } from '../shared/checkpoints'
import type { ManagedSessionSnapshot } from '../shared/managed-session'
import { TurnCheckpointService } from './turn-checkpoints'

const gitEnvironment = {
  ...process.env,
  GIT_AUTHOR_EMAIL: 'aide@example.com',
  GIT_AUTHOR_NAME: 'Aide Test',
  GIT_COMMITTER_EMAIL: 'aide@example.com',
  GIT_COMMITTER_NAME: 'Aide Test',
}

const temporaryDirectories: string[] = []

interface CheckpointTestState {
  active: boolean
  snapshot: ManagedSessionSnapshot
  workspaceDirectory?: string | null
}

function createTemporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix))
  temporaryDirectories.push(directory)
  return directory
}

function runGit(workingDirectory: string, arguments_: string[]): string {
  return execFileSync('git', arguments_, {
    cwd: workingDirectory,
    encoding: 'utf8',
    env: gitEnvironment,
  }).trim()
}

function createRepository(): string {
  const repositoryRoot = createTemporaryDirectory('aide-checkpoint-repository-')
  runGit(repositoryRoot, ['init', '-b', 'main'])
  writeFileSync(path.join(repositoryRoot, '.gitignore'), 'secret.env\n')
  writeFileSync(path.join(repositoryRoot, 'README.md'), 'before\n')
  runGit(repositoryRoot, ['add', '.gitignore', 'README.md'])
  runGit(repositoryRoot, ['commit', '-m', 'Initial'])
  return repositoryRoot
}

function createSnapshot(revision = 1): ManagedSessionSnapshot {
  return {
    content: [
      {
        id: 'prompt-1',
        kind: 'user-prompt',
        provider: null,
        text: 'original history',
        turnId: 'turn-1',
        updatedAt: '2026-09-17T10:00:00.000Z',
      },
    ],
    detail: null,
    effort: null,
    interactionMode: 'build',
    lastCompletedAt: '2026-09-17T10:00:00.000Z',
    lastError: null,
    lastErrorAt: null,
    model: null,
    paneId: 'pane-1',
    pendingApprovals: [],
    pendingUserInputs: [],
    planApproval: null,
    provider: 'codex',
    revision,
    running: true,
    runtimeGeneration: 1,
    selectionNotice: null,
    serviceTier: null,
    sessionId: 'session-1',
    sessionState: 'ready',
    turns: [],
    updatedAt: '2026-09-17T10:00:00.000Z',
    workspaceId: 'workspace-1',
  }
}

function createCaptureInput(
  repositoryRoot: string,
  snapshot: ManagedSessionSnapshot,
  editedPrompt = 'edited prompt',
): TurnCheckpointCaptureInput {
  return {
    config: {
      cwd: repositoryRoot,
      mode: 'codex',
      paneId: snapshot.paneId,
      sessionId: snapshot.sessionId,
      workspaceId: snapshot.workspaceId,
    },
    editedPrompt,
    snapshot,
  }
}

function createService(
  repositoryRoot: string,
  state: CheckpointTestState,
  now?: () => Date,
): TurnCheckpointService {
  return new TurnCheckpointService({
    getSessionSnapshot: () => state.snapshot,
    getWorkspaceDirectory: () =>
      state.workspaceDirectory === undefined
        ? repositoryRoot
        : state.workspaceDirectory,
    isSessionActive: () => state.active,
    now,
    storageDirectory: path.join(
      repositoryRoot,
      '.git',
      'aide-checkpoint-tests',
    ),
  })
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    const directory = temporaryDirectories.pop()
    if (directory) rmSync(directory, { force: true, recursive: true })
  }
})

describe('TurnCheckpointService', () => {
  it('restores tracked and Git-visible untracked files without touching ignored files', async () => {
    const repositoryRoot = createRepository()
    const externalDirectory = createTemporaryDirectory(
      'aide-checkpoint-external-',
    )
    const externalFile = path.join(externalDirectory, 'outside.txt')
    writeFileSync(externalFile, 'outside\n')
    writeFileSync(path.join(repositoryRoot, 'notes.txt'), 'notes before\n')
    writeFileSync(path.join(repositoryRoot, 'secret.env'), 'secret before\n')
    symlinkSync(externalFile, path.join(repositoryRoot, 'external-link'))
    const state = { active: false, snapshot: createSnapshot() }
    const service = createService(repositoryRoot, state)
    const checkpoint = await service.captureTurn(
      createCaptureInput(repositoryRoot, state.snapshot),
    )

    writeFileSync(path.join(repositoryRoot, 'README.md'), 'after\n')
    writeFileSync(path.join(repositoryRoot, 'notes.txt'), 'notes after\n')
    writeFileSync(path.join(repositoryRoot, 'created.txt'), 'created\n')
    writeFileSync(path.join(repositoryRoot, 'secret.env'), 'secret after\n')
    unlinkSync(path.join(repositoryRoot, 'external-link'))
    symlinkSync('/does/not/exist', path.join(repositoryRoot, 'external-link'))

    const preview = await service.previewRestore(
      state.snapshot.sessionId,
      checkpoint.checkpointId,
    )
    const seed = await service.restore(
      preview.previewId,
      'code-and-conversation',
    )

    expect(preview.changes.map((change) => change.path)).toEqual(
      expect.arrayContaining([
        'README.md',
        'created.txt',
        'external-link',
        'notes.txt',
      ]),
    )
    expect(readFileSync(path.join(repositoryRoot, 'README.md'), 'utf8')).toBe(
      'before\n',
    )
    expect(readFileSync(path.join(repositoryRoot, 'notes.txt'), 'utf8')).toBe(
      'notes before\n',
    )
    expect(() =>
      readFileSync(path.join(repositoryRoot, 'created.txt')),
    ).toThrow()
    expect(readFileSync(path.join(repositoryRoot, 'secret.env'), 'utf8')).toBe(
      'secret after\n',
    )
    expect(readFileSync(externalFile, 'utf8')).toBe('outside\n')
    expect(seed.editedPrompt).toBe('edited prompt')
    expect(seed.snapshot.content[0]?.text).toBe('original history')
    expect(
      runGit(repositoryRoot, [
        'show-ref',
        '--verify',
        `refs/aide/checkpoints/${checkpoint.checkpointId}`,
      ]),
    ).not.toBe('')
    expect(
      runGit(repositoryRoot, [
        'show-ref',
        '--verify',
        `refs/aide/restores/${preview.previewId}`,
      ]),
    ).not.toBe('')
  })

  it('rejects file and conversation changes made after preview', async () => {
    const repositoryRoot = createRepository()
    const state = { active: false, snapshot: createSnapshot() }
    const service = createService(repositoryRoot, state)
    const checkpoint = await service.captureTurn(
      createCaptureInput(repositoryRoot, state.snapshot),
    )
    writeFileSync(path.join(repositoryRoot, 'README.md'), 'turn change\n')

    const filePreview = await service.previewRestore(
      state.snapshot.sessionId,
      checkpoint.checkpointId,
    )
    writeFileSync(path.join(repositoryRoot, 'README.md'), 'post-preview edit\n')
    await expect(
      service.restore(filePreview.previewId, 'code-and-conversation'),
    ).rejects.toThrow('Workspace files changed after the preview')
    expect(readFileSync(path.join(repositoryRoot, 'README.md'), 'utf8')).toBe(
      'post-preview edit\n',
    )

    const conversationPreview = await service.previewRestore(
      state.snapshot.sessionId,
      checkpoint.checkpointId,
    )
    state.snapshot = { ...state.snapshot, revision: 2 }
    await expect(
      service.restore(conversationPreview.previewId, 'conversation-only'),
    ).rejects.toThrow('The conversation changed after the preview')
  })

  it('rejects preview and restore while a task is active', async () => {
    const repositoryRoot = createRepository()
    const state = { active: false, snapshot: createSnapshot() }
    const service = createService(repositoryRoot, state)
    const checkpoint = await service.captureTurn(
      createCaptureInput(repositoryRoot, state.snapshot),
    )
    state.active = true

    await expect(
      service.previewRestore(state.snapshot.sessionId, checkpoint.checkpointId),
    ).rejects.toThrow('Stop the running task')

    state.active = false
    const preview = await service.previewRestore(
      state.snapshot.sessionId,
      checkpoint.checkpointId,
    )
    state.active = true
    await expect(
      service.restore(preview.previewId, 'conversation-only'),
    ).rejects.toThrow('Stop the running task')
  })

  it('rejects an expired preview', async () => {
    const repositoryRoot = createRepository()
    const state = { active: false, snapshot: createSnapshot() }
    let currentTime = new Date('2026-09-17T10:00:00.000Z')
    const service = createService(repositoryRoot, state, () => currentTime)
    const checkpoint = await service.captureTurn(
      createCaptureInput(repositoryRoot, state.snapshot),
    )
    const preview = await service.previewRestore(
      state.snapshot.sessionId,
      checkpoint.checkpointId,
    )
    currentTime = new Date('2026-09-17T10:11:00.000Z')

    await expect(
      service.restore(preview.previewId, 'conversation-only'),
    ).rejects.toThrow('preview expired')
  })

  it('separates completed-turn changes from the exact restore preview', async () => {
    const repositoryRoot = createRepository()
    const state = { active: false, snapshot: createSnapshot() }
    const service = createService(repositoryRoot, state)
    const first = await service.captureTurn(
      createCaptureInput(repositoryRoot, state.snapshot, 'first prompt'),
    )
    writeFileSync(path.join(repositoryRoot, 'README.md'), 'first turn\n')
    await service.completeTurn(first.checkpointId)
    writeFileSync(path.join(repositoryRoot, 'later.txt'), 'later change\n')

    const preview = await service.previewRestore(
      state.snapshot.sessionId,
      first.checkpointId,
    )

    expect(preview.turnChanges).toEqual([
      expect.objectContaining({ path: 'README.md', status: 'modified' }),
    ])
    expect(preview.turnPatch).toContain('-before')
    expect(preview.turnPatch).toContain('+first turn')
    expect(preview.changes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'README.md', status: 'modified' }),
        expect.objectContaining({ path: 'later.txt', status: 'deleted' }),
      ]),
    )
    expect(preview.restorePatch).toContain('-first turn')
    expect(preview.restorePatch).toContain('+before')
    expect(preview.restorePatch).toContain('deleted file mode')
  })

  it('rejects a checkpoint after its workspace path changes', async () => {
    const repositoryRoot = createRepository()
    const replacementRoot = createRepository()
    const state: CheckpointTestState = {
      active: false,
      snapshot: createSnapshot(),
    }
    const service = createService(repositoryRoot, state)
    const checkpoint = await service.captureTurn(
      createCaptureInput(repositoryRoot, state.snapshot),
    )
    state.workspaceDirectory = replacementRoot

    await expect(service.completeTurn(checkpoint.checkpointId)).rejects.toThrow(
      'workspace directory changed',
    )
    await expect(
      service.previewRestore(state.snapshot.sessionId, checkpoint.checkpointId),
    ).rejects.toThrow('workspace directory changed')

    state.workspaceDirectory = repositoryRoot
    const preview = await service.previewRestore(
      state.snapshot.sessionId,
      checkpoint.checkpointId,
    )
    state.workspaceDirectory = replacementRoot
    await expect(
      service.restore(preview.previewId, 'conversation-only'),
    ).rejects.toThrow('workspace directory changed')
  })

  it('restores a conflicted worktree without changing the real index', async () => {
    const repositoryRoot = createRepository()
    runGit(repositoryRoot, ['checkout', '-b', 'other'])
    writeFileSync(path.join(repositoryRoot, 'README.md'), 'other\n')
    runGit(repositoryRoot, ['commit', '-am', 'Other'])
    runGit(repositoryRoot, ['checkout', 'main'])
    writeFileSync(path.join(repositoryRoot, 'README.md'), 'main\n')
    runGit(repositoryRoot, ['commit', '-am', 'Main'])
    expect(() => runGit(repositoryRoot, ['merge', 'other'])).toThrow()
    const conflictedIndex = runGit(repositoryRoot, ['ls-files', '--unmerged'])
    const conflictContents = readFileSync(
      path.join(repositoryRoot, 'README.md'),
      'utf8',
    )
    const state = { active: false, snapshot: createSnapshot() }
    const service = createService(repositoryRoot, state)
    const checkpoint = await service.captureTurn(
      createCaptureInput(repositoryRoot, state.snapshot),
    )
    writeFileSync(path.join(repositoryRoot, 'README.md'), 'edited conflict\n')

    const preview = await service.previewRestore(
      state.snapshot.sessionId,
      checkpoint.checkpointId,
    )
    await service.restore(preview.previewId, 'code-and-conversation')

    expect(readFileSync(path.join(repositoryRoot, 'README.md'), 'utf8')).toBe(
      conflictContents,
    )
    expect(runGit(repositoryRoot, ['ls-files', '--unmerged'])).toBe(
      conflictedIndex,
    )
  })

  it('does not traverse a symlink that replaces a tracked directory', async () => {
    const repositoryRoot = createRepository()
    const externalDirectory = createTemporaryDirectory(
      'aide-checkpoint-target-',
    )
    const externalFile = path.join(externalDirectory, 'file.txt')
    mkdirSync(path.join(repositoryRoot, 'nested'))
    writeFileSync(path.join(repositoryRoot, 'nested', 'file.txt'), 'inside\n')
    writeFileSync(externalFile, 'outside\n')
    runGit(repositoryRoot, ['add', 'nested/file.txt'])
    runGit(repositoryRoot, ['commit', '-m', 'Add nested file'])
    const state = { active: false, snapshot: createSnapshot() }
    const service = createService(repositoryRoot, state)
    const checkpoint = await service.captureTurn(
      createCaptureInput(repositoryRoot, state.snapshot),
    )
    rmSync(path.join(repositoryRoot, 'nested'), { recursive: true })
    symlinkSync(externalDirectory, path.join(repositoryRoot, 'nested'))

    const preview = await service.previewRestore(
      state.snapshot.sessionId,
      checkpoint.checkpointId,
    )
    await expect(
      service.restore(preview.previewId, 'code-and-conversation'),
    ).rejects.toThrow('refuses to traverse a workspace symlink')

    expect(readFileSync(externalFile, 'utf8')).toBe('outside\n')
    expect(
      readFileSync(path.join(repositoryRoot, 'nested', 'file.txt'), 'utf8'),
    ).toBe('outside\n')
  })

  it('rejects a file restore over a directory before deleting ignored contents', async () => {
    const repositoryRoot = createRepository()
    writeFileSync(path.join(repositoryRoot, 'entry'), 'checkpoint file\n')
    runGit(repositoryRoot, ['add', 'entry'])
    runGit(repositoryRoot, ['commit', '-m', 'Add file fixture'])
    const state = { active: false, snapshot: createSnapshot() }
    const service = createService(repositoryRoot, state)
    const checkpoint = await service.captureTurn(
      createCaptureInput(repositoryRoot, state.snapshot),
    )
    rmSync(path.join(repositoryRoot, 'entry'))
    mkdirSync(path.join(repositoryRoot, 'entry'))
    writeFileSync(
      path.join(repositoryRoot, 'entry', 'visible.txt'),
      'visible\n',
    )
    writeFileSync(path.join(repositoryRoot, 'entry', 'secret.env'), 'secret\n')
    const preview = await service.previewRestore(
      state.snapshot.sessionId,
      checkpoint.checkpointId,
    )

    await expect(
      service.restore(preview.previewId, 'code-and-conversation'),
    ).rejects.toThrow('refuses to replace a workspace directory')
    expect(
      readFileSync(path.join(repositoryRoot, 'entry', 'visible.txt'), 'utf8'),
    ).toBe('visible\n')
    expect(
      readFileSync(path.join(repositoryRoot, 'entry', 'secret.env'), 'utf8'),
    ).toBe('secret\n')
  })
})

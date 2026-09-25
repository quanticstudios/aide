import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import type {
  CreateWorkspaceInput,
  WorkspaceRecord,
} from '../shared/persistence'
import { createAideDatabase } from './database'
import { GitWorkspaceService, type GitWorkspaceStore } from './git-service'

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_EMAIL: 'aide@example.com',
  GIT_AUTHOR_NAME: 'Aide Test',
  GIT_COMMITTER_EMAIL: 'aide@example.com',
  GIT_COMMITTER_NAME: 'Aide Test',
}

const tempDirectories: string[] = []

function createTempDirectory(prefix: string): string {
  const directory = mkdtempSync(path.join(tmpdir(), prefix))
  tempDirectories.push(directory)
  return directory
}

function runGit(cwd: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: GIT_ENV,
  }).trim()
}

function createRepositoryWithRemote(): {
  remotePath: string
  repoRoot: string
} {
  const remotePath = createTempDirectory('aide-git-remote-')
  runGit(remotePath, ['init', '--bare', '-b', 'main'])

  const repoRoot = createTempDirectory('aide-git-service-')
  runGit(repoRoot, ['init', '-b', 'main'])
  runGit(repoRoot, ['config', 'user.name', 'Aide Test'])
  runGit(repoRoot, ['config', 'user.email', 'aide@example.com'])
  writeFileSync(path.join(repoRoot, 'README.md'), '# aide\n')
  runGit(repoRoot, ['add', 'README.md'])
  runGit(repoRoot, ['commit', '-m', 'Initial commit'])
  runGit(repoRoot, ['remote', 'add', 'origin', remotePath])
  runGit(repoRoot, ['push', '--set-upstream', 'origin', 'main'])
  runGit(repoRoot, [
    'symbolic-ref',
    'refs/remotes/origin/HEAD',
    'refs/remotes/origin/main',
  ])

  return { remotePath, repoRoot }
}

function pushRemoteCommit(
  remotePath: string,
  filePath: string,
  content: string,
  message: string,
): void {
  const peerRoot = createTempDirectory('aide-git-peer-')
  runGit(peerRoot, ['clone', remotePath, '.'])
  runGit(peerRoot, ['config', 'user.name', 'Aide Peer'])
  runGit(peerRoot, ['config', 'user.email', 'peer@example.com'])
  writeFileSync(path.join(peerRoot, filePath), content)
  runGit(peerRoot, ['add', filePath])
  runGit(peerRoot, ['commit', '-m', message])
  runGit(peerRoot, ['push', 'origin', 'main'])
}

function createGitRepository(options?: { detachedHead?: boolean }): string {
  const repoRoot = createTempDirectory('aide-git-service-')

  runGit(repoRoot, ['init', '-b', 'main'])
  runGit(repoRoot, ['config', 'user.name', 'Aide Test'])
  runGit(repoRoot, ['config', 'user.email', 'aide@example.com'])
  writeFileSync(path.join(repoRoot, 'README.md'), '# aide\n')
  runGit(repoRoot, ['add', 'README.md'])
  runGit(repoRoot, ['commit', '-m', 'Initial commit'])
  runGit(repoRoot, [
    'remote',
    'add',
    'origin',
    'https://github.com/example/aide.git',
  ])
  runGit(repoRoot, ['update-ref', 'refs/remotes/origin/main', 'HEAD'])
  runGit(repoRoot, [
    'symbolic-ref',
    'refs/remotes/origin/HEAD',
    'refs/remotes/origin/main',
  ])

  if (options?.detachedHead) {
    runGit(repoRoot, ['checkout', '--detach', 'HEAD'])
  }

  return repoRoot
}

afterEach(() => {
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop()

    if (directory) {
      rmSync(directory, { force: true, recursive: true })
    }
  }
})

describe('GitWorkspaceService', () => {
  it('imports a repo and creates a root workspace for the main worktree', async () => {
    const repoRoot = createGitRepository()
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)

    const result = await service.importProject(repoRoot)
    const snapshot = result.snapshot

    expect(snapshot.projects).toHaveLength(1)
    expect(snapshot.projects[0]).toMatchObject({
      defaultBranch: 'main',
      kind: 'git',
      name: path.basename(repoRoot),
      remoteUrl: 'https://github.com/example/aide.git',
      repoRoot,
    })
    expect(snapshot.workspaces).toHaveLength(1)
    expect(snapshot.workspaces[0]).toMatchObject({
      branchName: 'main',
      name: 'main',
      projectId: result.projectId,
      worktreePath: repoRoot,
    })
    expect(result.workspaceId).toBe(snapshot.workspaces[0]?.id)

    database.close()
  })

  it('normalizes nested paths to the repo toplevel during import', async () => {
    const repoRoot = createGitRepository()
    const nestedDirectory = path.join(repoRoot, 'src', 'nested')
    mkdirSync(nestedDirectory, { recursive: true })
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)

    const result = await service.importProject(nestedDirectory)

    expect(result.snapshot.projects[0]?.repoRoot).toBe(repoRoot)

    database.close()
  })

  it('reuses existing project records instead of duplicating them', async () => {
    const repoRoot = createGitRepository()
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)

    const firstImport = await service.importProject(repoRoot)
    database.updateWorkspace(firstImport.workspaceId, {
      name: 'Launch review',
      nameSource: 'manual',
    })
    const secondImport = await service.importProject(repoRoot)

    expect(secondImport.projectId).toBe(firstImport.projectId)
    expect(secondImport.workspaceId).toBe(firstImport.workspaceId)
    expect(secondImport.snapshot.projects).toHaveLength(1)
    expect(secondImport.snapshot.workspaces).toHaveLength(1)
    expect(secondImport.snapshot.workspaces[0]).toMatchObject({
      branchName: 'main',
      name: 'Launch review',
      nameSource: 'manual',
      worktreePath: repoRoot,
    })

    database.close()
  })

  it('repairs missing root workspaces for already tracked projects', async () => {
    const repoRoot = createGitRepository()
    const database = createAideDatabase(':memory:')
    const project = database.createProject({
      defaultBranch: 'main',
      name: 'aide',
      remoteUrl: null,
      repoRoot,
    })

    database.createWorkspace({
      branchName: 'feature/review',
      name: 'feature/review',
      projectId: project.id,
      windowId: null,
      worktreePath: `${repoRoot}/.worktrees/review`,
    })

    const service = new GitWorkspaceService(database)
    const result = await service.importProject(repoRoot)
    const rootWorkspace = result.snapshot.workspaces.find(
      (workspace) => workspace.worktreePath === repoRoot,
    )

    expect(result.snapshot.projects).toHaveLength(1)
    expect(result.snapshot.workspaces).toHaveLength(2)
    expect(rootWorkspace).toMatchObject({
      branchName: 'main',
      name: 'main',
      projectId: project.id,
      worktreePath: repoRoot,
    })

    database.close()
  })

  it('labels detached HEAD imports with a detached branch marker', async () => {
    const repoRoot = createGitRepository({ detachedHead: true })
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)

    const result = await service.importProject(repoRoot)

    expect(result.snapshot.workspaces[0]?.branchName).toMatch(
      /^detached-[0-9a-f]+$/,
    )
    expect(result.snapshot.workspaces[0]?.name).toMatch(/^detached-[0-9a-f]+$/)

    database.close()
  })

  it('lists local and remote refs for workspace creation', async () => {
    const repoRoot = createGitRepository()
    runGit(repoRoot, ['branch', 'feature/review'])
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)

    const refs = await service.listProjectRefs(imported.projectId)

    expect(refs).toEqual(
      expect.arrayContaining([
        {
          displayName: 'feature/review',
          name: 'feature/review',
          source: 'local',
        },
        { displayName: 'main', name: 'main', source: 'local' },
        { displayName: 'origin/main', name: 'origin/main', source: 'remote' },
      ]),
    )

    database.close()
  })

  it('creates a workspace by checking out an existing local branch into a worktree', async () => {
    const repoRoot = createGitRepository()
    runGit(repoRoot, ['branch', 'feature/existing'])
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)
    const worktreePath = path.join(repoRoot, '.worktrees', 'feature-existing')

    const result = await service.createWorkspaceWithResult({
      baseBranch: 'main',
      branchName: 'feature/existing',
      name: 'feature/existing',
      projectId: imported.projectId,
      windowId: null,
      worktreePath,
    })

    expect(result.workspaceId).toBe(
      result.snapshot.workspaces.find(
        (workspace) => workspace.worktreePath === worktreePath,
      )?.id,
    )
    expect(
      result.snapshot.workspaces.find(
        (workspace) => workspace.worktreePath === worktreePath,
      ),
    ).toMatchObject({
      branchName: 'feature/existing',
      name: 'feature/existing',
      projectId: imported.projectId,
      worktreePath,
    })
    expect(runGit(worktreePath, ['symbolic-ref', '--short', 'HEAD'])).toBe(
      'feature/existing',
    )

    database.close()
  })

  it('creates a new branch worktree from the selected base branch', async () => {
    const repoRoot = createGitRepository()
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)
    const worktreePath = path.join(repoRoot, '.worktrees', 'feature-new')

    await service.createWorkspace({
      baseBranch: 'main',
      branchName: 'feature/new',
      name: 'feature/new',
      projectId: imported.projectId,
      windowId: null,
      worktreePath,
    })

    expect(runGit(worktreePath, ['symbolic-ref', '--short', 'HEAD'])).toBe(
      'feature/new',
    )

    database.close()
  })

  it('deletes a workspace and removes its clean worktree but keeps the branch', async () => {
    const repoRoot = createGitRepository()
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)
    const worktreePath = path.join(repoRoot, '.worktrees', 'to-delete')
    const created = await service.createWorkspaceWithResult({
      baseBranch: 'main',
      branchName: 'feature/to-delete',
      name: 'to-delete',
      projectId: imported.projectId,
      windowId: null,
      worktreePath,
    })

    const snapshot = await service.deleteWorkspace(created.workspaceId, true)

    expect(snapshot.workspaces.map((ws) => ws.id)).not.toContain(
      created.workspaceId,
    )
    expect(existsSync(worktreePath)).toBe(false)
    expect(
      runGit(repoRoot, ['branch', '--list', 'feature/to-delete']),
    ).toContain('feature/to-delete')

    database.close()
  })

  it('refuses to remove a worktree with uncommitted files and keeps the record', async () => {
    const repoRoot = createGitRepository()
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)
    const worktreePath = path.join(repoRoot, '.worktrees', 'dirty')
    const created = await service.createWorkspaceWithResult({
      baseBranch: 'main',
      branchName: 'feature/dirty',
      name: 'dirty',
      projectId: imported.projectId,
      windowId: null,
      worktreePath,
    })
    writeFileSync(path.join(worktreePath, 'scratch.txt'), 'unsaved')

    await expect(
      service.deleteWorkspace(created.workspaceId, true),
    ).rejects.toThrow()
    expect(existsSync(path.join(worktreePath, 'scratch.txt'))).toBe(true)
    expect(database.getWorkspace(created.workspaceId)).not.toBeNull()

    database.close()
  })

  it('never removes the project checkout, only its record', async () => {
    const repoRoot = createGitRepository()
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)

    await expect(
      service.deleteWorkspace(imported.workspaceId, true),
    ).rejects.toThrow('This workspace is not a separate Git worktree.')

    await service.deleteWorkspace(imported.workspaceId, false)
    expect(database.getWorkspace(imported.workspaceId)).toBeNull()
    expect(existsSync(repoRoot)).toBe(true)

    database.close()
  })

  it('fails before running git when the target worktree path already exists', async () => {
    const repoRoot = createGitRepository()
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)
    const worktreePath = path.join(repoRoot, '.worktrees', 'occupied')
    mkdirSync(worktreePath, { recursive: true })

    await expect(
      service.createWorkspace({
        baseBranch: 'main',
        branchName: 'feature/collision',
        name: 'feature/collision',
        projectId: imported.projectId,
        windowId: null,
        worktreePath,
      }),
    ).rejects.toThrow(`Worktree path "${worktreePath}" already exists.`)

    expect(database.getSnapshot().workspaces).toHaveLength(1)

    database.close()
  })

  it('rolls back a created worktree when persistence fails', async () => {
    const repoRoot = createGitRepository()
    const database = createAideDatabase(':memory:')
    const imported = database.createProject({
      defaultBranch: 'main',
      name: path.basename(repoRoot),
      remoteUrl: null,
      repoRoot,
    })
    database.createWorkspace({
      branchName: 'main',
      name: 'main',
      projectId: imported.id,
      windowId: null,
      worktreePath: repoRoot,
    })
    const worktreePath = path.join(repoRoot, '.worktrees', 'rollback')
    const failingStore: GitWorkspaceStore = {
      createProject: database.createProject.bind(database),
      createWorkspace(input: CreateWorkspaceInput) {
        if (input.worktreePath === worktreePath) {
          throw new Error('Simulated persistence failure.')
        }

        return database.createWorkspace(input)
      },
      deleteProject: database.deleteProject.bind(database),
      deleteWorkspace: database.deleteWorkspace.bind(database),
      findProjectByRepoRoot: database.findProjectByRepoRoot.bind(database),
      findWorkspaceByWorktreePath:
        database.findWorkspaceByWorktreePath.bind(database),
      getProject: database.getProject.bind(database),
      getWorkspace: database.getWorkspace.bind(database),
      getSnapshot: database.getSnapshot.bind(database),
      updateProject: database.updateProject.bind(database),
      updateWorkspace: database.updateWorkspace.bind(database),
    }
    const service = new GitWorkspaceService(failingStore)

    await expect(
      service.createWorkspace({
        baseBranch: 'main',
        branchName: 'feature/rollback',
        name: 'feature/rollback',
        projectId: imported.id,
        windowId: null,
        worktreePath,
      }),
    ).rejects.toThrow('Simulated persistence failure.')

    expect(database.getSnapshot().workspaces).toHaveLength(1)
    expect(() =>
      runGit(worktreePath, ['rev-parse', '--show-toplevel']),
    ).toThrow()

    database.close()
  })

  it('imports a folder project without creating a Git repository', async () => {
    const folderRoot = createTempDirectory('aide-non-git-')
    writeFileSync(path.join(folderRoot, 'notes.txt'), 'plain folder\n')
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)

    const result = await service.importProject(folderRoot)

    expect(result.snapshot.projects).toHaveLength(1)
    expect(result.snapshot.projects[0]).toMatchObject({
      defaultBranch: '',
      kind: 'folder',
      name: path.basename(folderRoot),
      remoteUrl: null,
      repoRoot: folderRoot,
    })
    expect(result.snapshot.workspaces).toHaveLength(1)
    expect(result.snapshot.workspaces[0]).toMatchObject({
      branchName: '',
      name: path.basename(folderRoot),
      projectId: result.projectId,
      worktreePath: folderRoot,
    })
    expect(existsSync(path.join(folderRoot, '.git'))).toBe(false)

    await expect(service.listProjectRefs(result.projectId)).rejects.toThrow(
      'Git workspaces are unavailable for folder projects.',
    )
    await expect(
      service.createWorkspace({
        baseBranch: 'main',
        branchName: 'feature/plain-folder',
        name: 'feature/plain-folder',
        projectId: result.projectId,
        windowId: null,
        worktreePath: path.join(folderRoot, '.worktrees', 'feature'),
      }),
    ).rejects.toThrow('Git workspaces are unavailable for folder projects.')
    expect(await service.getWorkspaceStatus(result.workspaceId)).toEqual({
      code: 'not-a-git-worktree',
      error: 'Git actions are unavailable for folder projects.',
      ok: false,
    })

    database.close()
  })

  it('opens a folder containing leftover Git metadata without changing it', async () => {
    const folderRoot = createTempDirectory('aide-leftover-git-')
    mkdirSync(path.join(folderRoot, '.git', 'info'), { recursive: true })
    const markerPath = path.join(folderRoot, '.git', 'opencode')
    writeFileSync(markerPath, 'tool state\n')
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)

    try {
      const result = await service.importProject(folderRoot)
      expect(result.snapshot.projects[0]).toMatchObject({
        kind: 'folder',
        repoRoot: folderRoot,
      })
      expect(readFileSync(markerPath, 'utf8')).toBe('tool state\n')
      expect(existsSync(path.join(folderRoot, '.git', 'HEAD'))).toBe(false)
    } finally {
      database.close()
    }
  })

  it('opens an unrecognized repository as a folder without repairing its metadata', async () => {
    const repoRoot = createGitRepository()
    const headPath = path.join(repoRoot, '.git', 'HEAD')
    writeFileSync(headPath, 'broken-head\n')
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)

    try {
      const result = await service.importProject(repoRoot)
      expect(result.snapshot.projects[0]?.kind).toBe('folder')
      expect(readFileSync(headPath, 'utf8')).toBe('broken-head\n')
    } finally {
      database.close()
    }
  })

  it('returns workspace-scoped branch and file status data', async () => {
    const repoRoot = createGitRepository()
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)

    writeFileSync(path.join(repoRoot, 'README.md'), '# aide\nstaged\n')
    runGit(repoRoot, ['add', 'README.md'])
    writeFileSync(
      path.join(repoRoot, 'README.md'),
      '# aide\nstaged\nunstaged\n',
    )
    writeFileSync(path.join(repoRoot, 'notes.txt'), 'local notes\n')

    const result = await service.getWorkspaceStatus(imported.workspaceId)

    expect(result).toEqual({
      ok: true,
      status: {
        branchName: 'main',
        defaultBranch: 'main',
        files: [
          {
            isStaged: false,
            isUnstaged: true,
            originalPath: null,
            path: 'notes.txt',
            staged: 'unmodified',
            unstaged: 'untracked',
          },
          {
            isStaged: true,
            isUnstaged: true,
            originalPath: null,
            path: 'README.md',
            staged: 'modified',
            unstaged: 'modified',
          },
        ],
        hasStagedChanges: true,
        hasUnstagedChanges: true,
        workspaceId: imported.workspaceId,
        worktreePath: repoRoot,
      },
    })

    database.close()
  })

  it('returns staged, unstaged, and untracked diff sections for changed files', async () => {
    const repoRoot = createGitRepository()
    runGit(repoRoot, ['config', 'diff.mnemonicPrefix', 'true'])
    runGit(repoRoot, ['config', 'diff.noprefix', 'true'])
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)

    writeFileSync(path.join(repoRoot, 'README.md'), '# aide\nstaged\n')
    runGit(repoRoot, ['add', 'README.md'])
    writeFileSync(
      path.join(repoRoot, 'README.md'),
      '# aide\nstaged\nunstaged\n',
    )
    writeFileSync(path.join(repoRoot, 'notes.txt'), 'local notes\n')

    await expect(
      service.getWorkspaceFileDiff(imported.workspaceId, 'README.md'),
    ).resolves.toEqual({
      diff: expect.objectContaining({
        branchName: 'main',
        path: 'README.md',
        sections: [
          expect.objectContaining({
            isTruncated: false,
            kind: 'staged',
            patch: expect.stringContaining('+++ b/README.md'),
            title: 'Staged diff',
          }),
          expect.objectContaining({
            isTruncated: false,
            kind: 'unstaged',
            patch: expect.stringContaining('+++ b/README.md'),
            title: 'Working tree diff',
          }),
        ],
        workspaceId: imported.workspaceId,
        worktreePath: repoRoot,
      }),
      ok: true,
    })

    await expect(
      service.getWorkspaceFileDiff(imported.workspaceId, 'notes.txt'),
    ).resolves.toEqual({
      diff: expect.objectContaining({
        path: 'notes.txt',
        sections: [
          expect.objectContaining({
            isTruncated: false,
            kind: 'untracked',
            patch: expect.stringContaining('+++ b/notes.txt'),
            title: 'Untracked file',
          }),
        ],
      }),
      ok: true,
    })

    database.close()
  })

  it('renders an untracked symlink without reading its target', async () => {
    const repoRoot = createGitRepository()
    const hostRoot = createTempDirectory('aide-git-host-')
    const secretPath = path.join(hostRoot, 'host-secret.txt')
    writeFileSync(secretPath, 'host sentinel')
    symlinkSync(secretPath, path.join(repoRoot, 'secret-link'))
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)

    const result = await service.getWorkspaceFileDiff(
      imported.workspaceId,
      'secret-link',
    )
    expect(result).toEqual({
      diff: expect.objectContaining({
        path: 'secret-link',
        sections: [
          expect.objectContaining({
            isTruncated: false,
            kind: 'untracked',
            patch: expect.stringContaining('+[symbolic link]'),
            title: 'Untracked file',
          }),
        ],
      }),
      ok: true,
    })
    expect(result.ok && result.diff.sections[0]?.patch).not.toContain(
      'host sentinel',
    )

    database.close()
  })

  it('truncates large diffs so the review surface stays bounded', async () => {
    const repoRoot = createGitRepository()
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)

    writeFileSync(
      path.join(repoRoot, 'README.md'),
      `# aide\n${'large diff line\n'.repeat(4000)}`,
    )

    await expect(
      service.getWorkspaceFileDiff(imported.workspaceId, 'README.md'),
    ).resolves.toEqual({
      diff: expect.objectContaining({
        path: 'README.md',
        sections: [
          expect.objectContaining({
            isTruncated: true,
            kind: 'unstaged',
            patch: expect.stringContaining('...diff truncated...'),
          }),
        ],
      }),
      ok: true,
    })

    database.close()
  })

  it('returns a parseable error when the workspace is missing', async () => {
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)

    await expect(service.getWorkspaceStatus('missing')).resolves.toEqual({
      code: 'workspace-not-found',
      error: 'Workspace does not exist.',
      ok: false,
    })

    database.close()
  })

  it('returns a parseable error when the workspace path is not a git worktree', async () => {
    const repoRoot = createGitRepository()
    const invalidPath = createTempDirectory('aide-invalid-worktree-')
    const database = createAideDatabase(':memory:')
    const project = database.createProject({
      defaultBranch: 'main',
      name: path.basename(repoRoot),
      remoteUrl: null,
      repoRoot,
    })
    const workspace: WorkspaceRecord = database.createWorkspace({
      branchName: 'main',
      name: 'broken',
      projectId: project.id,
      windowId: null,
      worktreePath: invalidPath,
    })
    const service = new GitWorkspaceService(database)

    await expect(service.getWorkspaceStatus(workspace.id)).resolves.toEqual({
      code: 'not-a-git-worktree',
      error: 'Workspace worktree is not a valid Git repository.',
      ok: false,
    })

    database.close()
  })

  it('returns a parseable error when the requested changed file does not exist', async () => {
    const repoRoot = createGitRepository()
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)

    await expect(
      service.getWorkspaceFileDiff(imported.workspaceId, 'missing.txt'),
    ).resolves.toEqual({
      code: 'file-not-found',
      error: 'Changed file does not exist in workspace Git status.',
      ok: false,
    })

    database.close()
  })

  it('excludes overlapping workspace mutations and releases after failure', async () => {
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    let releaseFirstMutation: (() => void) | undefined
    const firstMutation = service.runWorkspaceMutation(
      'workspace-one',
      async () => {
        await new Promise<void>((resolve) => {
          releaseFirstMutation = resolve
        })
        throw new Error('Workspace mutation failed.')
      },
    )

    await expect(
      service.runWorkspaceMutation('workspace-one', async () => 'overlap'),
    ).rejects.toThrow(
      'A workspace change is already running. Wait for it to finish before trying again.',
    )

    await expect(
      service.runWorkspaceMutation('workspace-two', async () => 'parallel'),
    ).resolves.toBe('parallel')

    if (!releaseFirstMutation) throw new Error('First mutation did not start.')
    releaseFirstMutation()
    await expect(firstMutation).rejects.toThrow('Workspace mutation failed.')

    await expect(
      service.runWorkspaceMutation('workspace-one', async () => 'released'),
    ).resolves.toBe('released')

    database.close()
  })

  it('stages, unstages, commits, and reverts a changed file in its workspace', async () => {
    const repoRoot = createGitRepository()
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)

    writeFileSync(path.join(repoRoot, 'README.md'), '# aide\nchanged\n')
    await expect(
      service.stageWorkspaceFile({
        filePath: 'README.md',
        workspaceId: imported.workspaceId,
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: { hasStagedChanges: true },
    })

    await expect(
      service.unstageWorkspaceFile({
        filePath: 'README.md',
        workspaceId: imported.workspaceId,
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: { hasUnstagedChanges: true },
    })

    await service.stageWorkspaceFile({
      filePath: 'README.md',
      workspaceId: imported.workspaceId,
    })
    await expect(
      service.commitWorkspaceIndex({
        message: 'Update readme',
        workspaceId: imported.workspaceId,
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: { hasStagedChanges: false },
    })
    expect(runGit(repoRoot, ['log', '-1', '--format=%s'])).toBe('Update readme')

    writeFileSync(path.join(repoRoot, 'README.md'), '# aide\nchanged again\n')
    const diff = await service.getWorkspaceFileDiff(
      imported.workspaceId,
      'README.md',
    )
    if (!diff.ok) throw new Error(diff.error)

    await expect(
      service.revertWorkspaceFile({
        filePath: 'README.md',
        fingerprint: diff.diff.fingerprint,
        workspaceId: imported.workspaceId,
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: { hasUnstagedChanges: false },
    })
    expect(runGit(repoRoot, ['show', 'HEAD:README.md'])).toBe('# aide\nchanged')

    database.close()
  })

  it('rejects a stale revert preview before changing the file', async () => {
    const repoRoot = createGitRepository()
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)

    writeFileSync(path.join(repoRoot, 'README.md'), '# aide\nfirst change\n')
    const preview = await service.getWorkspaceFileDiff(
      imported.workspaceId,
      'README.md',
    )
    if (!preview.ok) throw new Error(preview.error)
    writeFileSync(path.join(repoRoot, 'README.md'), '# aide\nsecond change\n')

    await expect(
      service.revertWorkspaceFile({
        filePath: 'README.md',
        fingerprint: preview.diff.fingerprint,
        workspaceId: imported.workspaceId,
      }),
    ).resolves.toEqual({
      code: 'stale-diff',
      error:
        'The file changed after this revert preview. Refresh the file diff.',
      ok: false,
    })
    expect(runGit(repoRoot, ['diff', '--', 'README.md'])).toContain(
      'second change',
    )

    database.close()
  })

  it('rejects a stale revert preview after a binary file changes', async () => {
    const repoRoot = createGitRepository()
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)
    const binaryPath = path.join(repoRoot, 'image.bin')

    writeFileSync(binaryPath, Buffer.from([0, 1, 2, 3]))
    runGit(repoRoot, ['add', 'image.bin'])
    runGit(repoRoot, ['commit', '-m', 'Add binary fixture'])
    writeFileSync(binaryPath, Buffer.from([0, 1, 2, 4]))
    const preview = await service.getWorkspaceFileDiff(
      imported.workspaceId,
      'image.bin',
    )
    if (!preview.ok) throw new Error(preview.error)
    writeFileSync(binaryPath, Buffer.from([0, 1, 2, 5]))

    await expect(
      service.revertWorkspaceFile({
        filePath: 'image.bin',
        fingerprint: preview.diff.fingerprint,
        workspaceId: imported.workspaceId,
      }),
    ).resolves.toMatchObject({ code: 'stale-diff', ok: false })
    expect(readFileSync(binaryPath)).toEqual(Buffer.from([0, 1, 2, 5]))

    database.close()
  })

  it('reverts staged new files and staged renames from both index paths', async () => {
    const repoRoot = createGitRepository()
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)

    writeFileSync(path.join(repoRoot, 'new-file.txt'), 'new file\n')
    runGit(repoRoot, ['add', 'new-file.txt'])
    const stagedNew = await service.getWorkspaceFileDiff(
      imported.workspaceId,
      'new-file.txt',
    )
    if (!stagedNew.ok) throw new Error(stagedNew.error)

    await expect(
      service.revertWorkspaceFile({
        filePath: 'new-file.txt',
        fingerprint: stagedNew.diff.fingerprint,
        workspaceId: imported.workspaceId,
      }),
    ).resolves.toMatchObject({ ok: true })
    expect(existsSync(path.join(repoRoot, 'new-file.txt'))).toBe(false)

    runGit(repoRoot, ['mv', 'README.md', 'RENAMED.md'])
    const renamed = await service.getWorkspaceStatus(imported.workspaceId)
    if (!renamed.ok) throw new Error(renamed.error)
    const renamedFile = renamed.status.files.find(
      (file) => file.path === 'RENAMED.md',
    )
    expect(renamedFile?.originalPath).toBe('README.md')
    const renameDiff = await service.getWorkspaceFileDiff(
      imported.workspaceId,
      'RENAMED.md',
    )
    if (!renameDiff.ok) throw new Error(renameDiff.error)

    await expect(
      service.revertWorkspaceFile({
        filePath: 'RENAMED.md',
        fingerprint: renameDiff.diff.fingerprint,
        workspaceId: imported.workspaceId,
      }),
    ).resolves.toMatchObject({ ok: true })
    expect(existsSync(path.join(repoRoot, 'README.md'))).toBe(true)
    expect(existsSync(path.join(repoRoot, 'RENAMED.md'))).toBe(false)

    database.close()
  })

  it('rejects file paths outside the workspace before running a Git mutation', async () => {
    const repoRoot = createGitRepository()
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)

    await expect(
      service.stageWorkspaceFile({
        filePath: '../outside.txt',
        workspaceId: imported.workspaceId,
      }),
    ).resolves.toEqual({
      code: 'invalid-input',
      error: 'File path must name a changed file inside the workspace.',
      ok: false,
    })

    database.close()
  })

  it('pulls a fast-forward commit from the tracked upstream', async () => {
    const { remotePath, repoRoot } = createRepositoryWithRemote()
    pushRemoteCommit(remotePath, 'remote.txt', 'remote work\n', 'Remote commit')
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)

    const result = await service.pullWorkspaceBranch(imported.workspaceId)

    expect(result).toMatchObject({
      ok: true,
      pull: { aheadCount: 0, behindCount: 0, pulledCount: 1 },
    })
    expect(readFileSync(path.join(repoRoot, 'remote.txt'), 'utf8')).toBe(
      'remote work\n',
    )

    database.close()
  })

  it('rebases a local commit on top of the pulled commits', async () => {
    const { remotePath, repoRoot } = createRepositoryWithRemote()
    pushRemoteCommit(remotePath, 'remote.txt', 'remote work\n', 'Remote commit')
    writeFileSync(path.join(repoRoot, 'local.txt'), 'local work\n')
    runGit(repoRoot, ['add', 'local.txt'])
    runGit(repoRoot, ['commit', '-m', 'Local commit'])
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)

    const result = await service.pullWorkspaceBranch(imported.workspaceId)

    expect(result).toMatchObject({
      ok: true,
      pull: { aheadCount: 1, behindCount: 0, pulledCount: 1 },
    })
    expect(runGit(repoRoot, ['log', '-3', '--format=%s'])).toBe(
      'Local commit\nRemote commit\nInitial commit',
    )

    database.close()
  })

  it('reports conflicted paths and restores the pre-pull state when the pull is aborted', async () => {
    const { remotePath, repoRoot } = createRepositoryWithRemote()
    pushRemoteCommit(remotePath, 'README.md', '# remote\n', 'Remote readme')
    writeFileSync(path.join(repoRoot, 'README.md'), '# local\n')
    runGit(repoRoot, ['add', 'README.md'])
    runGit(repoRoot, ['commit', '-m', 'Local readme'])
    const headBeforePull = runGit(repoRoot, ['rev-parse', 'HEAD'])
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)

    const pulled = await service.pullWorkspaceBranch(imported.workspaceId)

    expect(pulled).toEqual({
      code: 'pull-conflict',
      error: 'Pull stopped with conflicts in README.md.',
      ok: false,
    })

    const conflicted = await service.getWorkspaceStatus(imported.workspaceId)
    if (!conflicted.ok) throw new Error(conflicted.error)
    expect(conflicted.status.files).toContainEqual(
      expect.objectContaining({ path: 'README.md', staged: 'unmerged' }),
    )

    await expect(
      service.commitAllAndPushWorkspace({
        message: 'Commit through a conflict',
        workspaceId: imported.workspaceId,
      }),
    ).resolves.toEqual({
      code: 'pull-conflict',
      error: 'Resolve the conflicts or abort the pull before committing.',
      ok: false,
    })

    await expect(
      service.abortWorkspacePull(imported.workspaceId),
    ).resolves.toMatchObject({ ok: true })
    expect(runGit(repoRoot, ['rev-parse', 'HEAD'])).toBe(headBeforePull)
    expect(readFileSync(path.join(repoRoot, 'README.md'), 'utf8')).toBe(
      '# local\n',
    )

    database.close()
  })

  it('commits every tracked and untracked change and pushes it', async () => {
    const { remotePath, repoRoot } = createRepositoryWithRemote()
    writeFileSync(path.join(repoRoot, 'notes.txt'), 'notes\n')
    runGit(repoRoot, ['add', 'notes.txt'])
    runGit(repoRoot, ['commit', '-m', 'Add notes'])
    runGit(repoRoot, ['push', 'origin', 'main'])
    writeFileSync(path.join(repoRoot, 'README.md'), '# aide\nchanged\n')
    writeFileSync(path.join(repoRoot, 'notes.txt'), 'notes\nchanged\n')
    writeFileSync(path.join(repoRoot, 'fresh.txt'), 'fresh\n')
    writeFileSync(path.join(repoRoot, '.gitignore'), 'ignored.txt\n')
    runGit(repoRoot, ['add', '.gitignore'])
    runGit(repoRoot, ['commit', '-m', 'Ignore build output'])
    writeFileSync(path.join(repoRoot, 'ignored.txt'), 'ignored\n')
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)

    await expect(
      service.commitAllAndPushWorkspace({
        message: 'Commit everything',
        workspaceId: imported.workspaceId,
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: { files: [], hasStagedChanges: false },
    })

    expect(
      runGit(repoRoot, ['show', '--name-only', '--format=%s', 'HEAD']).split(
        '\n',
      ),
    ).toEqual(['Commit everything', '', 'README.md', 'fresh.txt', 'notes.txt'])
    expect(runGit(repoRoot, ['rev-parse', 'HEAD'])).toBe(
      runGit(remotePath, ['rev-parse', 'refs/heads/main']),
    )

    database.close()
  })

  it('classifies a rejected push and recovers by pulling before pushing again', async () => {
    const { remotePath, repoRoot } = createRepositoryWithRemote()
    pushRemoteCommit(remotePath, 'remote.txt', 'remote work\n', 'Remote commit')
    writeFileSync(path.join(repoRoot, 'local.txt'), 'local work\n')
    runGit(repoRoot, ['add', 'local.txt'])
    runGit(repoRoot, ['commit', '-m', 'Local commit'])
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)

    await expect(
      service.pushWorkspaceBranch(imported.workspaceId),
    ).resolves.toEqual({
      code: 'push-rejected',
      error: 'Remote has new commits.',
      ok: false,
    })

    writeFileSync(path.join(repoRoot, 'later.txt'), 'later work\n')

    await expect(
      service.commitAllAndPushWorkspace({
        message: 'Commit after rejection',
        workspaceId: imported.workspaceId,
      }),
    ).resolves.toMatchObject({ ok: true })

    expect(runGit(repoRoot, ['rev-parse', 'HEAD'])).toBe(
      runGit(remotePath, ['rev-parse', 'refs/heads/main']),
    )
    expect(runGit(repoRoot, ['log', '-4', '--format=%s'])).toBe(
      'Commit after rejection\nLocal commit\nRemote commit\nInitial commit',
    )

    database.close()
  })

  it('starts a feature branch named from the commit message and carries the working tree', async () => {
    const { repoRoot } = createRepositoryWithRemote()
    writeFileSync(path.join(repoRoot, 'README.md'), '# aide\ndrafted\n')
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)

    await expect(
      service.startWorkspaceFeatureBranch({
        message: 'Add the Git sync pane!',
        workspaceId: imported.workspaceId,
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: { branchName: 'add-the-git-sync-pane' },
    })
    expect(readFileSync(path.join(repoRoot, 'README.md'), 'utf8')).toBe(
      '# aide\ndrafted\n',
    )

    runGit(repoRoot, ['checkout', 'main'])

    await expect(
      service.startWorkspaceFeatureBranch({
        message: '   ',
        workspaceId: imported.workspaceId,
      }),
    ).resolves.toMatchObject({
      ok: true,
      status: { branchName: expect.stringMatching(/^work\/\d{8}-\d{4}$/) },
    })

    database.close()
  })

  it('names the changed files when no Codex generator is wired', async () => {
    const { repoRoot } = createRepositoryWithRemote()
    writeFileSync(path.join(repoRoot, 'README.md'), '# aide\nchanged\n')
    writeFileSync(path.join(repoRoot, 'notes.txt'), 'notes\n')
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)

    await expect(
      service.generateWorkspaceGitMessage({
        kind: 'commit',
        workspaceId: imported.workspaceId,
      }),
    ).resolves.toEqual({
      message: 'Update notes.txt and README.md',
      ok: true,
    })
    await expect(
      service.generateWorkspaceGitMessage({
        kind: 'pull-request-body',
        workspaceId: imported.workspaceId,
      }),
    ).resolves.toEqual({
      message: 'Updates notes.txt and README.md.',
      ok: true,
    })

    database.close()
  })

  it('asks the Codex generator for a message and falls back when it fails', async () => {
    const { repoRoot } = createRepositoryWithRemote()
    writeFileSync(path.join(repoRoot, 'README.md'), '# aide\nchanged\n')
    const database = createAideDatabase(':memory:')
    const prompts: string[] = []
    let failNext = false
    const service = new GitWorkspaceService(
      database,
      undefined,
      async (input) => {
        prompts.push(input.prompt)
        if (failNext) throw new Error('Codex is unavailable.')
        return '"Describe the readme change"\n'
      },
    )
    const imported = await service.importProject(repoRoot)

    await expect(
      service.generateWorkspaceGitMessage({
        kind: 'commit',
        workspaceId: imported.workspaceId,
      }),
    ).resolves.toEqual({ message: 'Describe the readme change', ok: true })
    expect(prompts[0]).toContain('README.md')
    expect(prompts[0]).toContain('+changed')

    failNext = true
    await expect(
      service.generateWorkspaceGitMessage({
        kind: 'commit',
        workspaceId: imported.workspaceId,
      }),
    ).resolves.toEqual({ message: 'Update README.md', ok: true })

    database.close()
  })

  it('refuses to describe a workspace with no changes', async () => {
    const { repoRoot } = createRepositoryWithRemote()
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)

    await expect(
      service.generateWorkspaceGitMessage({
        kind: 'commit',
        workspaceId: imported.workspaceId,
      }),
    ).resolves.toEqual({
      code: 'invalid-input',
      error: 'There are no changes to describe.',
      ok: false,
    })

    database.close()
  })

  it('uses argument arrays for GitHub authentication, pull request creation, and checks', async () => {
    const repoRoot = createGitRepository()
    const database = createAideDatabase(':memory:')
    const commands: string[][] = []
    const service = new GitWorkspaceService(database, async (args) => {
      commands.push([...args])
      if (args[0] === 'auth') return ''
      if (args[1] === 'create') return 'https://github.com/example/aide/pull/7'
      return JSON.stringify({
        baseRefName: 'main',
        headRefName: 'feature/review',
        isDraft: false,
        number: 7,
        state: 'OPEN',
        statusCheckRollup: [
          {
            conclusion: null,
            detailsUrl: 'https://github.com/example/aide/actions/runs/1',
            name: 'test',
            status: 'IN_PROGRESS',
          },
        ],
        title: 'Review flow',
        url: 'https://github.com/example/aide/pull/7',
      })
    })
    const imported = await service.importProject(repoRoot)
    runGit(repoRoot, ['checkout', '-b', 'feature/review'])

    await expect(
      service.createWorkspacePullRequest({
        body: 'Review the staged changes.',
        title: 'Review flow',
        workspaceId: imported.workspaceId,
      }),
    ).resolves.toMatchObject({
      ok: true,
      pullRequest: { number: 7, title: 'Review flow' },
    })
    expect(commands).toEqual([
      ['auth', 'status'],
      [
        'pr',
        'create',
        '--base',
        'main',
        '--head',
        'feature/review',
        '--title',
        'Review flow',
        '--body',
        'Review the staged changes.',
      ],
      ['auth', 'status'],
      [
        'pr',
        'view',
        '--json',
        'number,title,url,state,isDraft,headRefName,baseRefName,statusCheckRollup',
      ],
    ])

    database.close()
  })
})

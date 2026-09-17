import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
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

function createGitRepository(options?: { detachedHead?: boolean }): string {
  const repoRoot = createTempDirectory('aide-git-service-')

  runGit(repoRoot, ['init', '-b', 'main'])
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
    const secondImport = await service.importProject(repoRoot)

    expect(secondImport.projectId).toBe(firstImport.projectId)
    expect(secondImport.workspaceId).toBe(firstImport.workspaceId)
    expect(secondImport.snapshot.projects).toHaveLength(1)
    expect(secondImport.snapshot.workspaces).toHaveLength(1)

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

  it('rejects non-git folders during import', async () => {
    const repoRoot = createTempDirectory('aide-non-git-')
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)

    await expect(service.importProject(repoRoot)).rejects.toThrow(
      'Selected folder is not inside a Git repository.',
    )

    expect(database.getSnapshot().projects).toEqual([])
    expect(database.getSnapshot().workspaces).toEqual([])

    database.close()
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
})

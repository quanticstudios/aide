import { execFileSync } from 'node:child_process'
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
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
import {
  GitWorkspaceService,
  type GitWorkspaceStore,
  MAX_MANAGED_TURN_PATCH_BYTES,
  normalizeManagedTurnPatchPaths,
} from './git-service'

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
  it('normalizes only Git metadata paths for snapshots with spaces and Windows separators', () => {
    const beforeDirectory = 'C:\\Temp\\aide managed before'
    const afterDirectory = 'C:\\Temp\\aide managed after'
    const patch = [
      'diff --git "a/C:/Temp/aide managed before/old name.txt" "b/C:/Temp/aide managed after/new name.txt"',
      'similarity index 100%',
      'rename from "C:/Temp/aide managed before/old name.txt"',
      'rename to "C:/Temp/aide managed after/new name.txt"',
      'diff --git a/C:/Temp/aide managed after/copied.txt b/C:/Temp/aide managed after/copied.txt',
      'copy from C:/Temp/aide managed before/copied.txt',
      'copy to C:/Temp/aide managed after/copied.txt',
      '--- /dev/null',
      '+++ "b/C:/Temp/aide managed after/added name.txt"',
      'Binary files "a/C:/Temp/aide managed before/image.bin" and "b/C:/Temp/aide managed after/image.bin" differ',
      'diff --git "a/C:\\\\Temp\\\\aide managed before\\\\escaped old.txt" "b/C:\\\\Temp\\\\aide managed after\\\\escaped new.txt"',
      'rename from "C:\\\\Temp\\\\aide managed before\\\\escaped old.txt"',
      'rename to "C:\\\\Temp\\\\aide managed after\\\\escaped new.txt"',
      'Binary files "a/C:\\\\Temp\\\\aide managed before\\\\escaped.bin" and "b/C:\\\\Temp\\\\aide managed after\\\\escaped.bin" differ',
      '@@ -0,0 +1 @@',
      '+C:/Temp/aide managed after/must-stay-in-the-patch-body',
    ].join('\n')

    expect(
      normalizeManagedTurnPatchPaths(patch, beforeDirectory, afterDirectory),
    ).toBe(
      [
        'diff --git "a/old name.txt" "b/new name.txt"',
        'similarity index 100%',
        'rename from "old name.txt"',
        'rename to "new name.txt"',
        'diff --git a/copied.txt b/copied.txt',
        'copy from copied.txt',
        'copy to copied.txt',
        '--- /dev/null',
      '+++ "b/added name.txt"',
      'Binary files "a/image.bin" and "b/image.bin" differ',
      'diff --git "a/escaped old.txt" "b/escaped new.txt"',
      'rename from "escaped old.txt"',
      'rename to "escaped new.txt"',
      'Binary files "a/escaped.bin" and "b/escaped.bin" differ',
        '@@ -0,0 +1 @@',
        '+C:/Temp/aide managed after/must-stay-in-the-patch-body',
      ].join('\n'),
    )
  })

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

  it('captures a worktree-relative patch from a managed-turn baseline', async () => {
    const repoRoot = createGitRepository()
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)

    const config = {
      cwd: repoRoot,
      mode: 'claude' as const,
      paneId: 'agent-pane',
      sessionId: 'managed-session',
      workspaceId: imported.workspaceId,
    }
    const baseline = await service.captureBaseline(config)
    writeFileSync(path.join(repoRoot, 'README.md'), '# aide\nmanaged turn\n')
    writeFileSync(path.join(repoRoot, 'added.txt'), 'new file\n')

    const captured = await service.capturePatch(config, baseline)

    expect(captured).toMatchObject({
      binaryChanges: 'none',
      changedFileCount: 2,
      status: 'ready',
    })
    expect(captured.patch).toContain('diff --git a/README.md b/README.md')
    expect(captured.patch).toContain('diff --git a/added.txt b/added.txt')
    expect(captured.patch).not.toContain(repoRoot)
    expect(captured.patch).not.toContain('aide-managed-turn-')

    database.close()
  })

  it('rejects managed-turn capture requests that cross workspace boundaries', async () => {
    const firstRepo = createGitRepository()
    const secondRepo = createGitRepository()
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const first = await service.importProject(firstRepo)

    await expect(
      service.captureBaseline({
        cwd: secondRepo,
        mode: 'claude',
        paneId: 'agent-pane',
        sessionId: 'managed-session',
        workspaceId: first.workspaceId,
      }),
    ).rejects.toThrow('does not match its workspace worktree')

    database.close()
  })

  it('reports renames, deletions, and binary changes in a managed-turn patch', async () => {
    const repoRoot = createGitRepository()
    writeFileSync(path.join(repoRoot, 'obsolete.txt'), 'remove me\n')
    runGit(repoRoot, ['add', 'obsolete.txt'])
    runGit(repoRoot, ['commit', '-m', 'Add obsolete fixture'])
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)
    const config = {
      cwd: repoRoot,
      mode: 'claude' as const,
      paneId: 'agent-pane',
      sessionId: 'managed-session',
      workspaceId: imported.workspaceId,
    }
    const baseline = await service.captureBaseline(config)

    renameSync(
      path.join(repoRoot, 'README.md'),
      path.join(repoRoot, 'RENAMED.md'),
    )
    unlinkSync(path.join(repoRoot, 'obsolete.txt'))
    writeFileSync(path.join(repoRoot, 'binary.dat'), Buffer.from([0, 1, 2]))

    const captured = await service.capturePatch(config, baseline)

    expect(captured).toMatchObject({
      binaryChanges: 'present',
      changedFileCount: 3,
      status: 'ready',
    })
    expect(captured.patch).toContain('rename from README.md')
    expect(captured.patch).toContain('diff --git a/README.md b/RENAMED.md')
    expect(captured.patch).toContain('deleted file mode')
    expect(captured.patch).toContain('diff --git a/obsolete.txt b/obsolete.txt')
    expect(captured.patch).toContain('GIT binary patch')
    expect(captured.patch).not.toContain(repoRoot)
    expect(captured.patch).not.toContain('aide-managed-turn-')

    database.close()
  })

  it('preserves mode-only and leaf symlink changes in managed-turn patches', async () => {
    const repoRoot = createGitRepository()
    symlinkSync('README.md', path.join(repoRoot, 'README-link'))
    runGit(repoRoot, ['add', 'README-link'])
    runGit(repoRoot, ['commit', '-m', 'Add symlink fixture'])
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)
    const config = {
      cwd: repoRoot,
      mode: 'claude' as const,
      paneId: 'agent-pane',
      sessionId: 'managed-session',
      workspaceId: imported.workspaceId,
    }
    const baseline = await service.captureBaseline(config)

    chmodSync(path.join(repoRoot, 'README.md'), 0o755)
    unlinkSync(path.join(repoRoot, 'README-link'))
    symlinkSync('missing-target', path.join(repoRoot, 'README-link'))

    const captured = await service.capturePatch(config, baseline)

    expect(captured).toMatchObject({
      binaryChanges: 'none',
      changedFileCount: 2,
      status: 'ready',
    })
    expect(captured.patch).toContain('old mode 100644')
    expect(captured.patch).toContain('new mode 100755')
    expect(captured.patch).toContain('README-link')

    database.close()
  })

  it('rejects a Git-visible path after an intermediate directory becomes a symlink', async () => {
    const repoRoot = createGitRepository()
    const nestedDirectory = path.join(repoRoot, 'nested')
    const outsideDirectory = createTempDirectory('aide-git-outside-')
    mkdirSync(nestedDirectory)
    writeFileSync(path.join(nestedDirectory, 'tracked.txt'), 'inside\n')
    writeFileSync(path.join(outsideDirectory, 'tracked.txt'), 'outside\n')
    runGit(repoRoot, ['add', 'nested/tracked.txt'])
    runGit(repoRoot, ['commit', '-m', 'Add nested fixture'])
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)
    const config = {
      cwd: repoRoot,
      mode: 'claude' as const,
      paneId: 'agent-pane',
      sessionId: 'managed-session',
      workspaceId: imported.workspaceId,
    }
    const baseline = await service.captureBaseline(config)

    rmSync(nestedDirectory, { force: true, recursive: true })
    symlinkSync(outsideDirectory, nestedDirectory, 'dir')

    await expect(service.capturePatch(config, baseline)).rejects.toThrow(
      'intermediate symlink',
    )
    expect(
      readFileSync(path.join(outsideDirectory, 'tracked.txt'), 'utf8'),
    ).toBe('outside\n')

    database.close()
  })

  const linuxIt = process.platform === 'linux' ? it : it.skip

  linuxIt(
    'keeps capture inside an opened intermediate directory when its pathname is swapped during capture',
    async () => {
      const repoRoot = createGitRepository()
      const nestedDirectory = path.join(repoRoot, 'nested')
      const heldDirectory = path.join(repoRoot, 'nested-held')
      const outsideDirectory = createTempDirectory('aide-git-outside-')
      mkdirSync(nestedDirectory)
      writeFileSync(path.join(nestedDirectory, 'tracked.txt'), 'before\n')
      writeFileSync(path.join(outsideDirectory, 'tracked.txt'), 'outside\n')
      runGit(repoRoot, ['add', 'nested/tracked.txt'])
      runGit(repoRoot, ['commit', '-m', 'Add nested race fixture'])
      const database = createAideDatabase(':memory:')
      const baselineService = new GitWorkspaceService(database)
      const imported = await baselineService.importProject(repoRoot)
      const config = {
        cwd: repoRoot,
        mode: 'claude' as const,
        paneId: 'agent-pane',
        sessionId: 'managed-session',
        workspaceId: imported.workspaceId,
      }
      const baseline = await baselineService.captureBaseline(config)
      let swapped = false
      const service = new GitWorkspaceService(database, {
        beforeLeafOpen: async (filePath) => {
          if (filePath !== 'nested/tracked.txt' || swapped) {
            return
          }

          swapped = true
          renameSync(nestedDirectory, heldDirectory)
          writeFileSync(path.join(heldDirectory, 'tracked.txt'), 'inside after\n')
          symlinkSync(outsideDirectory, nestedDirectory, 'dir')
        },
      })

      const captured = await service.capturePatch(config, baseline)

      expect(swapped).toBe(true)
      expect(captured.patch).toContain('+inside after')
      expect(captured.patch).not.toContain('outside')
      expect(
        readFileSync(path.join(outsideDirectory, 'tracked.txt'), 'utf8'),
      ).toBe('outside\n')

      database.close()
    },
  )

  linuxIt(
    'keeps Git enumeration and copying inside a root descriptor when the worktree path is swapped',
    async () => {
      const repoRoot = createGitRepository()
      const heldRepoRoot = `${repoRoot}-held`
      const outsideDirectory = createTempDirectory('aide-git-outside-')
      writeFileSync(path.join(outsideDirectory, 'README.md'), 'outside\n')
      const database = createAideDatabase(':memory:')
      let swapDuringCapture = false
      let swapped = false
      const service = new GitWorkspaceService(database, {
        afterRootOpen: async () => {
          if (!swapDuringCapture || swapped) {
            return
          }

          swapped = true
          renameSync(repoRoot, heldRepoRoot)
          symlinkSync(outsideDirectory, repoRoot, 'dir')
        },
      })
      const imported = await service.importProject(repoRoot)
      const config = {
        cwd: repoRoot,
        mode: 'claude' as const,
        paneId: 'agent-pane',
        sessionId: 'managed-session',
        workspaceId: imported.workspaceId,
      }
      const baseline = await service.captureBaseline(config)
      writeFileSync(path.join(repoRoot, 'README.md'), '# inside after\n')
      swapDuringCapture = true

      const captured = await service.capturePatch(config, baseline)

      expect(swapped).toBe(true)
      expect(captured.patch).toContain('+# inside after')
      expect(captured.patch).not.toContain('outside')
      expect(readFileSync(path.join(outsideDirectory, 'README.md'), 'utf8')).toBe(
        'outside\n',
      )

      unlinkSync(repoRoot)
      renameSync(heldRepoRoot, repoRoot)
      database.close()
    },
  )

  it('canonicalizes symlinked configured worktrees before capture', async () => {
    const repoRoot = createGitRepository()
    const linkedWorktree = path.join(
      createTempDirectory('aide-git-worktree-link-'),
      'worktree',
    )
    symlinkSync(repoRoot, linkedWorktree, 'dir')
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)
    const config = {
      cwd: linkedWorktree,
      mode: 'claude' as const,
      paneId: 'agent-pane',
      sessionId: 'managed-session',
      workspaceId: imported.workspaceId,
    }

    const baseline = await service.captureBaseline(config)
    writeFileSync(path.join(repoRoot, 'added.txt'), 'added\n')
    const captured = await service.capturePatch(config, baseline)

    expect(captured).toMatchObject({ changedFileCount: 1, status: 'ready' })
    expect(captured.patch).toContain('diff --git a/added.txt b/added.txt')
    expect(captured.patch).not.toContain('aide-managed-turn-')

    database.close()
  })

  it('reports skipped gitlinks as an unknown turn summary', async () => {
    const repoRoot = createGitRepository()
    const gitlinkTarget = runGit(repoRoot, ['rev-parse', 'HEAD'])
    runGit(repoRoot, [
      'update-index',
      '--add',
      '--cacheinfo',
      `160000,${gitlinkTarget},nested-submodule`,
    ])
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)
    const config = {
      cwd: repoRoot,
      mode: 'claude' as const,
      paneId: 'agent-pane',
      sessionId: 'managed-session',
      workspaceId: imported.workspaceId,
    }
    const baseline = await service.captureBaseline(config)

    const captured = await service.capturePatch(config, baseline)

    expect(captured).toMatchObject({
      binaryChanges: 'unknown',
      changedFileCount: 0,
      patch: null,
      status: 'truncated',
    })
    expect(captured.message).toContain('Gitlink or submodule')

    database.close()
  })

  it('marks oversized managed-turn patches as truncated without retaining a body', async () => {
    const repoRoot = createGitRepository()
    const database = createAideDatabase(':memory:')
    const service = new GitWorkspaceService(database)
    const imported = await service.importProject(repoRoot)
    const config = {
      cwd: repoRoot,
      mode: 'claude' as const,
      paneId: 'agent-pane',
      sessionId: 'managed-session',
      workspaceId: imported.workspaceId,
    }
    const baseline = await service.captureBaseline(config)
    writeFileSync(
      path.join(repoRoot, 'large.txt'),
      `${'a'.repeat(MAX_MANAGED_TURN_PATCH_BYTES + 1)}\n`,
    )

    const captured = await service.capturePatch(config, baseline)

    expect(captured).toMatchObject({
      changedFileCount: 1,
      patch: null,
      status: 'truncated',
    })
    expect(captured.message).toContain('256 KiB')

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

    const snapshot = await service.createWorkspace({
      baseBranch: 'main',
      branchName: 'feature/existing',
      name: 'feature/existing',
      projectId: imported.projectId,
      windowId: null,
      worktreePath,
    })

    expect(
      snapshot.workspaces.find(
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

import { describe, expect, it } from 'vitest'

import { createAideDatabase } from './database'

describe('createAideDatabase', () => {
  it('creates the schema and exposes the migration strategy', () => {
    const database = createAideDatabase(':memory:')

    expect(database.getSnapshot()).toMatchObject({
      databasePath: ':memory:',
      migrationStrategy:
        'Ordered SQL migrations tracked with PRAGMA user_version.',
      projects: [],
      schemaVersion: 1,
      workspaces: [],
    })

    database.close()
  })

  it('stores and reloads projects plus workspaces', () => {
    const database = createAideDatabase(':memory:')

    const project = database.createProject({
      defaultBranch: 'main',
      name: 'aide',
      remoteUrl: 'https://github.com/example/aide',
      repoRoot: '/workspace/aide',
    })

    const workspace = database.createWorkspace({
      branchName: 'feature/navigation',
      name: 'Navigation shell',
      projectId: project.id,
      windowId: null,
      worktreePath: '/workspace/aide/.worktrees/navigation',
    })

    const snapshot = database.getSnapshot()

    expect(snapshot.projects).toEqual([project])
    expect(snapshot.workspaces).toEqual([workspace])

    database.close()
  })

  it('supports project CRUD operations', () => {
    const database = createAideDatabase(':memory:')

    const createdProject = database.createProject({
      defaultBranch: 'main',
      name: 'aide',
      remoteUrl: 'https://github.com/example/aide',
      repoRoot: '/workspace/aide',
    })

    expect(database.listProjects()).toEqual([createdProject])
    expect(database.getProject(createdProject.id)).toEqual(createdProject)

    const updatedProject = database.updateProject(createdProject.id, {
      defaultBranch: 'develop',
      name: 'aide-desktop',
      remoteUrl: null,
    })

    expect(updatedProject).toMatchObject({
      defaultBranch: 'develop',
      id: createdProject.id,
      name: 'aide-desktop',
      remoteUrl: null,
      repoRoot: '/workspace/aide',
    })
    expect(database.getSnapshot().projects).toEqual([updatedProject])

    expect(database.deleteProject(createdProject.id)).toBe(true)
    expect(database.getProject(createdProject.id)).toBeNull()
    expect(database.listProjects()).toEqual([])

    database.close()
  })

  it('returns null or false when project records are missing', () => {
    const database = createAideDatabase(':memory:')

    expect(database.getProject('missing')).toBeNull()
    expect(database.updateProject('missing', { name: 'ignored' })).toBeNull()
    expect(database.deleteProject('missing')).toBe(false)

    database.close()
  })

  it('supports workspace CRUD operations with project linkage', () => {
    const database = createAideDatabase(':memory:')
    const firstProject = database.createProject({
      defaultBranch: 'main',
      name: 'aide',
      remoteUrl: null,
      repoRoot: '/workspace/aide',
    })
    const secondProject = database.createProject({
      defaultBranch: 'main',
      name: 'aide-next',
      remoteUrl: null,
      repoRoot: '/workspace/aide-next',
    })

    const createdWorkspace = database.createWorkspace({
      branchName: 'feature/nav',
      name: 'Navigation shell',
      projectId: firstProject.id,
      windowId: null,
      worktreePath: '/workspace/aide/.worktrees/navigation',
    })

    expect(database.listWorkspaces()).toEqual([createdWorkspace])
    expect(database.getWorkspace(createdWorkspace.id)).toEqual(createdWorkspace)

    const updatedWorkspace = database.updateWorkspace(createdWorkspace.id, {
      branchName: 'feature/nav-2',
      name: 'Navigation shell v2',
      projectId: secondProject.id,
      windowId: 'window-1',
      worktreePath: '/workspace/aide-next/.worktrees/navigation-2',
    })

    expect(updatedWorkspace).toMatchObject({
      branchName: 'feature/nav-2',
      id: createdWorkspace.id,
      name: 'Navigation shell v2',
      projectId: secondProject.id,
      windowId: 'window-1',
      worktreePath: '/workspace/aide-next/.worktrees/navigation-2',
    })
    expect(database.getSnapshot().workspaces).toEqual([updatedWorkspace])

    expect(database.deleteWorkspace(createdWorkspace.id)).toBe(true)
    expect(database.getWorkspace(createdWorkspace.id)).toBeNull()
    expect(database.listWorkspaces()).toEqual([])

    database.close()
  })

  it('returns null or false when workspace records are missing', () => {
    const database = createAideDatabase(':memory:')

    expect(database.getWorkspace('missing')).toBeNull()
    expect(database.updateWorkspace('missing', { name: 'ignored' })).toBeNull()
    expect(database.deleteWorkspace('missing')).toBe(false)

    database.close()
  })
})

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
})

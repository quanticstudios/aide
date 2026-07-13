import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { createAideDatabase } from './database'

describe('createAideDatabase', () => {
  it('creates the schema and exposes the migration strategy', () => {
    const database = createAideDatabase(':memory:')

    expect(database.getSnapshot()).toMatchObject({
      databasePath: ':memory:',
      lastActivePaneIdsByWorkspace: {},
      lastActiveProjectId: null,
      lastActiveWorkspaceIdsByProject: {},
      lastActiveWorkspaceId: null,
      migrationStrategy:
        'Ordered SQL migrations tracked with PRAGMA user_version.',
      projects: [],
      schemaVersion: 6,
      workspaceLayouts: {},
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

  it('persists workspace activity visit watermarks', () => {
    const database = createAideDatabase(':memory:')
    const project = database.createProject({
      defaultBranch: 'main',
      name: 'aide',
      remoteUrl: null,
      repoRoot: '/workspace/aide',
    })
    const workspace = database.createWorkspace({
      branchName: 'main',
      name: 'Main',
      projectId: project.id,
      windowId: null,
      worktreePath: '/workspace/aide',
    })

    database.setWorkspaceActivityVisitWatermark(
      workspace.id,
      '2026-07-13T12:00:00.000Z',
    )

    expect(database.getWorkspaceActivityVisitWatermarks()).toEqual({
      [workspace.id]: '2026-07-13T12:00:00.000Z',
    })
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

  it('persists the last active project and workspace selection', () => {
    const database = createAideDatabase(':memory:')
    const project = database.createProject({
      defaultBranch: 'main',
      name: 'aide',
      remoteUrl: null,
      repoRoot: '/workspace/aide',
    })
    const workspace = database.createWorkspace({
      branchName: 'feature/nav',
      name: 'Navigation shell',
      projectId: project.id,
      windowId: null,
      worktreePath: '/workspace/aide/.worktrees/navigation',
    })

    database.setActiveSelection({
      paneIdsByWorkspace: { [workspace.id]: 'terminal' },
      projectId: project.id,
      workspaceIdsByProject: { [project.id]: workspace.id },
      workspaceId: workspace.id,
    })

    expect(database.getSnapshot()).toMatchObject({
      lastActivePaneIdsByWorkspace: { [workspace.id]: 'terminal' },
      lastActiveProjectId: project.id,
      lastActiveWorkspaceIdsByProject: { [project.id]: workspace.id },
      lastActiveWorkspaceId: workspace.id,
    })

    database.close()
  })

  it('persists workspace split layouts across relaunches', () => {
    const tempDirectory = mkdtempSync(path.join(tmpdir(), 'aide-layout-db-'))
    const databasePath = path.join(tempDirectory, 'aide.sqlite3')

    try {
      const database = createAideDatabase(databasePath)
      const project = database.createProject({
        defaultBranch: 'main',
        name: 'aide',
        remoteUrl: null,
        repoRoot: '/workspace/aide',
      })
      const workspace = database.createWorkspace({
        branchName: 'feature/layout-tree',
        name: 'Layout shell',
        projectId: project.id,
        windowId: null,
        worktreePath: '/workspace/aide/.worktrees/layout-tree',
      })

      database.saveWorkspaceLayout(workspace.id, {
        rootNodeId: 'root-horizontal',
        nodes: [
          {
            children: ['left-pane', 'nested-vertical'],
            id: 'root-horizontal',
            paneId: null,
            parentId: null,
            sizeWeights: [0.6, 0.4],
            type: 'split-horizontal',
            workspaceId: workspace.id,
          },
          {
            activeViewIndex: 0,
            children: [],
            id: 'left-pane',
            paneId: 'terminal',
            parentId: 'root-horizontal',
            sizeWeights: [],
            type: 'pane',
            viewIds: ['terminal'],
            workspaceId: workspace.id,
          },
          {
            children: ['top-pane', 'bottom-pane'],
            id: 'nested-vertical',
            paneId: null,
            parentId: 'root-horizontal',
            sizeWeights: [0.5, 0.5],
            type: 'split-vertical',
            workspaceId: workspace.id,
          },
          {
            activeViewIndex: 0,
            children: [],
            id: 'top-pane',
            paneId: 'git',
            parentId: 'nested-vertical',
            sizeWeights: [],
            type: 'pane',
            viewIds: ['git'],
            workspaceId: workspace.id,
          },
          {
            activeViewIndex: 0,
            children: [],
            id: 'bottom-pane',
            paneId: 'preview',
            parentId: 'nested-vertical',
            sizeWeights: [],
            type: 'pane',
            viewIds: ['preview'],
            workspaceId: workspace.id,
          },
        ],
      })
      database.close()

      const reopenedDatabase = createAideDatabase(databasePath)
      const snapshot = reopenedDatabase.getSnapshot()

      expect(snapshot.workspaceLayouts[workspace.id]).toEqual({
        nodes: [
          {
            children: ['left-pane', 'nested-vertical'],
            id: 'root-horizontal',
            paneId: null,
            parentId: null,
            sizeWeights: [0.6, 0.4],
            type: 'split-horizontal',
            workspaceId: workspace.id,
          },
          {
            activeViewIndex: 0,
            children: [],
            id: 'left-pane',
            paneId: 'terminal',
            parentId: 'root-horizontal',
            sizeWeights: [],
            type: 'pane',
            viewIds: ['terminal'],
            workspaceId: workspace.id,
          },
          {
            children: ['top-pane', 'bottom-pane'],
            id: 'nested-vertical',
            paneId: null,
            parentId: 'root-horizontal',
            sizeWeights: [0.5, 0.5],
            type: 'split-vertical',
            workspaceId: workspace.id,
          },
          {
            activeViewIndex: 0,
            children: [],
            id: 'top-pane',
            paneId: 'git',
            parentId: 'nested-vertical',
            sizeWeights: [],
            type: 'pane',
            viewIds: ['git'],
            workspaceId: workspace.id,
          },
          {
            activeViewIndex: 0,
            children: [],
            id: 'bottom-pane',
            paneId: 'preview',
            parentId: 'nested-vertical',
            sizeWeights: [],
            type: 'pane',
            viewIds: ['preview'],
            workspaceId: workspace.id,
          },
        ],
        rootNodeId: 'root-horizontal',
        workspaceId: workspace.id,
      })

      reopenedDatabase.close()
    } finally {
      rmSync(tempDirectory, { force: true, recursive: true })
    }
  })

  it('keeps an explicit empty workspace surface state across relaunches', () => {
    const tempDirectory = mkdtempSync(path.join(tmpdir(), 'aide-db-'))
    const databasePath = path.join(tempDirectory, 'aide.sqlite3')

    try {
      const database = createAideDatabase(databasePath)
      const project = database.createProject({
        defaultBranch: 'main',
        name: 'aide',
        remoteUrl: null,
        repoRoot: '/workspace/aide',
      })
      const workspace = database.createWorkspace({
        branchName: 'main',
        name: 'main',
        projectId: project.id,
        windowId: null,
        worktreePath: '/workspace/aide',
      })

      database.saveWorkspaceLayout(workspace.id, {
        nodes: [
          {
            activeViewIndex: 0,
            children: [],
            id: 'legacy-pane',
            paneId: 'terminal',
            parentId: null,
            sizeWeights: [],
            type: 'pane',
            viewIds: ['terminal'],
            workspaceId: workspace.id,
          },
        ],
        rootNodeId: 'legacy-pane',
      })
      database.saveWorkspaceSurfaceState(workspace.id, {
        layouts: {},
        surfaces: [],
      })
      database.close()

      const reopenedDatabase = createAideDatabase(databasePath)
      const snapshot = reopenedDatabase.getSnapshot()

      expect(snapshot.workspaceSurfaces?.[workspace.id]).toEqual([])
      expect(snapshot.surfaceLayouts).toEqual({})
      expect(snapshot.workspaceLayouts[workspace.id]).toEqual({
        nodes: [
          {
            activeViewIndex: 0,
            children: [],
            id: 'legacy-pane',
            paneId: 'terminal',
            parentId: null,
            sizeWeights: [],
            type: 'pane',
            viewIds: ['terminal'],
            workspaceId: workspace.id,
          },
        ],
        rootNodeId: 'legacy-pane',
        workspaceId: workspace.id,
      })

      reopenedDatabase.close()
    } finally {
      rmSync(tempDirectory, { force: true, recursive: true })
    }
  })

  it('persists initialized-empty preview state and cascades it with a workspace', () => {
    const database = createAideDatabase(':memory:')
    const project = database.createProject({
      defaultBranch: 'main',
      name: 'aide',
      remoteUrl: null,
      repoRoot: '/workspace/aide',
    })
    const workspace = database.createWorkspace({
      branchName: 'main',
      name: 'main',
      projectId: project.id,
      windowId: null,
      worktreePath: '/workspace/aide',
    })

    database.saveWorkspacePreviewState({
      activeTabId: null,
      initialized: true,
      revision: 4,
      tabs: [],
      workspaceId: workspace.id,
    })

    expect(database.getWorkspacePreviewState(workspace.id)).toEqual({
      activeTabId: null,
      initialized: true,
      revision: 4,
      tabs: [],
      workspaceId: workspace.id,
    })

    database.deleteWorkspace(workspace.id)
    expect(database.getWorkspacePreviewState(workspace.id)).toBeNull()
    database.close()
  })

  it('tracks catalog and per-workspace surface revisions', () => {
    const database = createAideDatabase(':memory:')
    const initialRevision = database.getSnapshot().catalogRevision
    const project = database.createProject({
      defaultBranch: 'main',
      name: 'aide',
      remoteUrl: null,
      repoRoot: '/workspace/aide',
    })
    const workspace = database.createWorkspace({
      branchName: 'main',
      name: 'main',
      projectId: project.id,
      windowId: null,
      worktreePath: '/workspace/aide',
    })

    database.saveWorkspaceSurfaceState(workspace.id, {
      layouts: {},
      surfaces: [],
    })

    const snapshot = database.getSnapshot()
    expect(snapshot.catalogRevision).toBeGreaterThan(initialRevision ?? 0)
    expect(snapshot.workspaceLayoutRevisions?.[workspace.id]).toBe(1)
    expect(snapshot.workspaceSurfaceRevisions?.[workspace.id]).toBe(1)
    database.close()
  })
})

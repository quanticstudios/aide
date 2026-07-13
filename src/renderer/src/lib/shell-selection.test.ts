import { describe, expect, it } from 'vitest'

import type {
  PersistenceSnapshot,
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'
import {
  resolveBootSelection,
  resolveShellSelection,
  selectLatestProject,
  selectLatestWorkspace,
  selectProject,
  selectRelativeWorkspace,
} from './shell-selection'

function createProject(id: string, name: string): ProjectRecord {
  return {
    id,
    name,
    repoRoot: `/repo/${name}`,
    remoteUrl: null,
    defaultBranch: 'main',
    createdAt: `2026-03-22T00:00:0${id}Z`,
    updatedAt: `2026-03-22T00:00:0${id}Z`,
  }
}

function createWorkspace(
  id: string,
  projectId: string,
  name: string,
): WorkspaceRecord {
  return {
    id,
    projectId,
    name,
    branchName: 'main',
    worktreePath: `/repo/${name}`,
    windowId: null,
    createdAt: `2026-03-22T00:00:1${id}Z`,
    updatedAt: `2026-03-22T00:00:1${id}Z`,
  }
}

function createSnapshot(
  projects: ProjectRecord[],
  workspaces: WorkspaceRecord[],
): PersistenceSnapshot {
  return {
    catalogRevision: 0,
    databasePath: '.aide.sqlite3',
    lastActivePaneIdsByWorkspace: {},
    lastActiveProjectId: null,
    lastActiveWorkspaceIdsByProject: {},
    lastActiveWorkspaceId: null,
    migrationStrategy: 'test',
    schemaVersion: 3,
    projects,
    workspaceLayoutRevisions: {},
    workspaceLayouts: {},
    workspaceSurfaceRevisions: {},
    workspaces,
  }
}

describe('resolveShellSelection', () => {
  it('falls back to the first project and its first workspace', () => {
    const snapshot = createSnapshot(
      [createProject('1', 'alpha'), createProject('2', 'beta')],
      [
        createWorkspace('1', '1', 'alpha-one'),
        createWorkspace('2', '2', 'beta-one'),
      ],
    )

    expect(resolveShellSelection(snapshot, null, null)).toEqual({
      activeProjectId: '1',
      activeWorkspaceId: '1',
    })
  })

  it('keeps a valid active project and workspace pair', () => {
    const snapshot = createSnapshot(
      [createProject('1', 'alpha')],
      [createWorkspace('1', '1', 'alpha-one')],
    )

    expect(resolveShellSelection(snapshot, '1', '1')).toEqual({
      activeProjectId: '1',
      activeWorkspaceId: '1',
    })
  })

  it('repairs an invalid workspace by choosing the first workspace in the active project', () => {
    const snapshot = createSnapshot(
      [createProject('1', 'alpha')],
      [
        createWorkspace('1', '1', 'alpha-one'),
        createWorkspace('2', '1', 'alpha-two'),
      ],
    )

    expect(resolveShellSelection(snapshot, '1', 'missing')).toEqual({
      activeProjectId: '1',
      activeWorkspaceId: '1',
    })
  })

  it('clears the workspace when the selected project has none', () => {
    const snapshot = createSnapshot(
      [createProject('1', 'alpha'), createProject('2', 'beta')],
      [createWorkspace('1', '1', 'alpha-one')],
    )

    expect(resolveShellSelection(snapshot, '2', '1')).toEqual({
      activeProjectId: '2',
      activeWorkspaceId: null,
    })
  })
})

describe('resolveBootSelection', () => {
  it('restores the stored selection when local state is empty', () => {
    const snapshot = {
      ...createSnapshot(
        [createProject('1', 'alpha'), createProject('2', 'beta')],
        [
          createWorkspace('1', '1', 'alpha-one'),
          createWorkspace('2', '2', 'beta-one'),
        ],
      ),
      lastActiveProjectId: '2',
      lastActiveWorkspaceId: '2',
    }

    expect(resolveBootSelection(snapshot, null, null)).toEqual({
      activeProjectId: '2',
      activeWorkspaceId: '2',
    })
  })

  it('prefers current in-memory selection over stored restore state', () => {
    const snapshot = {
      ...createSnapshot(
        [createProject('1', 'alpha'), createProject('2', 'beta')],
        [
          createWorkspace('1', '1', 'alpha-one'),
          createWorkspace('2', '2', 'beta-one'),
        ],
      ),
      lastActiveProjectId: '2',
      lastActiveWorkspaceId: '2',
    }

    expect(resolveBootSelection(snapshot, '1', '1')).toEqual({
      activeProjectId: '1',
      activeWorkspaceId: '1',
    })
  })
})

describe('project selection helpers', () => {
  const snapshot = createSnapshot(
    [createProject('1', 'alpha'), createProject('2', 'beta')],
    [
      createWorkspace('1', '1', 'alpha-one'),
      createWorkspace('2', '1', 'alpha-two'),
      createWorkspace('3', '2', 'beta-one'),
    ],
  )

  it('selectProject chooses the first workspace in the project', () => {
    expect(selectProject(snapshot, '2')).toEqual({
      activeProjectId: '2',
      activeWorkspaceId: '3',
    })
  })

  it('selectLatestProject chooses the newest project and its first workspace', () => {
    expect(selectLatestProject(snapshot)).toEqual({
      activeProjectId: '2',
      activeWorkspaceId: '3',
    })
  })

  it('selectLatestWorkspace chooses the newest workspace in the active project', () => {
    expect(selectLatestWorkspace(snapshot, '1')).toEqual({
      activeProjectId: '1',
      activeWorkspaceId: '2',
    })
  })

  it('selectRelativeWorkspace moves horizontally through workspaces and wraps', () => {
    expect(selectRelativeWorkspace(snapshot, '1', '1', 1)).toEqual({
      activeProjectId: '1',
      activeWorkspaceId: '2',
    })

    expect(selectRelativeWorkspace(snapshot, '1', '1', -1)).toEqual({
      activeProjectId: '1',
      activeWorkspaceId: '2',
    })
  })
})

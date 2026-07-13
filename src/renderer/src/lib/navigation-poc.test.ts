import { describe, expect, it } from 'vitest'

import type { PersistenceSnapshot } from '../../../shared/persistence'
import {
  NAVIGATION_POC_SNAPSHOT,
  getWorkspacePaneTemplateId,
  getWorkspaceScene,
  isNavigationPocSnapshot,
  resolveNavigationSnapshot,
  resolveWorkspacePane,
  resolveWorkspacePaneId,
  selectRelativePane,
} from './navigation-poc'

describe('resolveNavigationSnapshot', () => {
  it('keeps the real empty snapshot by default when storage is empty', () => {
    const emptySnapshot: PersistenceSnapshot = {
      catalogRevision: 0,
      databasePath: '.aide.sqlite3',
      lastActivePaneIdsByWorkspace: {},
      lastActiveProjectId: null,
      lastActiveWorkspaceIdsByProject: {},
      lastActiveWorkspaceId: null,
      migrationStrategy: 'test',
      schemaVersion: 3,
      projects: [],
      workspaceLayoutRevisions: {},
      workspaceLayouts: {},
      workspaceSurfaceRevisions: {},
      workspaces: [],
    }

    expect(resolveNavigationSnapshot(emptySnapshot)).toBe(emptySnapshot)
  })

  it('falls back to the navigation POC snapshot only when explicitly enabled', () => {
    const emptySnapshot: PersistenceSnapshot = {
      catalogRevision: 0,
      databasePath: '.aide.sqlite3',
      lastActivePaneIdsByWorkspace: {},
      lastActiveProjectId: null,
      lastActiveWorkspaceIdsByProject: {},
      lastActiveWorkspaceId: null,
      migrationStrategy: 'test',
      schemaVersion: 3,
      projects: [],
      workspaceLayoutRevisions: {},
      workspaceLayouts: {},
      workspaceSurfaceRevisions: {},
      workspaces: [],
    }

    expect(resolveNavigationSnapshot(emptySnapshot, true)).toBe(
      NAVIGATION_POC_SNAPSHOT,
    )
  })

  it('keeps the real snapshot when persisted projects exist', () => {
    const realSnapshot: PersistenceSnapshot = {
      catalogRevision: 0,
      databasePath: '.aide.sqlite3',
      lastActivePaneIdsByWorkspace: {},
      lastActiveProjectId: 'project-1',
      lastActiveWorkspaceIdsByProject: {},
      lastActiveWorkspaceId: 'workspace-1',
      migrationStrategy: 'test',
      schemaVersion: 3,
      projects: [
        {
          id: 'project-1',
          name: 'real',
          repoRoot: '/repo/real',
          remoteUrl: null,
          defaultBranch: 'main',
          createdAt: '2026-03-22T00:00:00Z',
          updatedAt: '2026-03-22T00:00:00Z',
        },
      ],
      workspaceLayoutRevisions: {},
      workspaceLayouts: {},
      workspaceSurfaceRevisions: {},
      workspaces: [
        {
          id: 'workspace-1',
          projectId: 'project-1',
          name: 'Real workspace',
          branchName: 'main',
          worktreePath: '/repo/real/.worktrees/main',
          windowId: null,
          createdAt: '2026-03-22T00:00:00Z',
          updatedAt: '2026-03-22T00:00:00Z',
        },
      ],
    }

    expect(resolveNavigationSnapshot(realSnapshot)).toBe(realSnapshot)
  })
})

describe('navigation POC helpers', () => {
  it('recognizes the demo snapshot', () => {
    expect(isNavigationPocSnapshot(NAVIGATION_POC_SNAPSHOT)).toBe(true)
  })

  it('returns a pane scene for a known demo workspace', () => {
    expect(getWorkspaceScene('demo-workspace-aide-nav').panes.length).toBe(5)
  })

  it('repairs an invalid active pane to the first pane in the scene', () => {
    expect(resolveWorkspacePaneId('demo-workspace-aide-nav', null)).toBe('chat')
  })

  it('resolves duplicated pane ids back to their scene template', () => {
    expect(getWorkspacePaneTemplateId('git::copy-2')).toBe('git')
    expect(
      resolveWorkspacePane('demo-workspace-aide-nav', 'git::copy-2'),
    ).toMatchObject({
      id: 'git::copy-2',
      label: 'Git review copy 2',
      type: 'Git',
    })
  })

  it('moves left and right across panes with wraparound', () => {
    expect(selectRelativePane('demo-workspace-aide-nav', 'chat', 1)).toBe(
      'terminal',
    )
    expect(selectRelativePane('demo-workspace-aide-nav', 'chat', -1)).toBe(
      'preview',
    )
  })
})

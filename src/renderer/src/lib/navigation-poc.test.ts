import { describe, expect, it } from 'vitest'

import type { PersistenceSnapshot } from '../../../shared/persistence'
import {
  NAVIGATION_POC_SNAPSHOT,
  getWorkspaceScene,
  isNavigationPocSnapshot,
  resolveNavigationSnapshot,
} from './navigation-poc'

describe('resolveNavigationSnapshot', () => {
  it('falls back to the navigation POC snapshot when storage is empty', () => {
    const emptySnapshot: PersistenceSnapshot = {
      databasePath: '.aide.sqlite3',
      lastActiveProjectId: null,
      lastActiveWorkspaceId: null,
      migrationStrategy: 'test',
      schemaVersion: 2,
      projects: [],
      workspaces: [],
    }

    expect(resolveNavigationSnapshot(emptySnapshot)).toBe(
      NAVIGATION_POC_SNAPSHOT,
    )
  })

  it('keeps the real snapshot when persisted projects exist', () => {
    const realSnapshot: PersistenceSnapshot = {
      databasePath: '.aide.sqlite3',
      lastActiveProjectId: 'project-1',
      lastActiveWorkspaceId: 'workspace-1',
      migrationStrategy: 'test',
      schemaVersion: 2,
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
})

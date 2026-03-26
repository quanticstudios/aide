import { describe, expect, it } from 'vitest'

import type {
  PersistenceSnapshot,
  WorkspaceLayoutRecord,
} from '../../../shared/persistence'
import {
  collectWorkspaceLayoutPaneIds,
  resolveWorkspaceLayout,
  resolveWorkspaceLayoutRoot,
} from './workspace-layout'

function createSnapshot(
  workspaceLayouts: Record<string, WorkspaceLayoutRecord>,
): PersistenceSnapshot {
  return {
    databasePath: '.aide.sqlite3',
    lastActivePaneIdsByWorkspace: {},
    lastActiveProjectId: null,
    lastActiveWorkspaceIdsByProject: {},
    lastActiveWorkspaceId: null,
    migrationStrategy: 'test',
    schemaVersion: 4,
    projects: [],
    workspaceLayouts,
    workspaces: [],
  }
}

describe('workspace layout helpers', () => {
  it('collects pane ids from nested layout nodes', () => {
    const layout: WorkspaceLayoutRecord = {
      nodes: [
        {
          children: ['left-pane', 'right-split'],
          id: 'root',
          paneId: null,
          parentId: null,
          sizeWeights: [2, 1],
          type: 'split-horizontal',
          workspaceId: 'workspace-1',
        },
        {
          children: [],
          id: 'left-pane',
          paneId: 'chat',
          parentId: 'root',
          sizeWeights: [],
          type: 'pane',
          workspaceId: 'workspace-1',
        },
        {
          children: ['top-pane', 'bottom-pane'],
          id: 'right-split',
          paneId: null,
          parentId: 'root',
          sizeWeights: [1, 1],
          type: 'split-vertical',
          workspaceId: 'workspace-1',
        },
        {
          children: [],
          id: 'top-pane',
          paneId: 'git',
          parentId: 'right-split',
          sizeWeights: [],
          type: 'pane',
          workspaceId: 'workspace-1',
        },
        {
          children: [],
          id: 'bottom-pane',
          paneId: 'preview',
          parentId: 'right-split',
          sizeWeights: [],
          type: 'pane',
          workspaceId: 'workspace-1',
        },
      ],
      rootNodeId: 'root',
      workspaceId: 'workspace-1',
    }

    expect(collectWorkspaceLayoutPaneIds(layout)).toEqual([
      'chat',
      'git',
      'preview',
    ])
    expect(resolveWorkspaceLayoutRoot(layout)?.id).toBe('root')
  })

  it('falls back to a flat layout when a workspace has no persisted tree yet', () => {
    const layout = resolveWorkspaceLayout(
      createSnapshot({}),
      'demo-workspace-aide-nav',
    )

    expect(layout?.workspaceId).toBe('demo-workspace-aide-nav')
    expect(layout?.rootNodeId).toBe('demo-workspace-aide-nav:fallback-root')
    expect(collectWorkspaceLayoutPaneIds(layout ?? null)).toEqual([
      'chat',
      'terminal',
      'git',
      'editor',
      'preview',
    ])
  })

  it('prefers the persisted layout when it exists', () => {
    const persistedLayout: WorkspaceLayoutRecord = {
      nodes: [
        {
          children: [],
          id: 'pane-1',
          paneId: 'terminal',
          parentId: null,
          sizeWeights: [],
          type: 'pane',
          workspaceId: 'workspace-2',
        },
      ],
      rootNodeId: 'pane-1',
      workspaceId: 'workspace-2',
    }

    expect(
      resolveWorkspaceLayout(
        createSnapshot({ 'workspace-2': persistedLayout }),
        'workspace-2',
      ),
    ).toEqual(persistedLayout)
  })
})

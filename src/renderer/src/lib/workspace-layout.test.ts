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
    catalogRevision: 0,
    databasePath: '.aide.sqlite3',
    lastActivePaneIdsByWorkspace: {},
    lastActiveProjectId: null,
    lastActiveWorkspaceIdsByProject: {},
    lastActiveWorkspaceId: null,
    migrationStrategy: 'test',
    schemaVersion: 4,
    projects: [],
    workspaceLayoutRevisions: {},
    workspaceLayouts,
    workspaceSurfaceRevisions: {},
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
          activeViewIndex: 0,
          children: [],
          id: 'left-pane',
          paneId: 'chat',
          parentId: 'root',
          sizeWeights: [],
          type: 'pane',
          viewIds: ['chat'],
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
          activeViewIndex: 0,
          children: [],
          id: 'top-pane',
          paneId: 'git',
          parentId: 'right-split',
          sizeWeights: [],
          type: 'pane',
          viewIds: ['git'],
          workspaceId: 'workspace-1',
        },
        {
          activeViewIndex: 0,
          children: [],
          id: 'bottom-pane',
          paneId: 'preview',
          parentId: 'right-split',
          sizeWeights: [],
          type: 'pane',
          viewIds: ['preview'],
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

  it('keeps a workspace empty when it has no persisted tree yet', () => {
    expect(
      resolveWorkspaceLayout(createSnapshot({}), 'workspace-real-1'),
    ).toBeNull()
    expect(
      resolveWorkspaceLayout(createSnapshot({}), 'demo-workspace-aide-nav'),
    ).toBeNull()
  })

  it('prefers the persisted layout when it exists', () => {
    const persistedLayout: WorkspaceLayoutRecord = {
      nodes: [
        {
          activeViewIndex: 0,
          children: [],
          id: 'pane-1',
          paneId: 'terminal',
          parentId: null,
          sizeWeights: [],
          type: 'pane',
          viewIds: ['terminal'],
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

  it('repairs partial layout data into a valid split tree', () => {
    const persistedLayout = {
      nodes: [
        {
          children: ['chat-node', 'missing-node', 'preview-node'],
          id: 'root',
          paneId: null,
          parentId: 'broken-parent',
          sizeWeights: [0],
          type: 'split-horizontal',
          workspaceId: 'demo-workspace-aide-nav',
        },
        {
          activeViewIndex: 0,
          children: ['should-be-empty'],
          id: 'chat-node',
          paneId: 'chat',
          parentId: 'elsewhere',
          sizeWeights: [1],
          type: 'pane',
          viewIds: ['chat'],
          workspaceId: 'wrong-workspace',
        },
        {
          activeViewIndex: 0,
          children: [],
          id: 'preview-node',
          paneId: 'preview',
          parentId: null,
          sizeWeights: [],
          type: 'pane',
          viewIds: ['preview'],
          workspaceId: 'wrong-workspace',
        },
        {
          activeViewIndex: 0,
          children: [],
          id: 'orphan-node',
          paneId: 'git',
          parentId: null,
          sizeWeights: [],
          type: 'pane',
          viewIds: ['git'],
          workspaceId: 'demo-workspace-aide-nav',
        },
      ],
      rootNodeId: 'root',
      workspaceId: 'demo-workspace-aide-nav',
    } as WorkspaceLayoutRecord

    const layout = resolveWorkspaceLayout(
      createSnapshot({ 'demo-workspace-aide-nav': persistedLayout }),
      'demo-workspace-aide-nav',
    )

    expect(layout).not.toBeNull()
    expect(layout?.rootNodeId).toBe('root')
    expect(layout?.nodes).toEqual([
      {
        children: ['chat-node', 'preview-node'],
        id: 'root',
        paneId: null,
        parentId: null,
        sizeWeights: [1, 1],
        type: 'split-horizontal',
        workspaceId: 'demo-workspace-aide-nav',
      },
      {
        activeViewIndex: 0,
        children: [],
        id: 'chat-node',
        paneId: 'chat',
        parentId: 'root',
        sizeWeights: [],
        type: 'pane',
        viewIds: ['chat'],
        workspaceId: 'demo-workspace-aide-nav',
      },
      {
        activeViewIndex: 0,
        children: [],
        id: 'preview-node',
        paneId: 'preview',
        parentId: 'root',
        sizeWeights: [],
        type: 'pane',
        viewIds: ['preview'],
        workspaceId: 'demo-workspace-aide-nav',
      },
    ])
  })

  it('falls back when the persisted layout root is unusable', () => {
    const persistedLayout: WorkspaceLayoutRecord = {
      nodes: [
        {
          activeViewIndex: 0,
          children: [],
          id: 'pane-1',
          paneId: 'terminal',
          parentId: null,
          sizeWeights: [],
          type: 'pane',
          viewIds: ['terminal'],
          workspaceId: 'demo-workspace-aide-nav',
        },
      ],
      rootNodeId: 'missing-root',
      workspaceId: 'demo-workspace-aide-nav',
    }

    const layout = resolveWorkspaceLayout(
      createSnapshot({ 'demo-workspace-aide-nav': persistedLayout }),
      'demo-workspace-aide-nav',
    )

    expect(layout).toBeNull()
  })

  it('keeps a real workspace empty when the persisted layout is unusable', () => {
    const persistedLayout: WorkspaceLayoutRecord = {
      nodes: [
        {
          activeViewIndex: 0,
          children: [],
          id: 'pane-1',
          paneId: 'terminal',
          parentId: null,
          sizeWeights: [],
          type: 'pane',
          viewIds: ['terminal'],
          workspaceId: 'workspace-real-1',
        },
      ],
      rootNodeId: 'missing-root',
      workspaceId: 'workspace-real-1',
    }

    expect(
      resolveWorkspaceLayout(
        createSnapshot({ 'workspace-real-1': persistedLayout }),
        'workspace-real-1',
      ),
    ).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'

import type { WorkspaceLayoutRecord } from '../../../shared/persistence'
import {
  addPaneView,
  addWorkspacePane,
  closeWorkspacePane,
  createWorkspacePaneInstanceId,
  resizeWorkspacePane,
  splitWorkspacePane,
} from './workspace-layout-mutations'

const INSTANCE_ID_PATTERN =
  /^[a-z-]+::copy-instance-[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

function createSinglePaneLayout(): WorkspaceLayoutRecord {
  return {
    nodes: [
      {
        activeViewIndex: 0,
        children: [],
        id: 'root-pane',
        paneId: 'chat',
        parentId: null,
        sizeWeights: [],
        type: 'pane',
        viewIds: ['chat'],
        workspaceId: 'workspace-1',
      },
    ],
    rootNodeId: 'root-pane',
    workspaceId: 'workspace-1',
  }
}

function createTwoPaneLayout(): WorkspaceLayoutRecord {
  return {
    nodes: [
      {
        children: ['left-pane', 'right-pane'],
        id: 'root-split',
        paneId: null,
        parentId: null,
        sizeWeights: [1, 1],
        type: 'split-horizontal',
        workspaceId: 'workspace-1',
      },
      {
        activeViewIndex: 0,
        children: [],
        id: 'left-pane',
        paneId: 'chat',
        parentId: 'root-split',
        sizeWeights: [],
        type: 'pane',
        viewIds: ['chat'],
        workspaceId: 'workspace-1',
      },
      {
        activeViewIndex: 0,
        children: [],
        id: 'right-pane',
        paneId: 'git',
        parentId: 'root-split',
        sizeWeights: [],
        type: 'pane',
        viewIds: ['git'],
        workspaceId: 'workspace-1',
      },
    ],
    rootNodeId: 'root-split',
    workspaceId: 'workspace-1',
  }
}

describe('splitWorkspacePane', () => {
  it('replaces a pane leaf with a new split and duplicate pane', () => {
    const result = splitWorkspacePane(
      createSinglePaneLayout(),
      'chat',
      'split-vertical',
    )

    expect(result.didChange).toBe(true)
    expect(result.blockedReason).toBeNull()
    expect(result.nextActivePaneId).toBe('chat')
    expect(result.layout.rootNodeId).toBe('workspace-1:split-node:1')
    expect(result.layout.nodes).toContainEqual({
      children: ['root-pane', 'workspace-1:pane-node:1'],
      id: 'workspace-1:split-node:1',
      paneId: null,
      parentId: null,
      sizeWeights: [1, 1],
      type: 'split-vertical',
      workspaceId: 'workspace-1',
    })
    expect(result.layout.nodes).toContainEqual({
      activeViewIndex: 0,
      children: [],
      id: 'workspace-1:pane-node:1',
      paneId: expect.stringMatching(INSTANCE_ID_PATTERN),
      parentId: 'workspace-1:split-node:1',
      sizeWeights: [],
      type: 'pane',
      viewIds: [expect.stringMatching(INSTANCE_ID_PATTERN)],
      workspaceId: 'workspace-1',
    })
  })
})

describe('addWorkspacePane', () => {
  it('seeds the first pane into an empty workspace layout', () => {
    const result = addWorkspacePane(
      null,
      'workspace-1',
      'terminal',
      null,
      'split-horizontal',
    )

    expect(result.didChange).toBe(true)
    expect(result.blockedReason).toBeNull()
    expect(result.nextActivePaneId).toMatch(INSTANCE_ID_PATTERN)
    expect(result.layout).toEqual({
      nodes: [
        {
          activeViewIndex: 0,
          children: [],
          id: 'workspace-1:pane-node:1',
          paneId: result.nextActivePaneId,
          parentId: null,
          sizeWeights: [],
          type: 'pane',
          viewIds: [result.nextActivePaneId],
          workspaceId: 'workspace-1',
        },
      ],
      rootNodeId: 'workspace-1:pane-node:1',
      workspaceId: 'workspace-1',
    })
  })

  it('adds the selected pane type beside the active pane', () => {
    const result = addWorkspacePane(
      createSinglePaneLayout(),
      'workspace-1',
      'terminal',
      'chat',
      'split-horizontal',
    )

    expect(result.didChange).toBe(true)
    expect(result.blockedReason).toBeNull()
    expect(result.nextActivePaneId).toMatch(INSTANCE_ID_PATTERN)
    expect(result.layout.nodes).toContainEqual({
      children: ['root-pane', 'workspace-1:pane-node:1'],
      id: 'workspace-1:split-node:1',
      paneId: null,
      parentId: null,
      sizeWeights: [1, 1],
      type: 'split-horizontal',
      workspaceId: 'workspace-1',
    })
    expect(result.layout.nodes).toContainEqual({
      activeViewIndex: 0,
      children: [],
      id: 'workspace-1:pane-node:1',
      paneId: result.nextActivePaneId,
      parentId: 'workspace-1:split-node:1',
      sizeWeights: [],
      type: 'pane',
      viewIds: [result.nextActivePaneId],
      workspaceId: 'workspace-1',
    })
  })

  it('appends a new pane to the top-level horizontal pane track', () => {
    const result = addWorkspacePane(
      createTwoPaneLayout(),
      'workspace-1',
      'terminal',
      'git',
      'split-horizontal',
    )

    expect(result.didChange).toBe(true)
    expect(result.blockedReason).toBeNull()
    expect(result.nextActivePaneId).toMatch(INSTANCE_ID_PATTERN)
    expect(result.layout.rootNodeId).toBe('root-split')
    expect(result.layout.nodes).toContainEqual({
      children: ['left-pane', 'right-pane', 'workspace-1:pane-node:1'],
      id: 'root-split',
      paneId: null,
      parentId: null,
      sizeWeights: [1, 1, 1],
      type: 'split-horizontal',
      workspaceId: 'workspace-1',
    })
    expect(result.layout.nodes).toContainEqual({
      activeViewIndex: 0,
      children: [],
      id: 'workspace-1:pane-node:1',
      paneId: result.nextActivePaneId,
      parentId: 'root-split',
      sizeWeights: [],
      type: 'pane',
      viewIds: [result.nextActivePaneId],
      workspaceId: 'workspace-1',
    })
  })
})

describe('workspace pane identities', () => {
  it('does not reuse an identity after a pane closes', () => {
    const closedPaneId = createWorkspacePaneInstanceId('chat')
    const replacementPaneId = createWorkspacePaneInstanceId('chat')

    expect(closedPaneId).toMatch(INSTANCE_ID_PATTERN)
    expect(replacementPaneId).toMatch(INSTANCE_ID_PATTERN)
    expect(replacementPaneId).not.toBe(closedPaneId)
  })

  it('assigns a unique identity to a view added to a pane', () => {
    const result = addPaneView(createSinglePaneLayout(), 'chat', 'terminal')
    const paneNode = result.layout.nodes.find(
      (node) => node.type === 'pane' && node.paneId === 'chat',
    )

    expect(result.didChange).toBe(true)
    expect(paneNode?.type).toBe('pane')

    if (paneNode?.type !== 'pane') {
      throw new Error('Expected a pane node.')
    }

    expect(paneNode.viewIds[1]).toMatch(INSTANCE_ID_PATTERN)
  })
})

describe('closeWorkspacePane', () => {
  it('returns an empty layout when closing the last pane', () => {
    const result = closeWorkspacePane(createSinglePaneLayout(), 'chat')

    expect(result.didChange).toBe(true)
    expect(result.blockedReason).toBeNull()
    expect(result.nextActivePaneId).toBeNull()
    expect(result.layout.nodes).toEqual([])
    expect(result.layout.rootNodeId).toBe('')
  })

  it('collapses the parent split and focuses the surviving sibling', () => {
    const result = closeWorkspacePane(createTwoPaneLayout(), 'chat')

    expect(result.didChange).toBe(true)
    expect(result.blockedReason).toBeNull()
    expect(result.nextActivePaneId).toBe('git')
    expect(result.layout.rootNodeId).toBe('right-pane')
    expect(result.layout.nodes).toEqual([
      {
        activeViewIndex: 0,
        children: [],
        id: 'right-pane',
        paneId: 'git',
        parentId: null,
        sizeWeights: [],
        type: 'pane',
        viewIds: ['git'],
        workspaceId: 'workspace-1',
      },
    ])
  })
})

describe('resizeWorkspacePane', () => {
  it('adjusts sibling weights without changing the pane set', () => {
    const result = resizeWorkspacePane(createTwoPaneLayout(), 'chat', 0.35)
    const rootNode = result.layout.nodes.find(
      (node) => node.id === 'root-split',
    )

    expect(result.didChange).toBe(true)
    expect(result.blockedReason).toBeNull()
    expect(result.nextActivePaneId).toBe('chat')
    expect(rootNode?.type).toBe('split-horizontal')

    if (rootNode?.type !== 'split-horizontal') {
      throw new Error('Expected a split root node.')
    }

    expect(rootNode.sizeWeights[0]).toBeGreaterThan(
      rootNode.sizeWeights[1] ?? 0,
    )
    expect(rootNode.sizeWeights[1]).toBeGreaterThanOrEqual(0.2)
  })
})

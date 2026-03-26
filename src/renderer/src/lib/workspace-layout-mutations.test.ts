import { describe, expect, it } from 'vitest'

import type { WorkspaceLayoutRecord } from '../../../shared/persistence'
import {
  closeWorkspacePane,
  resizeWorkspacePane,
  splitWorkspacePane,
} from './workspace-layout-mutations'

function createSinglePaneLayout(): WorkspaceLayoutRecord {
  return {
    nodes: [
      {
        children: [],
        id: 'root-pane',
        paneId: 'chat',
        parentId: null,
        sizeWeights: [],
        type: 'pane',
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
        children: [],
        id: 'left-pane',
        paneId: 'chat',
        parentId: 'root-split',
        sizeWeights: [],
        type: 'pane',
        workspaceId: 'workspace-1',
      },
      {
        children: [],
        id: 'right-pane',
        paneId: 'git',
        parentId: 'root-split',
        sizeWeights: [],
        type: 'pane',
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
      children: [],
      id: 'workspace-1:pane-node:1',
      paneId: 'chat::copy-1',
      parentId: 'workspace-1:split-node:1',
      sizeWeights: [],
      type: 'pane',
      workspaceId: 'workspace-1',
    })
  })
})

describe('closeWorkspacePane', () => {
  it('protects the last pane in a workspace', () => {
    const result = closeWorkspacePane(createSinglePaneLayout(), 'chat')

    expect(result.didChange).toBe(false)
    expect(result.blockedReason).toBe('last-pane')
    expect(result.layout).toEqual(createSinglePaneLayout())
  })

  it('collapses the parent split and focuses the surviving sibling', () => {
    const result = closeWorkspacePane(createTwoPaneLayout(), 'chat')

    expect(result.didChange).toBe(true)
    expect(result.blockedReason).toBeNull()
    expect(result.nextActivePaneId).toBe('git')
    expect(result.layout.rootNodeId).toBe('right-pane')
    expect(result.layout.nodes).toEqual([
      {
        children: [],
        id: 'right-pane',
        paneId: 'git',
        parentId: null,
        sizeWeights: [],
        type: 'pane',
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

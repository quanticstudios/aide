import { describe, expect, it } from 'vitest'

import type { WorkspaceLayoutRecord } from '../../../shared/persistence'
import { resolveHorizontalPaneNeighbor } from './workspace-layout-navigation'

function createNavigationLayout(): WorkspaceLayoutRecord {
  return {
    nodes: [
      {
        children: ['left-column', 'middle-column', 'right-pane'],
        id: 'root',
        paneId: null,
        parentId: null,
        sizeWeights: [1, 1, 1],
        type: 'split-horizontal',
        workspaceId: 'workspace-1',
      },
      {
        children: ['chat-pane', 'terminal-pane'],
        id: 'left-column',
        paneId: null,
        parentId: 'root',
        sizeWeights: [1, 1],
        type: 'split-vertical',
        workspaceId: 'workspace-1',
      },
      {
        activeViewIndex: 0,
        children: [],
        id: 'chat-pane',
        paneId: 'chat',
        parentId: 'left-column',
        sizeWeights: [],
        type: 'pane',
        viewIds: ['chat'],
        workspaceId: 'workspace-1',
      },
      {
        activeViewIndex: 0,
        children: [],
        id: 'terminal-pane',
        paneId: 'terminal',
        parentId: 'left-column',
        sizeWeights: [],
        type: 'pane',
        viewIds: ['terminal'],
        workspaceId: 'workspace-1',
      },
      {
        children: ['git-pane', 'editor-pane'],
        id: 'middle-column',
        paneId: null,
        parentId: 'root',
        sizeWeights: [1, 1],
        type: 'split-vertical',
        workspaceId: 'workspace-1',
      },
      {
        activeViewIndex: 0,
        children: [],
        id: 'git-pane',
        paneId: 'git',
        parentId: 'middle-column',
        sizeWeights: [],
        type: 'pane',
        viewIds: ['git'],
        workspaceId: 'workspace-1',
      },
      {
        activeViewIndex: 0,
        children: [],
        id: 'editor-pane',
        paneId: 'editor',
        parentId: 'middle-column',
        sizeWeights: [],
        type: 'pane',
        viewIds: ['editor'],
        workspaceId: 'workspace-1',
      },
      {
        activeViewIndex: 0,
        children: [],
        id: 'right-pane',
        paneId: 'preview',
        parentId: 'root',
        sizeWeights: [],
        type: 'pane',
        viewIds: ['preview'],
        workspaceId: 'workspace-1',
      },
    ],
    rootNodeId: 'root',
    workspaceId: 'workspace-1',
  }
}

describe('resolveHorizontalPaneNeighbor', () => {
  it('moves right according to the visible split-tree geometry', () => {
    const layout = createNavigationLayout()

    expect(resolveHorizontalPaneNeighbor(layout, 'chat', 1)).toBe('git')
    expect(resolveHorizontalPaneNeighbor(layout, 'terminal', 1)).toBe('editor')
    expect(resolveHorizontalPaneNeighbor(layout, 'git', 1)).toBe('preview')
    expect(resolveHorizontalPaneNeighbor(layout, 'editor', 1)).toBe('preview')
  })

  it('moves left according to the visible split-tree geometry', () => {
    const layout = createNavigationLayout()

    expect(resolveHorizontalPaneNeighbor(layout, 'git', -1)).toBe('chat')
    expect(resolveHorizontalPaneNeighbor(layout, 'editor', -1)).toBe('terminal')
    expect(resolveHorizontalPaneNeighbor(layout, 'preview', -1)).toBe('git')
  })

  it('wraps horizontally when there is no pane on that side', () => {
    const layout = createNavigationLayout()

    expect(resolveHorizontalPaneNeighbor(layout, 'chat', -1)).toBe('preview')
    expect(resolveHorizontalPaneNeighbor(layout, 'preview', 1)).toBe('chat')
  })

  it('falls back to the first pane when the active pane is missing', () => {
    expect(
      resolveHorizontalPaneNeighbor(createNavigationLayout(), null, 1),
    ).toBe('git')
  })
})

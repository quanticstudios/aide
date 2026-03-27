import { describe, expect, it } from 'vitest'

import { createWorkspaceLayoutPreset } from './workspace-layout-presets'

describe('createWorkspaceLayoutPreset', () => {
  it('creates a horizontal columns preset', () => {
    const layout = createWorkspaceLayoutPreset(
      'workspace-1',
      ['chat', 'git'],
      'columns',
    )

    expect(layout.rootNodeId).toBe('workspace-1:preset-root')
    expect(layout.nodes[0]).toMatchObject({
      children: ['workspace-1:pane:1', 'workspace-1:pane:2'],
      type: 'split-horizontal',
    })
  })

  it('creates a stacked vertical preset', () => {
    const layout = createWorkspaceLayoutPreset(
      'workspace-1',
      ['chat', 'git', 'preview'],
      'stack',
    )

    expect(layout.nodes[0]).toMatchObject({
      type: 'split-vertical',
    })
  })

  it('creates a focus preset with a primary pane and stacked secondary panes', () => {
    const layout = createWorkspaceLayoutPreset(
      'workspace-1',
      ['chat', 'git', 'preview'],
      'focus',
    )

    expect(layout.rootNodeId).toBe('workspace-1:focus-root')
    expect(layout.nodes[0]).toMatchObject({
      children: ['workspace-1:pane:1', 'workspace-1:focus-stack'],
      sizeWeights: [2, 1],
      type: 'split-horizontal',
    })
  })
})

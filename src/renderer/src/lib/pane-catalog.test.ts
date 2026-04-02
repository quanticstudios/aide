import { describe, expect, it } from 'vitest'

import {
  createDefaultPaneMetadata,
  createDefaultPaneState,
  createFallbackPaneMetadata,
  listPaneCatalogEntries,
  resolvePaneType,
} from './pane-catalog'

describe('pane catalog', () => {
  it('lists pane types in the expected creation order', () => {
    expect(listPaneCatalogEntries().map((entry) => entry.type)).toEqual([
      'chat',
      'terminal',
      'git',
      'editor',
      'preview',
    ])
  })

  it('creates central default metadata for registered pane types', () => {
    expect(createDefaultPaneMetadata('terminal')).toEqual({
      accent: 'emerald',
      description: 'Execution and verification surface.',
      label: 'Workspace terminal',
      type: 'Terminal',
    })
  })

  it('keeps pane default state creation centralized', () => {
    expect(createDefaultPaneState('preview')).toBeNull()
  })

  it('resolves pane types from display labels', () => {
    expect(resolvePaneType('Git')).toBe('git')
    expect(resolvePaneType('Preview')).toBe('preview')
    expect(resolvePaneType('Unknown')).toBeNull()
  })

  it('creates fallback pane metadata from the catalog when possible', () => {
    expect(createFallbackPaneMetadata('terminal::copy-2')).toEqual({
      metadata: {
        accent: 'emerald',
        description: 'Execution and verification surface.',
        label: 'Workspace terminal',
        type: 'Terminal',
      },
      resolvedType: 'terminal',
    })

    expect(createFallbackPaneMetadata('mystery-pane')).toEqual({
      metadata: {
        accent: 'blue',
        description: 'Task and coordination surface.',
        label: 'Chat task thread',
        type: 'Chat',
      },
      resolvedType: null,
    })
  })
})

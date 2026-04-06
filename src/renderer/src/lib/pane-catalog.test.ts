import { describe, expect, it } from 'vitest'

import {
  createDefaultPaneMetadata,
  createDefaultPaneState,
  createFallbackPaneMetadata,
  listPaneCatalogEntries,
  resolvePaneType,
  resolveTerminalLaunchModeForPaneId,
} from './pane-catalog'

describe('pane catalog', () => {
  it('lists pane templates in the expected creation order', () => {
    expect(listPaneCatalogEntries().map((entry) => entry.id)).toEqual([
      'chat',
      'terminal',
      'terminal-claude',
      'terminal-codex',
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
    expect(resolvePaneType('Claude')).toBe('terminal')
    expect(resolvePaneType('Codex')).toBe('terminal')
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
    expect(createFallbackPaneMetadata('terminal-claude::copy-2')).toEqual({
      metadata: {
        accent: 'emerald',
        description: 'Managed Claude Code terminal session.',
        label: 'Claude terminal',
        type: 'Claude',
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

  it('resolves terminal launch mode from pane ids', () => {
    expect(resolveTerminalLaunchModeForPaneId('terminal')).toBe('shell')
    expect(resolveTerminalLaunchModeForPaneId('terminal-claude::copy-2')).toBe(
      'claude',
    )
    expect(resolveTerminalLaunchModeForPaneId('terminal-codex')).toBe('codex')
  })
})

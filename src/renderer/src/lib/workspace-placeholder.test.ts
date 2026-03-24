import { describe, expect, it } from 'vitest'

import { getPlaceholderActionsForPane } from './workspace-placeholder'

describe('getPlaceholderActionsForPane', () => {
  it('returns pane-specific placeholder actions', () => {
    expect(getPlaceholderActionsForPane({ type: 'Git' })).toEqual([
      {
        description:
          'Review changed files in the order that best rebuilds confidence.',
        title: 'Scan the change set',
      },
      {
        description:
          'Open the file or diff view that explains what the agent just touched.',
        title: 'Jump to the risky file',
      },
      {
        description:
          'Decide whether the workspace is ready for commit, not just visually complete.',
        title: 'Trust or reject the work',
      },
    ])
  })

  it('falls back to generic actions for unknown pane types', () => {
    expect(getPlaceholderActionsForPane({ type: 'Unknown' })).toHaveLength(3)
  })
})

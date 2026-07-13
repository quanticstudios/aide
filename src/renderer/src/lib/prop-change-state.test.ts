import { describe, expect, it } from 'vitest'

import {
  isCurrentWorkspaceDiff,
  isCurrentWorkspaceRequest,
  shouldResetWorkspaceCreationDraft,
} from './prop-change-state'

describe('prop-change state transitions', () => {
  it('rejects stale and cross-workspace async responses', () => {
    expect(isCurrentWorkspaceRequest('workspace-2', 'workspace-2', 2, 2)).toBe(
      true,
    )
    expect(isCurrentWorkspaceRequest('workspace-2', 'workspace-1', 2, 1)).toBe(
      false,
    )
    expect(isCurrentWorkspaceRequest('workspace-2', 'workspace-2', 3, 2)).toBe(
      false,
    )
  })

  it('shows a diff only for the active workspace and selected file', () => {
    const diff = { path: 'README.md', workspaceId: 'workspace-1' }
    const oldError = {
      message: 'old failure',
      path: 'README.md',
      workspaceId: 'workspace-1',
    }

    expect(isCurrentWorkspaceDiff(diff, 'workspace-1', 'README.md')).toBe(true)
    expect(isCurrentWorkspaceDiff(diff, 'workspace-2', 'README.md')).toBe(false)
    expect(isCurrentWorkspaceDiff(diff, 'workspace-1', 'notes.txt')).toBe(false)
    expect(isCurrentWorkspaceDiff(oldError, 'workspace-1', 'notes.txt')).toBe(
      false,
    )
    expect(isCurrentWorkspaceDiff(null, 'workspace-1', 'README.md')).toBe(false)
  })

  it('resets a draft once per open project, not for refreshed project objects', () => {
    expect(shouldResetWorkspaceCreationDraft(null, 'project-1', true)).toBe(
      true,
    )
    expect(
      shouldResetWorkspaceCreationDraft('project-1', 'project-1', true),
    ).toBe(false)
    expect(
      shouldResetWorkspaceCreationDraft('project-1', 'project-2', true),
    ).toBe(true)
    expect(shouldResetWorkspaceCreationDraft(null, 'project-1', false)).toBe(
      false,
    )
  })
})

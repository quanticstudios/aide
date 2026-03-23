import { describe, expect, it } from 'vitest'

import {
  buildDefaultWorktreePath,
  createWorkspaceDraftValues,
  slugifyWorkspaceSegment,
} from './workspace-draft'

describe('workspace draft helpers', () => {
  it('slugifies branch names into safe worktree segments', () => {
    expect(slugifyWorkspaceSegment('feature/Agent Followups')).toBe(
      'feature-agent-followups',
    )
  })

  it('builds a default worktree path from repo root and branch', () => {
    expect(
      buildDefaultWorktreePath('/repo/aide', 'feature/agent-followups'),
    ).toBe('/repo/aide/.worktrees/feature-agent-followups')
  })

  it('creates stable default draft values', () => {
    expect(createWorkspaceDraftValues('/repo/aide', 3)).toEqual({
      branchName: 'workspace-3',
      name: 'Workspace 3',
      worktreePath: '/repo/aide/.worktrees/workspace-3',
    })
  })
})

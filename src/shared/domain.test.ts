import { describe, expect, it } from 'vitest'

import {
  DOMAIN_MODEL_GAPS,
  createDefaultLayoutRoot,
  createProjectDraft,
  createWorkspaceDraft,
} from './domain'

describe('domain model draft helpers', () => {
  it('creates a project draft with stable default settings', () => {
    expect(
      createProjectDraft({
        id: 'project-1',
        name: 'aide',
        repoRoot: '/repo/aide',
        remoteUrl: null,
        defaultBranch: 'main',
        setupCommand: null,
        createdAt: '2026-03-22T00:00:00Z',
        updatedAt: '2026-03-22T00:00:00Z',
        worktreeSetupRevision: 0,
      }),
    ).toMatchObject({
      settings: { preferredProviderId: null },
      workspaceIds: [],
    })
  })

  it('creates a workspace draft with navigation-first defaults', () => {
    expect(
      createWorkspaceDraft({
        id: 'workspace-1',
        projectId: 'project-1',
        name: 'Workspace 1',
        branchName: 'main',
        worktreePath: '/repo/aide/.worktrees/workspace-1',
        windowId: null,
        createdAt: '2026-03-22T00:00:00Z',
        updatedAt: '2026-03-22T00:00:00Z',
      }),
    ).toMatchObject({
      activePaneId: null,
      layoutRootId: null,
      pinned: false,
      previewTargets: [],
      providerConfig: { defaultProviderId: null },
      status: 'idle',
    })
  })

  it('creates a default pane-root layout node', () => {
    expect(createDefaultLayoutRoot('workspace-1', 'pane-1')).toEqual({
      activeViewIndex: 0,
      children: [],
      id: 'workspace-1:layout-root',
      parentId: null,
      paneId: 'pane-1',
      sizeWeights: [],
      type: 'pane',
      viewIds: ['pane-1'],
      workspaceId: 'workspace-1',
    })
  })

  it('keeps explicit gap notes for later phases', () => {
    expect(DOMAIN_MODEL_GAPS.length).toBeGreaterThanOrEqual(3)
  })
})

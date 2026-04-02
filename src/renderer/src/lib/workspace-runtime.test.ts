import { describe, expect, it } from 'vitest'

import type { WorkspaceRecord } from '../../../shared/persistence'
import {
  createDefaultPreviewTarget,
  getWorkspacePreviewState,
  selectWorkspacePreviewTarget,
  upsertWorkspacePreviewTarget,
} from './workspace-runtime'

const workspace: WorkspaceRecord = {
  branchName: 'main',
  createdAt: '2026-03-22T00:00:00Z',
  id: 'workspace-1',
  name: 'main',
  projectId: 'project-1',
  updatedAt: '2026-03-22T00:00:00Z',
  windowId: null,
  worktreePath: '/repo/aide',
}

describe('workspace preview runtime state', () => {
  it('creates a default preview target for a workspace with no runtime state', () => {
    const previewState = getWorkspacePreviewState({}, workspace)

    expect(previewState.targets).toEqual([
      createDefaultPreviewTarget(workspace),
    ])
    expect(previewState.activeTargetId).toBe(
      createDefaultPreviewTarget(workspace).id,
    )
  })

  it('upserts a new preview target and marks it active', () => {
    const runtimeState = upsertWorkspacePreviewTarget({
      runtimeState: {},
      url: 'localhost:3000',
      workspace,
    })
    const previewState = getWorkspacePreviewState(runtimeState, workspace)

    expect(previewState.targets).toEqual([
      expect.objectContaining({
        isActive: false,
        url: 'http://127.0.0.1:4173',
      }),
      expect.objectContaining({
        isActive: true,
        url: 'http://localhost:3000',
      }),
    ])
    expect(previewState.activeTargetId).toBe('preview:http://localhost:3000')
  })

  it('ignores invalid preview targets', () => {
    const runtimeState = upsertWorkspacePreviewTarget({
      runtimeState: {},
      url: 'https://example.com',
      workspace,
    })

    expect(getWorkspacePreviewState(runtimeState, workspace).targets).toEqual([
      createDefaultPreviewTarget(workspace),
    ])
  })

  it('selects an existing target as the active preview target', () => {
    const runtimeState = upsertWorkspacePreviewTarget({
      runtimeState: {},
      url: 'localhost:3000',
      workspace,
    })
    const selectedState = selectWorkspacePreviewTarget({
      runtimeState,
      targetId: 'preview:http://127.0.0.1:4173',
      workspace,
    })

    expect(getWorkspacePreviewState(selectedState, workspace).targets).toEqual([
      expect.objectContaining({
        isActive: true,
        url: 'http://127.0.0.1:4173',
      }),
      expect.objectContaining({
        isActive: false,
        url: 'http://localhost:3000',
      }),
    ])
  })
})

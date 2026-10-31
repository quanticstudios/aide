import { describe, expect, it, vi } from 'vitest'

import { WorkspaceTitleService } from './workspace-title-service'

function createWorkspace(
  overrides: Partial<{
    id: string
    name: string
    nameSource: 'default' | 'generated' | 'manual'
    updatedAt: string
  }> = {},
) {
  return {
    id: 'workspace-1',
    name: 'Main',
    nameSource: 'default' as const,
    updatedAt: '2026-09-18T10:00:00.000Z',
    ...overrides,
  }
}

describe('WorkspaceTitleService', () => {
  it('names the workspace after a concise prompt excerpt, once', () => {
    const workspace = createWorkspace()
    const renameWorkspaceIfUnchanged = vi.fn(() => workspace)
    const service = new WorkspaceTitleService({
      store: { getWorkspace: () => workspace, renameWorkspaceIfUnchanged },
    })

    service.titleWorkspace(
      workspace.id,
      'Repair navigation focus after changing the active workspace order',
    )
    service.titleWorkspace(workspace.id, 'A second prompt')

    expect(renameWorkspaceIfUnchanged).toHaveBeenCalledTimes(1)
    expect(renameWorkspaceIfUnchanged).toHaveBeenCalledWith(workspace.id, {
      expectedUpdatedAt: workspace.updatedAt,
      name: 'Repair navigation focus after changing the active workspace',
      nameSource: 'generated',
    })
  })

  it('keeps a manual rename', () => {
    const workspace = createWorkspace({
      name: 'My workspace',
      nameSource: 'manual',
    })
    const renameWorkspaceIfUnchanged = vi.fn()
    const service = new WorkspaceTitleService({
      store: { getWorkspace: () => workspace, renameWorkspaceIfUnchanged },
    })

    service.titleWorkspace(workspace.id, 'Repair the navigation focus bug')

    expect(renameWorkspaceIfUnchanged).not.toHaveBeenCalled()
  })

  it('tries again when the conditional write lost to a concurrent change', () => {
    const workspace = createWorkspace()
    const renameWorkspaceIfUnchanged = vi.fn(() => null)
    const service = new WorkspaceTitleService({
      store: { getWorkspace: () => workspace, renameWorkspaceIfUnchanged },
    })

    service.titleWorkspace(workspace.id, 'Repair navigation focus')
    service.titleWorkspace(workspace.id, 'Repair navigation focus')

    expect(renameWorkspaceIfUnchanged).toHaveBeenCalledTimes(2)
  })
})

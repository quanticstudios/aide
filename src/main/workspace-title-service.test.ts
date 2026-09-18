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

function createCapabilities(models: readonly { id: string; label: string }[]) {
  return {
    providers: {
      claude: {
        defaultModelId: null,
        error: null,
        models: [],
        provider: 'claude' as const,
        version: null,
      },
      codex: {
        defaultModelId: models[0]?.id ?? null,
        error: null,
        models: models.map((model) => ({
          aliases: [],
          defaultReasoningEffort: null,
          defaultServiceTier: null,
          description: '',
          id: model.id,
          isDefault: false,
          label: model.label,
          reasoningEfforts: [],
          serviceTiers: [],
        })),
        provider: 'codex' as const,
        version: null,
      },
    },
  }
}

describe('WorkspaceTitleService', () => {
  it('uses the advertised Luna model and records the generated title once', async () => {
    const workspace = createWorkspace()
    const renameWorkspaceIfUnchanged = vi.fn(() => ({
      ...workspace,
      name: 'Repair navigation focus',
      nameSource: 'generated' as const,
    }))
    const generateTitle = vi.fn(async () => 'Repair navigation focus')
    const service = new WorkspaceTitleService({
      generateTitle,
      getCapabilities: async () =>
        createCapabilities([
          { id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' },
          { id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' },
        ]),
      store: {
        getWorkspace: () => workspace,
        renameWorkspaceIfUnchanged,
      },
    })

    await service.titleWorkspace(
      workspace.id,
      'Repair the navigation focus bug',
    )

    await service.titleWorkspace(
      workspace.id,
      'Repair the navigation focus bug',
    )

    await service.titleWorkspace(
      workspace.id,
      'Repair the navigation focus bug',
    )

    expect(generateTitle).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-5.6-luna' }),
    )
    expect(renameWorkspaceIfUnchanged).toHaveBeenCalledWith(workspace.id, {
      expectedUpdatedAt: workspace.updatedAt,
      name: 'Repair navigation focus',
      nameSource: 'generated',
    })
    expect(renameWorkspaceIfUnchanged).toHaveBeenCalledTimes(1)
  })

  it('keeps a manual rename and does not call Luna', async () => {
    const workspace = createWorkspace({
      name: 'My workspace',
      nameSource: 'manual',
    })
    const generateTitle = vi.fn(async () => 'Ignored')
    const renameWorkspaceIfUnchanged = vi.fn()
    const service = new WorkspaceTitleService({
      generateTitle,
      getCapabilities: async () =>
        createCapabilities([{ id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' }]),
      store: {
        getWorkspace: () => workspace,
        renameWorkspaceIfUnchanged,
      },
    })

    await service.titleWorkspace(
      workspace.id,
      'Repair the navigation focus bug',
    )

    expect(generateTitle).not.toHaveBeenCalled()
    expect(renameWorkspaceIfUnchanged).not.toHaveBeenCalled()
  })

  it('uses a concise prompt excerpt when Luna is unavailable', async () => {
    const workspace = createWorkspace()
    const renameWorkspaceIfUnchanged = vi.fn()
    const generateTitle = vi.fn(async () => 'Ignored')
    const service = new WorkspaceTitleService({
      generateTitle,
      getCapabilities: async () =>
        createCapabilities([{ id: 'gpt-5.6-terra', label: 'GPT-5.6 Terra' }]),
      store: {
        getWorkspace: () => workspace,
        renameWorkspaceIfUnchanged,
      },
    })

    await service.titleWorkspace(
      workspace.id,
      'Repair navigation focus after changing the active workspace order',
    )

    expect(generateTitle).not.toHaveBeenCalled()
    expect(renameWorkspaceIfUnchanged).toHaveBeenCalledWith(workspace.id, {
      expectedUpdatedAt: workspace.updatedAt,
      name: 'Repair navigation focus after changing the active workspace',
      nameSource: 'generated',
    })
  })

  it('keeps the local fallback when Luna fails', async () => {
    const workspace = createWorkspace()
    const renameWorkspaceIfUnchanged = vi.fn()
    const service = new WorkspaceTitleService({
      generateTitle: async () => {
        throw new Error('offline')
      },
      getCapabilities: async () =>
        createCapabilities([{ id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' }]),
      store: {
        getWorkspace: () => workspace,
        renameWorkspaceIfUnchanged,
      },
    })

    await service.titleWorkspace(workspace.id, 'Repair navigation focus now')

    expect(renameWorkspaceIfUnchanged).toHaveBeenCalledWith(
      workspace.id,
      expect.objectContaining({ name: 'Repair navigation focus now' }),
    )
  })

  it('passes its original version to the conditional generated-title write', async () => {
    const workspace = createWorkspace()
    const renameWorkspaceIfUnchanged = vi.fn(() => null)
    const service = new WorkspaceTitleService({
      generateTitle: async () => 'Repair navigation focus',
      getCapabilities: async () =>
        createCapabilities([{ id: 'gpt-5.6-luna', label: 'GPT-5.6 Luna' }]),
      store: {
        getWorkspace: () => workspace,
        renameWorkspaceIfUnchanged,
      },
    })

    await service.titleWorkspace(workspace.id, 'Repair navigation focus')

    expect(renameWorkspaceIfUnchanged).toHaveBeenCalledWith(
      workspace.id,
      expect.objectContaining({ expectedUpdatedAt: workspace.updatedAt }),
    )
  })
})

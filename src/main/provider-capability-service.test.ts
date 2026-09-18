import { describe, expect, it } from 'vitest'

import { ProviderCapabilityService } from './provider-capability-service'

function createClaudeModelList() {
  return [
    {
      description: 'Test Claude model',
      displayName: 'Claude Test',
      resolvedModel: 'claude-test',
      supportedEffortLevels: ['high'],
      supportsEffort: true,
      value: 'default',
    },
  ]
}

describe('ProviderCapabilityService', () => {
  it('uses structured provider capabilities once and gates session input', async () => {
    let claudeModelListCalls = 0
    let codexModelListCalls = 0
    const service = new ProviderCapabilityService({
      listClaudeModels: async () => {
        claudeModelListCalls += 1
        return createClaudeModelList()
      },
      listCodexModels: async () => {
        codexModelListCalls += 1
        return {
          data: [
            {
              defaultReasoningEffort: 'high',
              defaultServiceTier: 'priority',
              description: 'Test model',
              displayName: 'GPT Test',
              hidden: false,
              id: 'gpt-test',
              isDefault: true,
              model: 'gpt-test',
              serviceTiers: [
                {
                  description: 'Fast lane',
                  id: 'priority',
                  name: 'Fast',
                },
              ],
              supportedReasoningEfforts: [
                { description: 'Careful', reasoningEffort: 'high' },
              ],
            },
          ],
        }
      },
    })

    const [first, second] = await Promise.all([
      service.getSnapshot(),
      service.getSnapshot(),
    ])

    expect(second).toBe(first)
    expect(claudeModelListCalls).toBe(1)
    expect(codexModelListCalls).toBe(1)
    expect(first.providers.claude.defaultModelId).toBe('default')
    expect(first.providers.codex.models[0]).toMatchObject({
      defaultReasoningEffort: 'high',
      defaultServiceTier: 'priority',
      id: 'gpt-test',
    })

    await expect(
      service.resolveManagedSessionConfig({
        cwd: '/tmp/project',
        effort: 'retired-effort',
        mode: 'codex',
        model: 'retired-model',
        paneId: 'pane-1',
        serviceTier: 'retired-tier',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
      }),
    ).resolves.toMatchObject({
      effort: 'high',
      model: 'gpt-test',
      selectionNotice:
        'The saved model “retired-model” is not supported by this Codex installation. Using GPT Test instead.',
      serviceTier: 'priority',
    })

    await expect(
      service.resolveManagedSessionProviderSelection({
        effort: 'high',
        mode: 'codex',
        model: 'gpt-test',
        serviceTier: 'priority',
      }),
    ).resolves.toMatchObject({
      effort: 'high',
      model: 'gpt-test',
      selectionNotice: null,
      serviceTier: 'priority',
    })
  })

  it('rejects malformed IPC input before it can reach a provider process', async () => {
    const service = new ProviderCapabilityService({
      listClaudeModels: async () => createClaudeModelList(),
      listCodexModels: async () => ({ data: [] }),
    })

    await expect(
      service.resolveManagedSessionConfig({
        cwd: '/tmp/project',
        mode: 'not-a-provider',
        paneId: 'pane-1',
        sessionId: 'session-1',
        workspaceId: 'workspace-1',
      }),
    ).rejects.toThrow('Invalid managed-session mode.')
  })

  it('drops a stale service tier when the resolved model no longer advertises tiers', async () => {
    const service = new ProviderCapabilityService({
      listClaudeModels: async () => createClaudeModelList(),
      listCodexModels: async () => ({
        data: [
          {
            defaultReasoningEffort: 'medium',
            description: 'Tierless model',
            displayName: 'Tierless model',
            hidden: false,
            id: 'tierless-model',
            isDefault: true,
            model: 'tierless-model',
            serviceTiers: [],
            supportedReasoningEfforts: [
              { description: 'Balanced', reasoningEffort: 'medium' },
            ],
          },
        ],
      }),
    })

    const config = await service.resolveManagedSessionConfig({
      cwd: '/tmp/project',
      effort: 'medium',
      mode: 'codex',
      model: 'tierless-model',
      paneId: 'pane-1',
      serviceTier: 'retired-tier',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
    })
    const selection = await service.resolveManagedSessionProviderSelection({
      effort: 'medium',
      mode: 'codex',
      model: 'tierless-model',
      serviceTier: 'retired-tier',
    })

    expect(config).not.toHaveProperty('serviceTier')
    expect(selection).not.toHaveProperty('serviceTier')
  })

  it('keeps Claude models without effort support selectable', async () => {
    const service = new ProviderCapabilityService({
      listClaudeModels: async () => [
        {
          description: 'Fastest for quick answers',
          displayName: 'Haiku',
          resolvedModel: 'claude-haiku-4-5-20251001',
          value: 'haiku',
        },
      ],
      listCodexModels: async () => ({ data: [] }),
    })

    const selection = await service.resolveManagedSessionProviderSelection({
      effort: 'high',
      mode: 'claude',
      model: 'haiku',
    })

    expect(selection).toMatchObject({
      mode: 'claude',
      model: 'haiku',
      selectionNotice:
        'Haiku does not support reasoning levels. Using the provider default instead.',
    })
    const config = await service.resolveManagedSessionConfig({
      cwd: '/tmp/project',
      effort: 'high',
      mode: 'claude',
      model: 'haiku',
      paneId: 'pane-1',
      sessionId: 'session-1',
      workspaceId: 'workspace-1',
    })
    expect(config).not.toHaveProperty('effort')
    expect(selection).not.toHaveProperty('effort')
  })
})

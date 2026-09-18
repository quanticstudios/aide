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
        'Claude Haiku 4.5 does not support reasoning levels. Using the provider default instead.',
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

  it('caches workspace skill metadata and resolves only enabled native skills', async () => {
    let claudeCalls = 0
    let codexCalls = 0
    const service = new ProviderCapabilityService({
      listClaudeModels: async () => createClaudeModelList(),
      listClaudeSkills: async () => {
        claudeCalls += 1
        return {
          skills: [{ description: 'Claude test skill', name: 'claude-test' }],
        }
      },
      listCodexModels: async () => ({ data: [] }),
      listCodexSkills: async (cwd) => {
        codexCalls += 1
        return {
          data: [
            {
              cwd,
              errors: [],
              skills: [
                {
                  description: 'Codex test skill',
                  enabled: true,
                  name: 'codex-test',
                  path: '/native/codex-test/SKILL.md',
                },
                {
                  description: 'Disabled skill',
                  enabled: false,
                  name: 'disabled-test',
                  path: '/native/disabled-test/SKILL.md',
                },
              ],
            },
          ],
        }
      },
    })

    const first = await service.getProviderSkills(
      'workspace-1',
      '/tmp/workspace-1',
    )
    const second = await service.getProviderSkills(
      'workspace-1',
      '/tmp/workspace-1',
    )

    expect(second).toBe(first)
    expect(first.skills).toEqual([
      {
        description: 'Claude test skill',
        id: 'claude:skill:claude-test',
        name: 'claude-test',
        owner: 'Claude',
        provider: 'claude',
      },
      {
        description: 'Codex test skill',
        id: 'codex:skill:a815caa12b84b844',
        name: 'codex-test',
        owner: 'Codex',
        provider: 'codex',
      },
    ])
    expect(claudeCalls).toBe(1)
    expect(codexCalls).toBe(1)
    await expect(
      service.resolveProviderSkill('workspace-1', '/tmp/workspace-1', {
        id: 'codex:skill:a815caa12b84b844',
        provider: 'codex',
      }),
    ).resolves.toEqual({
      id: 'codex:skill:a815caa12b84b844',
      nativeName: 'codex-test',
      nativePath: '/native/codex-test/SKILL.md',
      provider: 'codex',
    })
    await expect(
      service.resolveProviderSkill('workspace-1', '/tmp/workspace-1', {
        id: 'codex:skill:disabled-test',
        provider: 'codex',
      }),
    ).rejects.toThrow('Selected provider skill is unavailable.')

    await service.getProviderSkills('workspace-1', '/tmp/workspace-1', true)
    expect(claudeCalls).toBe(2)
    expect(codexCalls).toBe(2)
  })

  it('deduplicates repeated native skills without merging providers', async () => {
    const service = new ProviderCapabilityService({
      listClaudeSkills: async () => ({
        skills: [
          { name: 'pro-design', description: 'First copy' },
          { name: 'pro-design', description: 'Effective copy' },
        ],
      }),
      listCodexSkills: async (cwd) => ({
        data: [
          {
            cwd,
            skills: [
              {
                name: 'pro-design',
                description: 'Codex design',
                enabled: true,
                path: '/native/design/SKILL.md',
              },
              {
                name: 'pro-design',
                description: 'Codex design',
                enabled: true,
                path: '/native/design/SKILL.md',
              },
            ],
          },
        ],
      }),
    })
    const snapshot = await service.getProviderSkills(
      'workspace-1',
      '/tmp/workspace-1',
    )
    expect(snapshot.skills).toHaveLength(2)
    expect(snapshot.skills.map((skill) => skill.provider)).toEqual([
      'claude',
      'codex',
    ])
    expect(snapshot.skills[0].description).toBe('Effective copy')
  })

  it('returns Claude skills when Codex discovery fails', async () => {
    const service = new ProviderCapabilityService({
      listClaudeModels: async () => createClaudeModelList(),
      listClaudeSkills: async () => ({
        skills: [{ description: 'Claude test skill', name: 'claude-test' }],
      }),
      listCodexModels: async () => ({ data: [] }),
      listCodexSkills: async () => {
        throw new Error('Codex unavailable')
      },
    })

    await expect(
      service.getProviderSkills('workspace-1', '/tmp/workspace-1'),
    ).resolves.toEqual({
      errors: { codex: 'Unable to discover Codex skills: Codex unavailable' },
      skills: [
        {
          description: 'Claude test skill',
          id: 'claude:skill:claude-test',
          name: 'claude-test',
          owner: 'Claude',
          provider: 'claude',
        },
      ],
    })
  })

  it('keeps same-name Codex skills distinct by native path', async () => {
    const service = new ProviderCapabilityService({
      listClaudeModels: async () => createClaudeModelList(),
      listClaudeSkills: async () => ({ skills: [] }),
      listCodexModels: async () => ({ data: [] }),
      listCodexSkills: async (cwd) => ({
        data: [
          {
            cwd,
            errors: [],
            skills: [
              {
                description: 'First skill',
                enabled: true,
                name: 'same-name',
                path: '/native/first/SKILL.md',
              },
              {
                description: 'Second skill',
                enabled: true,
                name: 'same-name',
                path: '/native/second/SKILL.md',
              },
            ],
          },
        ],
      }),
    })

    const snapshot = await service.getProviderSkills(
      'workspace-1',
      '/tmp/workspace-1',
    )
    const skills = snapshot.skills.filter((skill) => skill.provider === 'codex')

    expect(skills).toHaveLength(2)
    expect(new Set(skills.map((skill) => skill.id)).size).toBe(2)
    await expect(
      service.resolveProviderSkill(
        'workspace-1',
        '/tmp/workspace-1',
        skills[0],
      ),
    ).resolves.toMatchObject({ nativePath: '/native/first/SKILL.md' })
    await expect(
      service.resolveProviderSkill(
        'workspace-1',
        '/tmp/workspace-1',
        skills[1],
      ),
    ).resolves.toMatchObject({ nativePath: '/native/second/SKILL.md' })
  })
})

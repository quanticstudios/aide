import { describe, expect, it } from 'vitest'

import {
  formatClaudeModelLabel,
  normalizeClaudeModelList,
  normalizeCodexModelList,
  resolveProviderSelection,
} from './provider-capabilities'

describe('provider capabilities', () => {
  it('labels Claude models with family and version from the resolved id', () => {
    expect(
      formatClaudeModelLabel({
        displayName: 'Fable',
        resolvedModel: 'claude-fable-5-1',
        value: 'fable',
      }),
    ).toBe('Claude Fable 5.1')
    expect(
      formatClaudeModelLabel({
        displayName: 'Haiku',
        resolvedModel: 'claude-haiku-4-5-20251001',
        value: 'haiku',
      }),
    ).toBe('Claude Haiku 4.5')
    expect(
      formatClaudeModelLabel({
        displayName: 'Default (recommended)',
        resolvedModel: 'claude-opus-5[1m]',
        value: 'default',
      }),
    ).toBe('Claude Opus 5 · 1M (default)')
    expect(
      formatClaudeModelLabel({
        displayName: 'Legacy thing',
        resolvedModel: 'claude-3-5-sonnet-20241022',
        value: 'legacy',
      }),
    ).toBe('Legacy thing')
  })

  it('normalizes the Claude SDK model list and preserves effortless models', () => {
    const capabilities = normalizeClaudeModelList([
      {
        description: 'Opus 5 with 1M context',
        displayName: 'Default (recommended)',
        resolvedModel: 'claude-opus-5[1m]',
        supportedEffortLevels: ['low', 'medium', 'high', 'xhigh', 'max'],
        supportsEffort: true,
        value: 'default',
      },
      {
        description: 'Opus 5 with 1M context',
        displayName: 'Opus (1M context)',
        resolvedModel: 'claude-opus-5[1m]',
        supportedEffortLevels: ['high'],
        supportsEffort: true,
        value: 'opus[1m]',
      },
      {
        description: 'Fastest for quick answers',
        displayName: 'Haiku',
        resolvedModel: 'claude-haiku-4-5-20251001',
        value: 'haiku',
      },
    ])

    expect(capabilities.defaultModelId).toBe('default')
    expect(capabilities.models.map((model) => model.id)).toEqual([
      'default',
      'opus[1m]',
      'haiku',
    ])
    expect(capabilities.models[0]).toMatchObject({
      aliases: [
        {
          explanation:
            'The saved model “claude-opus-5[1m]” is available as Claude Opus 5 · 1M (default).',
          id: 'claude-opus-5[1m]',
        },
      ],
      defaultReasoningEffort: 'high',
      isDefault: true,
    })
    expect(capabilities.models[1]?.aliases).toEqual([])
    expect(capabilities.models[2]).toMatchObject({
      defaultReasoningEffort: null,
      reasoningEfforts: [],
    })
  })

  it('normalizes the structured Codex model/list response without inventing capabilities', () => {
    const capabilities = normalizeCodexModelList({
      data: [
        {
          defaultReasoningEffort: 'medium',
          defaultServiceTier: 'priority',
          description: 'Fast coding model',
          displayName: 'GPT-5.6 Terra',
          hidden: false,
          id: 'gpt-5.6-terra',
          isDefault: true,
          model: 'gpt-5.6-terra',
          serviceTiers: [
            {
              description: 'Higher priority',
              id: 'priority',
              name: 'Fast',
            },
          ],
          supportedReasoningEfforts: [
            { description: 'Fast', reasoningEffort: 'low' },
            { description: 'Balanced', reasoningEffort: 'medium' },
            { description: 'Deep', reasoningEffort: 'ultra' },
          ],
        },
        {
          defaultReasoningEffort: 'high',
          description: 'Hidden model',
          displayName: 'Hidden',
          hidden: true,
          id: 'hidden',
          isDefault: false,
          model: 'hidden',
          supportedReasoningEfforts: [],
        },
      ],
    })

    expect(capabilities.defaultModelId).toBe('gpt-5.6-terra')
    expect(capabilities.models).toEqual([
      {
        aliases: [],
        defaultReasoningEffort: 'medium',
        defaultServiceTier: 'priority',
        description: 'Fast coding model',
        id: 'gpt-5.6-terra',
        isDefault: true,
        label: 'GPT-5.6 Terra',
        reasoningEfforts: [
          { description: 'Fast', id: 'low', label: 'Low' },
          { description: 'Balanced', id: 'medium', label: 'Medium' },
          { description: 'Deep', id: 'ultra', label: 'Ultra' },
        ],
        serviceTiers: [
          { description: 'Higher priority', id: 'priority', label: 'Fast' },
        ],
      },
    ])
    expect(
      resolveProviderSelection(capabilities, {
        modelId: 'gpt-5.6-terra',
        serviceTier: null,
      }),
    ).toMatchObject({
      effort: 'medium',
      serviceTier: null,
    })
  })

  it('migrates known aliases and explains a persisted selection that is no longer supported', () => {
    const capabilities = normalizeClaudeModelList([
      {
        description: 'Opus 5 with 1M context',
        displayName: 'Default (recommended)',
        resolvedModel: 'claude-opus-5[1m]',
        supportedEffortLevels: ['low', 'high', 'max'],
        supportsEffort: true,
        value: 'default',
      },
    ])

    expect(
      resolveProviderSelection(capabilities, {
        effort: 'max',
        modelId: 'claude-opus-5[1m]',
      }),
    ).toMatchObject({
      effort: 'max',
      explanation:
        'The saved model “claude-opus-5[1m]” is available as Claude Opus 5 · 1M (default).',
      modelId: 'default',
    })

    expect(
      resolveProviderSelection(capabilities, {
        effort: 'not-supported',
        modelId: 'retired-model',
        serviceTier: 'retired-tier',
      }),
    ).toMatchObject({
      effort: 'high',
      explanation:
        'The saved model “retired-model” is not supported by this Claude installation. Using Claude Opus 5 · 1M (default) instead.',
      modelId: 'default',
      serviceTier: null,
    })
  })

  it('does not invent an effort for a Claude model that advertises none', () => {
    const capabilities = normalizeClaudeModelList([
      {
        description: 'Fastest for quick answers',
        displayName: 'Haiku',
        resolvedModel: 'claude-haiku-4-5-20251001',
        value: 'haiku',
      },
    ])

    expect(
      resolveProviderSelection(capabilities, {
        effort: 'high',
        modelId: 'haiku',
      }),
    ).toEqual({
      effort: null,
      explanation:
        'Claude Haiku 4.5 does not support reasoning levels. Using the provider default instead.',
      modelId: 'haiku',
      serviceTier: null,
    })
  })
})

import { describe, expect, it } from 'vitest'

import {
  buildClaudeProviderCapabilities,
  normalizeCodexModelList,
  resolveProviderSelection,
} from './provider-capabilities'

describe('provider capabilities', () => {
  it('gates newly supported Claude models by the detected CLI version', () => {
    const oldCapabilities = buildClaudeProviderCapabilities('2.0.10')
    const newCapabilities = buildClaudeProviderCapabilities('2.1.0')

    expect(oldCapabilities.models.map((model) => model.id)).toEqual([
      'claude-sonnet-4-6',
      'claude-opus-4-7',
    ])
    expect(newCapabilities.models.map((model) => model.id)).toEqual([
      'claude-sonnet-5',
      'claude-fable-5',
      'claude-opus-4-8',
      'claude-opus-4-7',
    ])
    expect(newCapabilities.defaultModelId).toBe('claude-sonnet-5')
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
  })

  it('migrates known aliases and explains a persisted selection that is no longer supported', () => {
    const capabilities = buildClaudeProviderCapabilities('2.1.0')

    expect(
      resolveProviderSelection(capabilities, {
        effort: 'max',
        modelId: 'claude-sonnet-4-6',
      }),
    ).toMatchObject({
      effort: 'max',
      explanation: 'Claude Sonnet 4.6 was renamed to Claude Sonnet 5.',
      modelId: 'claude-sonnet-5',
    })

    expect(
      resolveProviderSelection(capabilities, {
        effort: 'not-supported',
        modelId: 'retired-model',
        serviceTier: 'retired-tier',
      }),
    ).toMatchObject({
      effort: 'max',
      explanation:
        'The saved model “retired-model” is not supported by this Claude installation. Using Claude Sonnet 5 instead.',
      modelId: 'claude-sonnet-5',
      serviceTier: null,
    })
  })
})

import { describe, expect, it } from 'vitest'

import {
  PROVIDER_CAPABILITIES,
  resolveProviderSelection,
} from './provider-capabilities'

describe('provider capabilities', () => {
  it('offers one default model with efforts for each provider', () => {
    for (const capabilities of Object.values(PROVIDER_CAPABILITIES.providers)) {
      expect(capabilities.error).toBeNull()
      expect(
        capabilities.models.filter((model) => model.isDefault),
      ).toHaveLength(1)
      expect(capabilities.defaultModelId).toBe(
        capabilities.models.find((model) => model.isDefault)?.id,
      )
      for (const model of capabilities.models) {
        expect(model.reasoningEfforts.map((effort) => effort.id)).toContain(
          model.defaultReasoningEffort,
        )
      }
    }
  })

  it('keeps a listed selection and explains one that is no longer offered', () => {
    const claude = PROVIDER_CAPABILITIES.providers.claude

    expect(
      resolveProviderSelection(claude, {
        effort: 'max',
        modelId: 'claude-sonnet-5-5',
      }),
    ).toEqual({
      effort: 'max',
      explanation: null,
      modelId: 'claude-sonnet-5-5',
      serviceTier: null,
    })

    expect(
      resolveProviderSelection(claude, {
        effort: 'not-supported',
        modelId: 'retired-model',
        serviceTier: 'retired-tier',
      }),
    ).toMatchObject({
      effort: 'high',
      explanation:
        'The saved model “retired-model” is not supported by this Claude installation. Using Claude Opus 5.5 instead.',
      modelId: 'claude-opus-5-5',
      serviceTier: null,
    })
  })
})

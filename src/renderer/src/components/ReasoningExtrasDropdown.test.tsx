import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type {
  ProviderCapabilities,
  ProviderModelCapability,
} from '../../../shared/provider-capabilities'
import ReasoningExtrasDropdown from './ReasoningExtrasDropdown'

const sol: ProviderModelCapability = {
  aliases: [],
  defaultReasoningEffort: 'medium',
  defaultServiceTier: null,
  description: '',
  id: 'gpt-6.1-sol',
  isDefault: true,
  label: 'GPT-6.1 Sol',
  reasoningEfforts: [
    { description: '', id: 'medium', label: 'Medium' },
    { description: '', id: 'high', label: 'High' },
  ],
  serviceTiers: [],
}

function chip(model: ProviderModelCapability, serviceTier: string | null) {
  const codex: ProviderCapabilities = {
    defaultModelId: model.id,
    error: null,
    models: [model],
    provider: 'codex',
    version: null,
  }
  return renderToStaticMarkup(
    <ReasoningExtrasDropdown
      capabilities={{
        providers: {
          claude: { ...codex, provider: 'claude', models: [] },
          codex,
        },
      }}
      effort="high"
      model={model.id}
      onEffortChange={vi.fn()}
      onServiceTierChange={vi.fn()}
      provider="codex"
      serviceTier={serviceTier}
    />,
  )
}

describe('ReasoningExtrasDropdown', () => {
  it('shows the effort alone when the model has no service tiers', () => {
    const markup = chip(sol, null)
    expect(markup).toContain('High')
    expect(markup).not.toContain('Default')
  })

  it('names the chosen service tier', () => {
    const markup = chip(
      {
        ...sol,
        serviceTiers: [{ description: '', id: 'flex', label: 'Flex' }],
      },
      'flex',
    )
    expect(markup).toContain('High · Flex')
  })
})

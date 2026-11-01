import type { ManagedSessionMode } from './terminal'

export interface ProviderModelAlias {
  readonly explanation: string
  readonly id: string
}

export interface ProviderReasoningEffort {
  readonly description: string
  readonly id: string
  readonly label: string
}

export interface ProviderServiceTier {
  readonly description: string
  readonly id: string
  readonly label: string
}

export interface ProviderModelCapability {
  readonly aliases: readonly ProviderModelAlias[]
  readonly defaultReasoningEffort: string | null
  readonly defaultServiceTier: string | null
  readonly description: string
  readonly id: string
  readonly isDefault: boolean
  readonly label: string
  readonly reasoningEfforts: readonly ProviderReasoningEffort[]
  readonly serviceTiers: readonly ProviderServiceTier[]
}

export interface ProviderCapabilities {
  readonly defaultModelId: string | null
  readonly error: string | null
  readonly models: readonly ProviderModelCapability[]
  readonly provider: ManagedSessionMode
  readonly version: string | null
}

export interface ProviderCapabilitiesSnapshot {
  readonly providers: Readonly<Record<ManagedSessionMode, ProviderCapabilities>>
}

export interface ProviderSelectionInput {
  readonly effort?: string | null
  readonly modelId?: string | null
  readonly serviceTier?: string | null
}

export interface ProviderSelectionResolution {
  readonly effort: string | null
  readonly explanation: string | null
  readonly modelId: string | null
  readonly serviceTier: string | null
}

function humanizeIdentifier(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

const EFFORT_DESCRIPTIONS: Readonly<Record<string, string>> = {
  high: 'Deep reasoning',
  low: 'Minimal thinking, fastest response',
  max: 'Maximum effort',
  medium: 'Moderate thinking',
  xhigh: 'Deeper reasoning',
}
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'].map((id) => ({
  description: EFFORT_DESCRIPTIONS[id] ?? id,
  id,
  label: humanizeIdentifier(id),
}))

function staticModel(
  id: string,
  label: string,
  defaultReasoningEffort: string,
  isDefault = false,
): ProviderModelCapability {
  return {
    aliases: [],
    defaultReasoningEffort,
    defaultServiceTier: null,
    description: '',
    id,
    isDefault,
    label,
    reasoningEfforts: EFFORTS,
    serviceTiers: [],
  }
}

function staticProvider(
  provider: ManagedSessionMode,
  models: readonly ProviderModelCapability[],
): ProviderCapabilities {
  return {
    defaultModelId: models.find((model) => model.isDefault)?.id ?? null,
    error: null,
    models,
    provider,
    version: null,
  }
}

/**
 * The models the composer offers. pitwall's daemon runs the chats, and its web protocol has no model list yet.
 * @remarks shortcut: a fixed list goes stale when a provider ships a model; read the list from pitwall once it has a command for it.
 */
export const PROVIDER_CAPABILITIES: ProviderCapabilitiesSnapshot = {
  providers: {
    claude: staticProvider('claude', [
      staticModel('claude-opus-5-5', 'Claude Opus 5.5', 'high', true),
      staticModel('claude-sonnet-5-5', 'Claude Sonnet 5.5', 'high'),
      staticModel('claude-fable-5-1', 'Claude Fable 5.1', 'high'),
    ]),
    codex: staticProvider('codex', [
      staticModel('gpt-6.1-sol', 'GPT-6.1 Sol', 'medium', true),
      staticModel('gpt-6-luna', 'GPT-6 Luna', 'medium'),
      staticModel('gpt-6-astra', 'GPT-6 Astra', 'medium'),
    ]),
  },
}

function selectDefaultModel(
  capabilities: ProviderCapabilities,
): ProviderModelCapability | null {
  return (
    capabilities.models.find(
      (model) => model.id === capabilities.defaultModelId,
    ) ??
    capabilities.models.find((model) => model.isDefault) ??
    capabilities.models[0] ??
    null
  )
}

function findModel(
  capabilities: ProviderCapabilities,
  modelId: string,
): { alias: ProviderModelAlias | null; model: ProviderModelCapability } | null {
  const direct = capabilities.models.find((model) => model.id === modelId)

  if (direct) {
    return { alias: null, model: direct }
  }

  for (const model of capabilities.models) {
    const alias = model.aliases.find((entry) => entry.id === modelId)
    if (alias) {
      return { alias, model }
    }
  }

  return null
}

export function resolveProviderSelection(
  capabilities: ProviderCapabilities,
  selection: ProviderSelectionInput,
): ProviderSelectionResolution {
  const requestedModelId = selection.modelId?.trim() || null
  const requested = requestedModelId
    ? findModel(capabilities, requestedModelId)
    : null
  const selected = requested?.model ?? selectDefaultModel(capabilities)

  if (!selected) {
    return {
      effort: null,
      explanation:
        capabilities.error ??
        `No ${capabilities.provider === 'claude' ? 'Claude' : 'Codex'} models are available.`,
      modelId: null,
      serviceTier: null,
    }
  }

  let explanation = requested?.alias?.explanation ?? null

  if (requestedModelId && !requested) {
    explanation = `The saved model “${requestedModelId}” is not supported by this ${capabilities.provider === 'claude' ? 'Claude' : 'Codex'} installation. Using ${selected.label} instead.`
  }

  const requestedEffort = selection.effort?.trim() || null
  const effort =
    requestedEffort &&
    selected.reasoningEfforts.some(
      (candidate) => candidate.id === requestedEffort,
    )
      ? requestedEffort
      : selected.defaultReasoningEffort

  if (requestedEffort && requestedEffort !== effort && !explanation) {
    explanation = effort
      ? `The saved reasoning level “${requestedEffort}” is not supported by ${selected.label}. Using ${humanizeIdentifier(effort)} instead.`
      : `${selected.label} does not support reasoning levels. Using the provider default instead.`
  }

  const requestedServiceTier = selection.serviceTier?.trim() || null
  const serviceTier = selected.serviceTiers.some(
    (candidate) => candidate.id === requestedServiceTier,
  )
    ? requestedServiceTier
    : selection.serviceTier === null
      ? null
      : selected.defaultServiceTier

  if (
    requestedServiceTier &&
    requestedServiceTier !== serviceTier &&
    !explanation
  ) {
    explanation = `The saved service tier “${requestedServiceTier}” is not supported by ${selected.label}. Using the provider default instead.`
  }

  return {
    effort,
    explanation,
    modelId: selected.id,
    serviceTier,
  }
}

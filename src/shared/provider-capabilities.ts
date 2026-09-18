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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function readNonEmptyString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const candidate = value[key]

  return typeof candidate === 'string' && candidate.trim().length > 0
    ? candidate.trim()
    : null
}

function readString(
  value: Record<string, unknown>,
  key: string,
): string | null {
  const candidate = value[key]
  return typeof candidate === 'string' ? candidate.trim() : null
}

function humanizeIdentifier(value: string): string {
  return value
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ')
}

const CLAUDE_MODEL_ID =
  /^claude-([a-z]+)-(\d+)(?:-(\d+))?(?:-\d{8})?(\[1m\])?$/i
const LEGACY_FABLE_MODEL_ID = /^claude-fable-5(\[1m\])?$/

function normalizeLegacyFableModel(entry: {
  readonly description: string
  readonly id: string
  readonly resolvedModel: string | null
}) {
  const idMatch = LEGACY_FABLE_MODEL_ID.exec(entry.id)

  if (!idMatch || entry.resolvedModel !== 'claude-fable-5') {
    return { ...entry, aliases: [] as string[] }
  }

  return {
    aliases: [entry.id, entry.resolvedModel],
    description: entry.description.replace(/^Fable 5(?=\s*·)/, 'Fable 5.1'),
    id: idMatch[1] ? 'claude-fable-5-1[1m]' : 'claude-fable-5-1',
    resolvedModel: 'claude-fable-5-1',
  }
}

export function formatClaudeModelLabel(entry: {
  readonly displayName: string
  readonly resolvedModel?: string | null
  readonly value: string
}): string {
  const match = CLAUDE_MODEL_ID.exec(entry.resolvedModel ?? entry.value)

  if (!match) {
    return entry.displayName
  }

  const [, family = '', major = '', minor, context] = match
  const version = minor ? `${major}.${minor}` : major
  const base = `Claude ${humanizeIdentifier(family)} ${version}${context ? ' · 1M' : ''}`

  return /^default\b/i.test(entry.displayName) ? `${base} (default)` : base
}

function createUnavailableCapabilities(
  provider: ManagedSessionMode,
  error: string,
): ProviderCapabilities {
  return {
    defaultModelId: null,
    error,
    models: [],
    provider,
    version: null,
  }
}

function describeClaudeEffort(id: string): string {
  switch (id) {
    case 'low':
      return 'Minimal thinking, fastest response'
    case 'medium':
      return 'Moderate thinking'
    case 'high':
      return 'Deep reasoning'
    case 'xhigh':
      return 'Deeper reasoning'
    case 'max':
      return 'Maximum effort'
    default:
      return humanizeIdentifier(id)
  }
}

export function normalizeClaudeModelList(value: unknown): ProviderCapabilities {
  if (!Array.isArray(value)) {
    return createUnavailableCapabilities(
      'claude',
      'Claude returned an invalid model capability response.',
    )
  }

  const advertisedModels = value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return []
    }

    const id = readNonEmptyString(entry, 'value')
    const displayName = readNonEmptyString(entry, 'displayName')
    const description = readString(entry, 'description')

    if (!id || !displayName || description === null) {
      return []
    }

    const discoveredModel = normalizeLegacyFableModel({
      description,
      id,
      resolvedModel: readNonEmptyString(entry, 'resolvedModel'),
    })
    const label = formatClaudeModelLabel({
      displayName,
      resolvedModel: discoveredModel.resolvedModel,
      value: discoveredModel.id,
    })

    const reasoningEfforts =
      entry.supportsEffort === true &&
      Array.isArray(entry.supportedEffortLevels)
        ? entry.supportedEffortLevels.flatMap((effort) =>
            typeof effort === 'string' && effort.trim().length > 0
              ? [
                  {
                    description: describeClaudeEffort(effort),
                    id: effort,
                    label: humanizeIdentifier(effort),
                  },
                ]
              : [],
          )
        : []

    return [
      {
        aliases: discoveredModel.aliases,
        description: discoveredModel.description,
        id: discoveredModel.id,
        label,
        reasoningEfforts,
        resolvedModel: discoveredModel.resolvedModel,
      },
    ]
  })
  const directModelIds = new Set(advertisedModels.map((model) => model.id))
  const claimedAliases = new Set(directModelIds)
  const advertisedDefaultIndex = advertisedModels.findIndex(
    (model) => model.id === 'default',
  )
  const defaultIndex = advertisedDefaultIndex < 0 ? 0 : advertisedDefaultIndex
  const models = advertisedModels.map(
    (model, index): ProviderModelCapability => {
      const aliases = [model.resolvedModel, ...model.aliases].flatMap(
        (alias) => {
          if (!alias || claimedAliases.has(alias)) {
            return []
          }

          claimedAliases.add(alias)
          return [alias]
        },
      )

      return {
        aliases: aliases.map((alias) => ({
          explanation: `The saved model “${alias}” is available as ${model.label}.`,
          id: alias,
        })),
        defaultReasoningEffort:
          model.reasoningEfforts.find((effort) => effort.id === 'high')?.id ??
          model.reasoningEfforts[0]?.id ??
          null,
        defaultServiceTier: null,
        description: model.description,
        id: model.id,
        isDefault: index === defaultIndex,
        label: model.label,
        reasoningEfforts: model.reasoningEfforts,
        serviceTiers: [],
      }
    },
  )

  return {
    defaultModelId: models[defaultIndex]?.id ?? null,
    error:
      models.length === 0
        ? 'Claude did not advertise any selectable models.'
        : null,
    models,
    provider: 'claude',
    version: null,
  }
}

function normalizeReasoningEfforts(
  value: unknown,
): readonly ProviderReasoningEffort[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return []
    }

    const id = readNonEmptyString(entry, 'reasoningEffort')
    const description = readString(entry, 'description')

    if (!id || !description) {
      return []
    }

    return [{ description, id, label: humanizeIdentifier(id) }]
  })
}

function normalizeServiceTiers(value: unknown): readonly ProviderServiceTier[] {
  if (!Array.isArray(value)) {
    return []
  }

  return value.flatMap((entry) => {
    if (!isRecord(entry)) {
      return []
    }

    const id = readNonEmptyString(entry, 'id')
    const label = readNonEmptyString(entry, 'name')
    const description = readString(entry, 'description')

    if (!id || !label || !description) {
      return []
    }

    return [{ description, id, label }]
  })
}

/**
 * Normalizes only the documented `model/list` JSON-RPC response. This is
 * intentionally separate from stream/event parsing so provider prose cannot
 * influence available models or execution options.
 */
export function normalizeCodexModelList(value: unknown): ProviderCapabilities {
  if (!isRecord(value) || !Array.isArray(value.data)) {
    return createUnavailableCapabilities(
      'codex',
      'Codex returned an invalid model capability response.',
    )
  }

  const models = value.data.flatMap((entry) => {
    if (!isRecord(entry) || entry.hidden === true) {
      return []
    }

    const id = readNonEmptyString(entry, 'id')
    const label = readNonEmptyString(entry, 'displayName')
    const description = readString(entry, 'description')
    const defaultReasoningEffort = readNonEmptyString(
      entry,
      'defaultReasoningEffort',
    )

    if (!id || !label || description === null || !defaultReasoningEffort) {
      return []
    }

    const reasoningEfforts = normalizeReasoningEfforts(
      entry.supportedReasoningEfforts,
    )

    if (
      !reasoningEfforts.some((effort) => effort.id === defaultReasoningEffort)
    ) {
      return []
    }

    const serviceTiers = normalizeServiceTiers(entry.serviceTiers)
    const rawDefaultServiceTier = entry.defaultServiceTier
    const defaultServiceTier =
      typeof rawDefaultServiceTier === 'string' &&
      serviceTiers.some((tier) => tier.id === rawDefaultServiceTier)
        ? rawDefaultServiceTier
        : null
    const modelAlias = readNonEmptyString(entry, 'model')

    return [
      {
        aliases:
          modelAlias && modelAlias !== id
            ? [
                {
                  explanation: `${modelAlias} was migrated to ${label}.`,
                  id: modelAlias,
                },
              ]
            : [],
        defaultReasoningEffort,
        defaultServiceTier,
        description,
        id,
        isDefault: entry.isDefault === true,
        label,
        reasoningEfforts,
        serviceTiers,
      } satisfies ProviderModelCapability,
    ]
  })
  const defaultModel = models.find((model) => model.isDefault) ?? models[0]

  return {
    defaultModelId: defaultModel?.id ?? null,
    error:
      models.length === 0
        ? 'Codex did not advertise any selectable models.'
        : null,
    models,
    provider: 'codex',
    version: null,
  }
}

export function unavailableProviderCapabilities(
  provider: ManagedSessionMode,
  error: string,
): ProviderCapabilities {
  return createUnavailableCapabilities(provider, error)
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

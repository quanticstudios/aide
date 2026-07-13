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
  readonly defaultReasoningEffort: string
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

interface ClaudeModelDefinition {
  readonly aliases?: readonly ProviderModelAlias[]
  readonly id: string
  readonly label: string
  readonly maxVersionExclusive?: string
  readonly minVersion: string
}

const CLAUDE_REASONING_EFFORTS: readonly ProviderReasoningEffort[] = [
  { description: 'Fastest response', id: 'low', label: 'Low' },
  { description: 'Balanced response', id: 'medium', label: 'Medium' },
  { description: 'More thorough response', id: 'high', label: 'High' },
  { description: 'Most thorough response', id: 'max', label: 'Max' },
]

const CLAUDE_MODELS: readonly ClaudeModelDefinition[] = [
  {
    aliases: [
      {
        explanation: 'Claude Sonnet 4.6 was renamed to Claude Sonnet 5.',
        id: 'claude-sonnet-4-6',
      },
      {
        explanation: 'Claude Sonnet latest now uses Claude Sonnet 5.',
        id: 'claude-sonnet-latest',
      },
    ],
    id: 'claude-sonnet-5',
    label: 'Claude Sonnet 5',
    minVersion: '2.1.0',
  },
  {
    id: 'claude-fable-5',
    label: 'Claude Fable 5',
    minVersion: '2.1.0',
  },
  {
    id: 'claude-opus-4-8',
    label: 'Claude Opus 4.8',
    minVersion: '2.1.0',
  },
  {
    aliases: [
      {
        explanation: 'Claude Opus 4.6 was replaced by Claude Opus 4.7.',
        id: 'claude-opus-4-6',
      },
    ],
    id: 'claude-opus-4-7',
    label: 'Claude Opus 4.7',
    minVersion: '2.0.0',
  },
  {
    id: 'claude-sonnet-4-6',
    label: 'Claude Sonnet 4.6',
    maxVersionExclusive: '2.1.0',
    minVersion: '0.0.0',
  },
]

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

function parseVersion(
  version: string,
): readonly [number, number, number] | null {
  const match = version.match(/(\d+)\.(\d+)(?:\.(\d+))?/)

  if (!match) {
    return null
  }

  return [
    Number.parseInt(match[1] ?? '', 10),
    Number.parseInt(match[2] ?? '', 10),
    Number.parseInt(match[3] ?? '0', 10),
  ]
}

function isVersionAtLeast(version: string, minimum: string): boolean {
  const parsedVersion = parseVersion(version)
  const parsedMinimum = parseVersion(minimum)

  if (!parsedVersion || !parsedMinimum) {
    return false
  }

  for (let index = 0; index < parsedVersion.length; index += 1) {
    const current = parsedVersion[index] ?? 0
    const required = parsedMinimum[index] ?? 0

    if (current !== required) {
      return current > required
    }
  }

  return true
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

export function buildClaudeProviderCapabilities(
  version: string,
): ProviderCapabilities {
  const models = CLAUDE_MODELS.filter(
    (model) =>
      isVersionAtLeast(version, model.minVersion) &&
      (!model.maxVersionExclusive ||
        !isVersionAtLeast(version, model.maxVersionExclusive)),
  )
    .sort((left, right) => {
      if (left.id === 'claude-sonnet-4-6') {
        return -1
      }
      if (right.id === 'claude-sonnet-4-6') {
        return 1
      }
      return 0
    })
    .map(
      (model, index): ProviderModelCapability => ({
        aliases: model.aliases ?? [],
        defaultReasoningEffort: 'max',
        defaultServiceTier: null,
        description: '',
        id: model.id,
        isDefault: index === 0,
        label: model.label,
        reasoningEfforts: CLAUDE_REASONING_EFFORTS,
        serviceTiers: [],
      }),
    )

  return {
    defaultModelId: models.find((model) => model.isDefault)?.id ?? null,
    error:
      models.length === 0
        ? `Claude Code ${version} is too old to provide a supported model.`
        : null,
    models,
    provider: 'claude',
    version,
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
    explanation = `The saved reasoning level “${requestedEffort}” is not supported by ${selected.label}. Using ${humanizeIdentifier(effort)} instead.`
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

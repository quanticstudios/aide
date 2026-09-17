export interface ManagedModelUsage {
  model: string | null
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number | null
  cacheCreationInputTokens: number | null
  estimatedCostUsd: number | null
}

export interface ManagedUsageReport {
  id: string
  scopeId: string
  provider: 'claude' | 'codex' | 'jev'
  runtimeGeneration: number
  turnId: string | null
  createdAt: string
  models: ManagedModelUsage[]
  estimatedCostUsd: number | null
}

export interface ManagedUsageSummary {
  inputTokens: number
  outputTokens: number
  cachedInputTokens: number | null
  cacheCreationInputTokens: number | null
  estimatedCostUsd: number
  isCostComplete: boolean
  models: Array<
    ManagedModelUsage & { provider: ManagedUsageReport['provider'] }
  >
}

function maximumKnown(
  left: number | null,
  right: number | null,
): number | null {
  if (left === null) return right
  if (right === null) return left
  return Math.max(left, right)
}

function sumKnown(left: number | null, right: number | null): number | null {
  return left === null || right === null ? null : left + right
}

/** Aggregates cumulative query reports without counting repeated totals twice. */
export function summarizeManagedUsage(
  reports: readonly ManagedUsageReport[],
): ManagedUsageSummary {
  const scopes = new Map<
    string,
    {
      provider: ManagedUsageReport['provider']
      estimatedCostUsd: number | null
      models: Map<string | null, ManagedModelUsage>
    }
  >()
  for (const report of reports) {
    const key = JSON.stringify([
      report.provider,
      report.runtimeGeneration,
      report.scopeId,
    ])
    const scope = scopes.get(key) ?? {
      provider: report.provider,
      estimatedCostUsd: null,
      models: new Map<string | null, ManagedModelUsage>(),
    }
    scope.estimatedCostUsd = maximumKnown(
      scope.estimatedCostUsd,
      report.estimatedCostUsd,
    )
    for (const usage of report.models) {
      const previous = scope.models.get(usage.model)
      scope.models.set(
        usage.model,
        previous
          ? {
              model: usage.model,
              inputTokens: Math.max(previous.inputTokens, usage.inputTokens),
              outputTokens: Math.max(previous.outputTokens, usage.outputTokens),
              cachedInputTokens: maximumKnown(
                previous.cachedInputTokens,
                usage.cachedInputTokens,
              ),
              cacheCreationInputTokens: maximumKnown(
                previous.cacheCreationInputTokens,
                usage.cacheCreationInputTokens,
              ),
              estimatedCostUsd: maximumKnown(
                previous.estimatedCostUsd,
                usage.estimatedCostUsd,
              ),
            }
          : { ...usage },
      )
    }
    scopes.set(key, scope)
  }
  const models = new Map<string, ManagedUsageSummary['models'][number]>()
  let estimatedCostUsd = 0
  let isCostComplete = scopes.size > 0
  for (const scope of scopes.values()) {
    if (scope.estimatedCostUsd === null) isCostComplete = false
    else estimatedCostUsd += scope.estimatedCostUsd
    for (const usage of scope.models.values()) {
      const key = JSON.stringify([scope.provider, usage.model])
      const previous = models.get(key)
      models.set(
        key,
        previous
          ? {
              model: usage.model,
              provider: scope.provider,
              inputTokens: previous.inputTokens + usage.inputTokens,
              outputTokens: previous.outputTokens + usage.outputTokens,
              cachedInputTokens: sumKnown(
                previous.cachedInputTokens,
                usage.cachedInputTokens,
              ),
              cacheCreationInputTokens: sumKnown(
                previous.cacheCreationInputTokens,
                usage.cacheCreationInputTokens,
              ),
              estimatedCostUsd: sumKnown(
                previous.estimatedCostUsd,
                usage.estimatedCostUsd,
              ),
            }
          : { ...usage, provider: scope.provider },
      )
    }
  }
  const rows = [...models.values()]
  return {
    inputTokens: rows.reduce((sum, usage) => sum + usage.inputTokens, 0),
    outputTokens: rows.reduce((sum, usage) => sum + usage.outputTokens, 0),
    cachedInputTokens: rows.reduce<number | null>(
      (sum, usage) => sumKnown(sum, usage.cachedInputTokens),
      0,
    ),
    cacheCreationInputTokens: rows.reduce<number | null>(
      (sum, usage) => sumKnown(sum, usage.cacheCreationInputTokens),
      0,
    ),
    estimatedCostUsd,
    isCostComplete,
    models: rows,
  }
}

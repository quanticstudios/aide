import { Tooltip } from '@heroui/react'

import type { ManagedSessionUsage } from '../../../shared/managed-session'
import type { ManagedUsageSummary } from '../../../shared/managed-usage'

interface ContextWindowMeterProps {
  readonly usage?: ManagedSessionUsage
  readonly summary?: ManagedUsageSummary
}

const UNIT_THRESHOLDS = [
  { label: 'M', value: 1_000_000 },
  { label: 'K', value: 1_000 },
] as const

function formatTokens(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '—'
  }

  for (const { label, value: threshold } of UNIT_THRESHOLDS) {
    if (value >= threshold) {
      const scaled = value / threshold
      return `${scaled < 10 ? scaled.toFixed(1).replace(/\.0$/, '') : Math.round(scaled)}${label}`
    }
  }

  return value.toString()
}

function formatPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null
  }

  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, '')}%`
  }

  return `${Math.round(value)}%`
}

export default function ContextWindowMeter({
  usage,
  summary,
}: ContextWindowMeterProps) {
  const contextTokens = usage?.contextTokens
  const total =
    contextTokens ??
    (summary
      ? summary.inputTokens +
        summary.outputTokens +
        (summary.cachedInputTokens ?? 0) +
        (summary.cacheCreationInputTokens ?? 0)
      : (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0))
  const percentage =
    contextTokens !== undefined && usage?.maxTokens && usage.maxTokens > 0
      ? (contextTokens / usage.maxTokens) * 100
      : null

  const percentageLabel = formatPercentage(percentage)
  const usedLabel = formatTokens(total)
  const maxLabel = usage?.maxTokens ? formatTokens(usage.maxTokens) : null
  const ariaLabel =
    contextTokens !== undefined && usage?.maxTokens
      ? `${usedLabel} / ${maxLabel} context used${
          percentageLabel ? ` (${percentageLabel})` : ''
        }`
      : `${usedLabel} tokens reported`

  const isWarn = percentage !== null && percentage >= 80
  const chipClass = isWarn
    ? 'bg-accent-yellow-soft text-accent-yellow'
    : 'bg-surface-elevated text-foreground'

  const headline =
    percentageLabel && maxLabel
      ? `${percentageLabel} · ${usedLabel}/${maxLabel} context used`
      : `${usedLabel} tokens reported`

  return (
    <Tooltip delay={300}>
      <Tooltip.Trigger>
        <span
          aria-label={ariaLabel}
          className={`inline-flex items-center justify-center rounded-xs px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${chipClass}`}
        >
          {percentageLabel ?? usedLabel}
        </span>
      </Tooltip.Trigger>
      <Tooltip.Content
        className="rounded-lg floating-surface px-3 py-2"
        placement="top"
      >
        <p className="eyebrow">
          {contextTokens === undefined ? 'Usage' : 'Context window'}
        </p>
        <p className="display mt-1 text-sm text-foreground">{headline}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {contextTokens === undefined
            ? 'The provider has not reported current context occupancy.'
            : 'Latest provider request; accumulated usage is counted separately.'}
        </p>
        {summary ? (
          <p className="mt-1 text-xs text-muted-foreground">
            ${summary.estimatedCostUsd.toFixed(4)}{' '}
            {summary.isCostComplete
              ? 'estimated cost'
              : 'known estimate; some costs unavailable'}
            . Provider estimates are not a bill.
          </p>
        ) : null}
      </Tooltip.Content>
    </Tooltip>
  )
}

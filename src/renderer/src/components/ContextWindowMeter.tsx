import { Tooltip } from '@heroui/react'

import type { ManagedSessionUsage } from '../../../shared/managed-session'

interface ContextWindowMeterProps {
  readonly usage: ManagedSessionUsage
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

export default function ContextWindowMeter({ usage }: ContextWindowMeterProps) {
  const total = usage.inputTokens + usage.outputTokens
  const percentage =
    usage.maxTokens && usage.maxTokens > 0
      ? (total / usage.maxTokens) * 100
      : null

  const percentageLabel = formatPercentage(percentage)
  const usedLabel = formatTokens(total)
  const maxLabel = usage.maxTokens ? formatTokens(usage.maxTokens) : null
  const ariaLabel = usage.maxTokens
    ? `${usedLabel} / ${maxLabel} context used${
        percentageLabel ? ` (${percentageLabel})` : ''
      }`
    : `${usedLabel} tokens used`

  const isWarn = percentage !== null && percentage >= 80
  const chipClass = isWarn
    ? 'bg-accent-yellow-soft text-accent-yellow'
    : 'bg-surface-elevated text-foreground'

  const headline =
    percentageLabel && maxLabel
      ? `${percentageLabel} · ${usedLabel}/${maxLabel} context used`
      : `${usedLabel} tokens used`

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
        className="rounded-md border border-border bg-surface-elevated px-3 py-2 shadow-[0_20px_60px_rgba(0,0,0,0.4)]"
        placement="top"
      >
        <p className="eyebrow">Context Window</p>
        <p className="display mt-1 text-sm text-foreground">{headline}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Automatically compacts its context when needed.
        </p>
      </Tooltip.Content>
    </Tooltip>
  )
}

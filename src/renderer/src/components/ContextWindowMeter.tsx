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

  const label = formatPercentage(percentage)

  const title = usage.maxTokens
    ? `${formatTokens(total)} / ${formatTokens(usage.maxTokens)} context used${label ? ` (${label})` : ''}`
    : `${formatTokens(total)} tokens used`

  return (
    <span
      aria-label={title}
      className="inline-flex items-center justify-center rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-primary"
      title={title}
    >
      {label ?? formatTokens(total)}
    </span>
  )
}

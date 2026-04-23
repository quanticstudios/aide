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

  const normalized = Math.max(0, Math.min(100, percentage ?? 0))
  const radius = 9.75
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference - (normalized / 100) * circumference
  const label = formatPercentage(percentage)

  const title = usage.maxTokens
    ? `${formatTokens(total)} / ${formatTokens(usage.maxTokens)} context used${label ? ` (${label})` : ''}`
    : `${formatTokens(total)} tokens used`

  return (
    <span
      aria-label={title}
      className="relative inline-flex h-6 w-6 items-center justify-center"
      title={title}
    >
      <svg
        aria-hidden="true"
        className="absolute inset-0 h-full w-full -rotate-90 transform-gpu"
        viewBox="0 0 24 24"
      >
        <circle
          cx="12"
          cy="12"
          fill="none"
          r={radius}
          stroke="color-mix(in oklab, var(--color-muted) 70%, transparent)"
          strokeWidth="3"
        />
        <circle
          className="transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
          cx="12"
          cy="12"
          fill="none"
          r={radius}
          stroke="var(--color-muted-foreground)"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          strokeLinecap="round"
          strokeWidth="3"
        />
      </svg>
      <span className="relative flex h-[15px] min-w-[15px] items-center justify-center rounded-full bg-background px-0.5 text-[8px] font-medium text-muted-foreground">
        {label ?? formatTokens(total)}
      </span>
    </span>
  )
}

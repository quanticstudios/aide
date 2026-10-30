import type { SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk'

import type { ManagedSessionUsageLimit } from '../shared/managed-session'

const CLAUDE_LIMIT_LABELS: Record<string, string> = {
  five_hour: '5-hour limit',
  overage: 'Extra usage limit',
  seven_day: 'Weekly limit',
  seven_day_opus: 'Weekly Opus limit',
  seven_day_overage_included: 'Weekly limit',
  seven_day_sonnet: 'Weekly Sonnet limit',
}

/** The window shape of a Codex `RateLimitSnapshot` (app-server v2). */
interface CodexRateLimitWindow {
  usedPercent?: number
  windowDurationMins?: number | null
  resetsAt?: number | null
}

/** The fields of a Codex `RateLimitSnapshot` the banner needs. */
export interface CodexRateLimitSnapshot {
  limitId?: string | null
  primary?: CodexRateLimitWindow | null
  secondary?: CodexRateLimitWindow | null
  rateLimitReachedType?: string | null
}

function fromUnixSeconds(seconds: number | null | undefined): string | null {
  return typeof seconds === 'number' && Number.isFinite(seconds)
    ? new Date(seconds * 1000).toISOString()
    : null
}

/** Maps a Claude `rate_limit_event` to the reached limit, or null when usage is allowed. */
export function mapClaudeRateLimit(
  info: SDKRateLimitInfo,
): ManagedSessionUsageLimit | null {
  if (info.status !== 'rejected') return null
  const limitId = info.rateLimitType ?? 'usage'
  return {
    label: CLAUDE_LIMIT_LABELS[limitId] ?? 'Usage limit',
    limitId,
    provider: 'claude',
    resetsAt: fromUnixSeconds(info.resetsAt),
  }
}

function windowLabel(minutes: number | null | undefined): string {
  if (!minutes) return 'Usage limit'
  if (minutes === 7 * 24 * 60) return 'Weekly limit'
  if (minutes % 60 === 0) return `${minutes / 60}-hour limit`
  return `${minutes}-minute limit`
}

/**
 * Maps a Codex `account/rateLimits/read` or `account/rateLimits/updated` snapshot to the reached limit.
 * @param reached - true when a turn already failed with `usageLimitExceeded`, so a window under 100% still counts.
 */
export function mapCodexRateLimits(
  snapshot: CodexRateLimitSnapshot | null | undefined,
  reached = false,
): ManagedSessionUsageLimit | null {
  const windows = [snapshot?.primary, snapshot?.secondary].filter(
    (window): window is CodexRateLimitWindow => Boolean(window),
  )
  const full = windows.filter((window) => (window.usedPercent ?? 0) >= 100)
  if (full.length === 0 && !snapshot?.rateLimitReachedType && !reached) {
    return null
  }
  // why: usage resumes only once every full window resets, so the latest reset is the one to wait for.
  const blocking = (full.length > 0 ? full : windows).reduce<
    CodexRateLimitWindow | undefined
  >(
    (latest, window) =>
      !latest || (window.resetsAt ?? 0) > (latest.resetsAt ?? 0)
        ? window
        : latest,
    undefined,
  )
  return {
    label: windowLabel(blocking?.windowDurationMins),
    limitId: snapshot?.limitId ?? 'codex',
    provider: 'codex',
    resetsAt: fromUnixSeconds(blocking?.resetsAt),
  }
}

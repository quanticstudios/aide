/** One window of a plan limit, as pitwall's `readUsage` sends it (docs/web-protocol.md). */
export interface PlanWindow {
  readonly minutes: number
  /** Percent as reported; a window whose `resets` has passed is unused now. */
  readonly used: number
  readonly resets?: string
}

export interface PlanLimit {
  readonly provider: string
  readonly profile: string
  readonly profileLabel: string
  readonly name: string
  readonly seen: string
  readonly windows: readonly PlanWindow[]
}

/** What `readUsage` answers. Costs are at the API's list prices of `pricesAsOf`. */
export interface PlanUsage {
  readonly showCost: boolean
  readonly pricesAsOf: string
  readonly limits: readonly PlanLimit[]
  readonly days: readonly {
    readonly date: string
    readonly tokens: number
    readonly cost: number
  }[]
  readonly sessions: readonly {
    readonly provider: string
    readonly sessionId: string
    readonly last: string
    readonly tokens: number
    readonly cost: number
  }[]
  readonly total: {
    readonly sessions: number
    readonly tokens: number
    readonly cost: number
    readonly unpriced: number
  }
}

const AGENT_NAMES: Record<string, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
  opencode: 'OpenCode',
  pi: 'pi',
}

export function agentName(provider: string): string {
  return AGENT_NAMES[provider] ?? provider
}

/** pitwall's limitTitle: "Claude Code", "Codex · Work GPT-Spark". */
export function limitTitle(limit: PlanLimit): string {
  if (limit.provider === 'claude' && !limit.profile) return 'Claude Code'
  let name = agentName(limit.provider)
  if (limit.profile) name += ` · ${limit.profileLabel || limit.profile}`
  return limit.name ? `${name} ${limit.name}` : name
}

/** "5-hour window", "Weekly window", as pitwall names them. */
export function windowTitle(minutes: number): string {
  const day = 24 * 60
  let name = `${minutes}-minute`
  if (minutes === 7 * day) name = 'weekly'
  else if (minutes === day) name = 'daily'
  else if (minutes > 0 && minutes % day === 0) name = `${minutes / day}-day`
  else if (minutes > 0 && minutes % 60 === 0) name = `${minutes / 60}-hour`
  return `${name[0]?.toUpperCase()}${name.slice(1)} window`
}

/** The window's use now: 0 once its reset has passed. */
export function usedNow(window: PlanWindow, now: number): number {
  return window.resets && Date.parse(window.resets) <= now ? 0 : window.used
}

/** pitwall's sidebar.Span: "<1m", "42m", "2h 14m", "3d 4h". */
export function formatSpan(milliseconds: number): string {
  const m = Math.floor(milliseconds / 60_000)
  if (m < 1) return '<1m'
  if (m < 60) return `${m}m`
  if (m < 24 * 60) return `${Math.floor(m / 60)}h ${m % 60}m`
  return `${Math.floor(m / (24 * 60))}d ${Math.floor((m % (24 * 60)) / 60)}h`
}

/** When the window resets, as pitwall's Settings, Usage says it. */
export function resetNote(window: PlanWindow, now: number): string {
  if (!window.resets) return 'Its reset time is unknown.'
  const resets = Date.parse(window.resets)
  const clock = new Date(resets).toLocaleString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    month: 'short',
    day: 'numeric',
  })
  if (resets <= now) return `Reset at ${clock}; no report since.`
  return `Resets in ${formatSpan(resets - now)}, at ${clock}`
}

/** pitwall's compact, three figures: "950", "1.65M", "35.8K", "1M". */
export function formatTokens(n: number): string {
  if (n < 1000) return String(n)
  let v = n
  for (const unit of ['K', 'M', 'B', 'T']) {
    v /= 1000
    let digits = 0
    if (v < 9.995) digits = 2
    else if (v < 99.95) digits = 1
    else if (v >= 999.5 && unit !== 'T') continue
    const fixed = v.toFixed(digits)
    return `${digits ? fixed.replace(/\.?0+$/, '') : fixed}${unit}`
  }
  return String(n)
}

/** pitwall's money: "$1,234.50". */
export function formatCost(cost: number): string {
  const [whole = '0', cents = '00'] = cost.toFixed(2).split('.')
  return `$${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${cents}`
}

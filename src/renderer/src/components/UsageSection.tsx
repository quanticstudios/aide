import { useEffect, useState, useSyncExternalStore } from 'react'

import {
  type DaemonTransport,
  isDaemonTransport,
} from '../lib/daemon-transport'
import {
  agentName,
  formatCost,
  formatTokens,
  limitTitle,
  type PlanLimit,
  type PlanUsage,
  resetNote,
  usedNow,
  windowTitle,
} from '../lib/plan-usage'
import { formatRelativeTime } from '../lib/relative-time'
import { getSessionTransport } from '../lib/session-transport'

const DAYS = 30

/** Settings > Usage: pitwall's plan limits, daily tokens and top sessions. Lazy-loaded with its chart. */
export default function UsageSection() {
  const transport = getSessionTransport()
  if (!isDaemonTransport(transport)) {
    return (
      <Note>
        Usage comes from pitwall. Turn on "Run sessions on the pitwall daemon"
        under General to see it.
      </Note>
    )
  }
  return <DaemonUsage transport={transport} />
}

function DaemonUsage({ transport }: { readonly transport: DaemonTransport }) {
  const connection = useSyncExternalStore(
    transport.subscribeConnection,
    transport.getConnection,
  )
  const isConnected = connection.status === 'connected'
  const [result, setResult] = useState<
    { usage: PlanUsage } | { error: string } | null
  >(null)

  useEffect(() => {
    if (!isConnected) return
    let isLive = true
    transport.readUsage(DAYS).then(
      (usage) => isLive && setResult({ usage }),
      (error: Error) => isLive && setResult({ error: error.message }),
    )
    return () => {
      isLive = false
    }
  }, [isConnected, transport])

  if (!result) {
    return (
      <Note>
        {isConnected
          ? "Reading the agents' session files…"
          : 'Waiting for pitwall…'}
      </Note>
    )
  }
  if ('error' in result) return <Note>{result.error}</Note>
  const { usage } = result
  const now = Date.now()
  return (
    <div className="mt-4 flex flex-col gap-4">
      <div className="divide-y divide-border rounded-lg border border-border bg-surface-2">
        {usage.limits.length === 0 ? (
          <p className="px-4 py-3 text-[13px] text-muted-foreground">
            No agent has reported a plan limit yet. Claude Code reports its
            limits through pitwall statusline; Codex logs them in its session
            files.
          </p>
        ) : (
          usage.limits.map((limit) => (
            <LimitRow
              key={`${limit.profile}\0${limit.provider}\0${limit.name}`}
              limit={limit}
              now={now}
            />
          ))
        )}
      </div>
      <DailyChart usage={usage} />
      <TopSessions usage={usage} />
    </div>
  )
}

function Note({ children }: { readonly children: React.ReactNode }) {
  return (
    <p className="mt-4 rounded-lg border border-border bg-surface-2 px-4 py-3 text-[13px] text-muted-foreground">
      {children}
    </p>
  )
}

function LimitRow({
  limit,
  now,
}: {
  readonly limit: PlanLimit
  readonly now: number
}) {
  const title = limitTitle(limit)
  return (
    <div className="px-4 py-3" data-testid="usage-limit">
      <p className="text-[13px] font-medium leading-5">{title}</p>
      <p className="text-[12px] leading-4 text-muted-foreground">
        As of {formatRelativeTime(limit.seen, now)}
      </p>
      {limit.windows.map((window) => {
        const used = usedNow(window, now)
        const name = windowTitle(window.minutes)
        // pitwall's sidebar.LimitColor: yellow from 80%, red from 95%.
        const fill =
          used >= 95
            ? 'bg-accent-red'
            : used >= 80
              ? 'bg-accent-yellow'
              : 'bg-primary'
        return (
          <div className="mt-3" key={window.minutes}>
            <div className="flex items-baseline justify-between gap-4 text-[13px]">
              <span>{name}</span>
              <span className="font-medium tabular-nums">
                {used.toFixed(0)}%
              </span>
            </div>
            <div
              aria-label={`${title}, ${name}`}
              aria-valuemax={100}
              aria-valuemin={0}
              aria-valuenow={Math.round(used)}
              className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-4"
              role="meter"
            >
              <div
                className={`h-full rounded-full ${fill}`}
                style={{ width: `${Math.min(used, 100)}%` }}
              />
            </div>
            <p className="mt-1.5 text-[12px] leading-4 text-muted-foreground">
              {resetNote(window, now)}
            </p>
          </div>
        )
      })}
    </div>
  )
}

function dayLabel(date: string): string {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
  })
}

function DailyChart({ usage }: { readonly usage: PlanUsage }) {
  const [hovered, setHovered] = useState<number | null>(null)
  const max = Math.max(1, ...usage.days.map((day) => day.tokens))
  const describe = (day: PlanUsage['days'][number]) =>
    `${dayLabel(day.date)}: ${formatTokens(day.tokens)} tokens${
      usage.showCost ? ` · ${formatCost(day.cost)}` : ''
    }`
  const focused = hovered === null ? null : usage.days[hovered]
  const first = usage.days[0]
  const last = usage.days.at(-1)

  return (
    <div className="rounded-lg border border-border bg-surface-2 px-4 py-3">
      <p className="text-[13px] font-medium leading-5">
        Daily tokens, last {usage.days.length} days
      </p>
      <p
        className="text-[12px] leading-4 text-muted-foreground"
        data-testid="usage-total"
      >
        {formatTokens(usage.total.tokens)} tokens in{' '}
        {usage.total.sessions === 1
          ? '1 session'
          : `${usage.total.sessions} sessions`}
        {usage.showCost
          ? ` · ${formatCost(usage.total.cost)} estimated at the API's list prices of ${usage.pricesAsOf}. A subscription bills differently.`
          : ''}
      </p>
      <p
        aria-live="polite"
        className="mt-3 h-4 text-[12px] leading-4 tabular-nums"
      >
        {focused ? describe(focused) : ''}
      </p>
      <div className="mt-1 flex gap-2">
        <div className="flex h-32 flex-col justify-between text-right text-[11px] leading-none text-muted-foreground tabular-nums">
          <span>{formatTokens(max)}</span>
          <span>0</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col">
          <div
            aria-label={`Daily tokens, last ${usage.days.length} days`}
            className="flex h-32 items-end gap-[2px] border-b border-border"
            role="group"
          >
            {usage.days.map((day, index) => (
              <div
                aria-label={describe(day)}
                className="flex h-full min-w-0 flex-1 cursor-default items-end rounded-t-[4px] hover:bg-surface-3"
                data-testid="usage-day"
                key={day.date}
                onMouseEnter={() => setHovered(index)}
                onMouseLeave={() => setHovered(null)}
                role="img"
              >
                <div
                  className="w-full rounded-t-[4px] bg-primary"
                  style={{ height: `${(day.tokens / max) * 100}%` }}
                />
              </div>
            ))}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-muted-foreground">
            <span>{first ? dayLabel(first.date) : ''}</span>
            <span>{last ? dayLabel(last.date) : ''}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function TopSessions({ usage }: { readonly usage: PlanUsage }) {
  if (usage.sessions.length === 0) return null
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface-2">
      <table className="w-full text-left text-[13px]">
        <caption className="px-4 pt-3 text-left text-[13px] font-medium">
          Top sessions
        </caption>
        <thead className="text-[12px] text-muted-foreground">
          <tr>
            <th className="px-4 py-2 font-normal">Agent</th>
            <th className="px-4 py-2 font-normal">Session</th>
            <th className="px-4 py-2 font-normal">Last call</th>
            <th className="px-4 py-2 text-right font-normal">Tokens</th>
            {usage.showCost ? (
              <th className="px-4 py-2 text-right font-normal">Est. cost</th>
            ) : null}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {usage.sessions.map((session) => (
            <tr
              data-testid="usage-session"
              key={`${session.provider}\0${session.sessionId}`}
            >
              <td className="px-4 py-2">{agentName(session.provider)}</td>
              <td
                className="px-4 py-2 font-mono text-[12px]"
                title={session.sessionId}
              >
                {session.sessionId.slice(0, 8)}
              </td>
              <td className="px-4 py-2 text-muted-foreground">
                {formatRelativeTime(session.last)}
              </td>
              <td className="px-4 py-2 text-right tabular-nums">
                {formatTokens(session.tokens)}
              </td>
              {usage.showCost ? (
                <td className="px-4 py-2 text-right tabular-nums">
                  {formatCost(session.cost)}
                </td>
              ) : null}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

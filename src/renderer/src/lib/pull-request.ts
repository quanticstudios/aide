import { useEffect, useState, useSyncExternalStore } from 'react'
import {
  type DaemonPullRequest,
  type DaemonReviewThread,
  type DaemonReviewThreads,
  isDaemonTransport,
} from './daemon-transport'
import { getSessionTransport } from './session-transport'

export interface PullRequestState {
  /** The session's pull request from pitwall's poll; null on the built-in backend or with none. */
  readonly pullRequest: DaemonPullRequest | null
  /** Its review threads, read while the pane is active; null until read. */
  readonly review: DaemonReviewThreads | null
  readonly reviewError: string | null
}

const noop = () => () => {}

/** The session's pull request as pitwall polls it, and its review threads while `isActive`, read again when the head or review changes. */
export function usePullRequest(
  sessionId: string,
  isActive: boolean,
): PullRequestState {
  const transport = getSessionTransport()
  const daemon = isDaemonTransport(transport) ? transport : null
  const pullRequest = useSyncExternalStore(
    daemon ? daemon.subscribeSessionList : noop,
    () => daemon?.getPullRequest(sessionId) ?? null,
  )
  const [review, setReview] = useState<{
    error: string | null
    key: string
    value: DaemonReviewThreads | null
  } | null>(null)
  const key = pullRequest
    ? `${pullRequest.number}:${pullRequest.head}:${pullRequest.review}`
    : ''
  const open = pullRequest?.state === 'open'

  useEffect(() => {
    if (!daemon || !isActive || !open || !key) return
    let cancelled = false
    daemon.reviewThreads(sessionId).then(
      (value) => {
        if (!cancelled) setReview({ error: null, key, value })
      },
      (error: unknown) => {
        if (!cancelled)
          setReview({
            error: error instanceof Error ? error.message : String(error),
            key,
            value: null,
          })
      },
    )
    return () => {
      cancelled = true
    }
  }, [daemon, isActive, key, open, sessionId])

  const current = open && review?.key === key ? review : null
  return {
    pullRequest,
    review: current?.value ?? null,
    reviewError: current?.error ?? null,
  }
}

export interface CheckSummary {
  readonly failing: readonly string[]
  readonly passing: number
  readonly pending: number
}

export function summarizeChecks(pullRequest: DaemonPullRequest): CheckSummary {
  return {
    failing: pullRequest.checks
      .filter((check) => check.state === 'fail')
      .map((check) => check.name),
    passing: pullRequest.checks.filter((check) => check.state === 'pass')
      .length,
    pending: pullRequest.checks.filter((check) => check.state === 'pending')
      .length,
  }
}

/** What pitwall can send the agent for this pull request: its failed checks, its review, both or neither. */
export function sendableParts(
  pullRequest: DaemonPullRequest,
  review: DaemonReviewThreads | null,
): { failures: boolean; review: boolean } {
  const open = pullRequest.state === 'open'
  return {
    failures:
      open && pullRequest.checks.some((check) => check.state === 'fail'),
    review:
      open &&
      (pullRequest.review === 'changes' ||
        (review?.threads.length ?? 0) > 0 ||
        (review?.changeRequests.length ?? 0) > 0),
  }
}

/** The threads on `path`, by line; line 0 holds the ones on the whole file. */
export function threadsByLine(
  threads: readonly DaemonReviewThread[],
  path: string,
): Map<number, DaemonReviewThread[]> {
  const out = new Map<number, DaemonReviewThread[]>()
  for (const thread of threads) {
    if (thread.path !== path) continue
    out.set(thread.line, [...(out.get(thread.line) ?? []), thread])
  }
  return out
}

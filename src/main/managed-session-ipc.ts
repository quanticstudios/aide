import { isEqualValue } from '../renderer/src/lib/deep-equal'
import type { ManagedSessionIpcEvent } from '../shared/ipc'
import type {
  ManagedSessionContentItem,
  ManagedSessionSnapshot,
} from '../shared/managed-session'
import {
  SESSION_DELTA_VERSION,
  type SessionDelta,
  type SessionDeltaPatchableKey,
  type SessionDeltaState,
  toSessionDeltaStatus,
} from '../shared/session-delta'

/** One frame at 60 Hz; each session sends at most one IPC message per frame. */
export const MANAGED_SESSION_IPC_FRAME_MS = 16

type DeltaChange = SessionDelta extends infer Delta
  ? Delta extends SessionDelta
    ? Omit<Delta, 'revision' | 'seq' | 'sessionId' | 'updatedAt' | 'version'>
    : never
  : never

const OWN_DELTA_KEYS = new Set<string>([
  'content',
  'detail',
  'lastCompletedAt',
  'lastError',
  'lastErrorAt',
  'pendingApprovals',
  'pendingUserInputs',
  'planApproval',
  'revision',
  'running',
  'sessionId',
  'sessionState',
  'turns',
  'updatedAt',
  'usage',
  'usageReports',
  'usageSummary',
] satisfies (keyof ManagedSessionSnapshot)[])

class NeedsSnapshot extends Error {}

function prefixMatches<T extends { id: string }>(
  previous: readonly T[],
  next: readonly T[],
): boolean {
  return (
    previous.length <= next.length &&
    previous.every((entry, index) => entry.id === next[index].id)
  )
}

function diffItem(
  previous: ManagedSessionContentItem,
  next: ManagedSessionContentItem,
): DeltaChange | null {
  if (isEqualValue(previous, next)) return null
  const changed = [
    ...new Set([...Object.keys(previous), ...Object.keys(next)]),
  ].filter(
    (key) =>
      !isEqualValue(
        previous[key as keyof ManagedSessionContentItem],
        next[key as keyof ManagedSessionContentItem],
      ),
  ) as (keyof ManagedSessionContentItem)[]
  if (changed.some((key) => !Object.hasOwn(next, key)))
    throw new NeedsSnapshot()

  const appended = changed.filter((key) => key !== 'updatedAt')
  if (
    appended.length === 1 &&
    appended[0] === 'text' &&
    next.text.startsWith(previous.text)
  ) {
    return {
      itemId: next.id,
      itemUpdatedAt: next.updatedAt,
      text: next.text.slice(previous.text.length),
      type: 'item.text.append',
    }
  }
  const previousOutput = previous.tool?.output ?? ''
  if (
    appended.length === 1 &&
    appended[0] === 'tool' &&
    previous.tool &&
    next.tool?.output?.startsWith(previousOutput) &&
    isEqualValue({ ...previous.tool, output: next.tool.output }, next.tool)
  ) {
    return {
      itemId: next.id,
      itemUpdatedAt: next.updatedAt,
      text: next.tool.output.slice(previousOutput.length),
      type: 'tool.output.append',
    }
  }
  return {
    itemId: next.id,
    patch: Object.fromEntries(changed.map((key) => [key, next[key]])),
    type: 'item.patch',
  }
}

function diffById<T extends { id: string }>(
  previous: readonly T[],
  next: readonly T[],
  add: (entry: T) => DeltaChange,
  resolve: (id: string) => DeltaChange,
): DeltaChange[] {
  const nextIds = new Set(next.map((entry) => entry.id))
  const kept = previous.filter((entry) => nextIds.has(entry.id))
  const added = next.slice(kept.length)
  if (!isEqualValue([...kept, ...added], next)) throw new NeedsSnapshot()
  return [
    ...previous
      .filter((entry) => !nextIds.has(entry.id))
      .map((entry) => resolve(entry.id)),
    ...added.map(add),
  ]
}

function diffSnapshotFields(
  previous: ManagedSessionSnapshot,
  next: ManagedSessionSnapshot,
): DeltaChange[] {
  if (previous.sessionId !== next.sessionId) throw new NeedsSnapshot()
  if (
    !prefixMatches(previous.content, next.content) ||
    !prefixMatches(previous.turns, next.turns)
  ) {
    throw new NeedsSnapshot()
  }
  const changes: DeltaChange[] = []

  next.content.forEach((item, index) => {
    const previousItem = previous.content[index]
    const change = previousItem
      ? diffItem(previousItem, item)
      : ({ item, type: 'item.add' } as DeltaChange)
    if (change) changes.push(change)
  })
  changes.push(
    ...diffById(
      previous.pendingApprovals,
      next.pendingApprovals,
      (approval) => ({ approval, type: 'approval.add' }),
      (requestId) => ({ requestId, type: 'approval.resolve' }),
    ),
    ...diffById(
      previous.pendingUserInputs,
      next.pendingUserInputs,
      (input) => ({ input, type: 'input.add' }),
      (requestId) => ({ requestId, type: 'input.resolve' }),
    ),
    ...next.turns
      .filter((turn, index) => !isEqualValue(previous.turns[index], turn))
      .map((turn): DeltaChange => ({ turn, type: 'turn' })),
  )

  if (
    previous.sessionState !== next.sessionState ||
    previous.running !== next.running ||
    previous.detail !== next.detail ||
    previous.lastCompletedAt !== next.lastCompletedAt
  ) {
    changes.push({
      detail: next.detail,
      lastCompletedAt: next.lastCompletedAt,
      running: next.running,
      sessionState: next.sessionState,
      status: toSessionDeltaStatus(next.sessionState),
      type: 'status',
    })
  }
  if (!isEqualValue(previous.usage, next.usage)) {
    if (!next.usage) throw new NeedsSnapshot()
    changes.push({ type: 'usage', usage: next.usage })
  }
  if (
    !isEqualValue(previous.usageReports, next.usageReports) ||
    !isEqualValue(previous.usageSummary, next.usageSummary)
  ) {
    if (!next.usageReports || !next.usageSummary) throw new NeedsSnapshot()
    changes.push({
      type: 'usage.reports',
      usageReports: next.usageReports,
      usageSummary: next.usageSummary,
    })
  }
  if (
    previous.lastError !== next.lastError ||
    previous.lastErrorAt !== next.lastErrorAt
  ) {
    changes.push({
      lastError: next.lastError,
      lastErrorAt: next.lastErrorAt,
      type: 'error',
    })
  }

  const set: Record<string, unknown> = {}
  const unset: string[] = []
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (OWN_DELTA_KEYS.has(key)) continue
    const typedKey = key as SessionDeltaPatchableKey
    if (isEqualValue(previous[typedKey], next[typedKey])) continue
    if (Object.hasOwn(next, key)) set[key] = next[typedKey]
    else unset.push(key)
  }
  if (unset.length > 0 || Object.keys(set).length > 0) {
    changes.push({
      set,
      type: 'session.patch',
      ...(unset.length > 0 ? { unset } : {}),
    } as DeltaChange)
  }
  return changes
}

/**
 * Returns the deltas that turn `previous` into `next`, or one `snapshot` delta when the change has no delta form.
 * @remarks Applying the result to `previous` with `applyDelta` yields a snapshot deep-equal to `next`.
 */
export function diffSnapshots(
  previous: SessionDeltaState | null,
  next: ManagedSessionSnapshot,
): SessionDelta[] {
  const firstSeq = (previous?.seq ?? 0) + 1
  let changes: DeltaChange[]
  try {
    if (!previous) throw new NeedsSnapshot()
    changes = diffSnapshotFields(previous.snapshot, next)
  } catch (error) {
    if (!(error instanceof NeedsSnapshot)) throw error
    changes = [{ snapshot: next, type: 'snapshot' }]
  }
  if (
    changes.length === 0 &&
    previous &&
    (previous.snapshot.revision !== next.revision ||
      previous.snapshot.updatedAt !== next.updatedAt)
  ) {
    changes.push({ set: {}, type: 'session.patch' })
  }
  return changes.map(
    (change, index) =>
      ({
        revision: next.revision,
        seq: firstSeq + index,
        sessionId: next.sessionId,
        updatedAt: next.updatedAt,
        version: SESSION_DELTA_VERSION,
        ...change,
      }) as SessionDelta,
  )
}

interface BroadcasterOptions {
  send: (event: ManagedSessionIpcEvent) => void
  setTimer?: (callback: () => void, ms: number) => unknown
  clearTimer?: (timer: unknown) => void
}

/** Coalesces managed-session snapshots into one delta message per session per frame and serves resync snapshots. */
export class ManagedSessionIpcBroadcaster {
  private readonly sent = new Map<string, SessionDeltaState>()
  private readonly pending = new Map<string, ManagedSessionSnapshot>()
  private timer: unknown = null
  private readonly setTimer: NonNullable<BroadcasterOptions['setTimer']>
  private readonly clearTimer: NonNullable<BroadcasterOptions['clearTimer']>

  constructor(private readonly options: BroadcasterOptions) {
    this.setTimer = options.setTimer ?? setTimeout
    this.clearTimer =
      options.clearTimer ??
      ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>))
  }

  update(snapshot: ManagedSessionSnapshot): void {
    this.pending.set(snapshot.sessionId, snapshot)
    this.timer ??= this.setTimer(() => {
      this.timer = null
      this.flush()
    }, MANAGED_SESSION_IPC_FRAME_MS)
  }

  remove(sessionId: string, revision: number): void {
    this.pending.delete(sessionId)
    this.sent.delete(sessionId)
    this.options.send({ revision, sessionId, type: 'removed' })
  }

  /** Returns the session's latest snapshot and seq; the next delta carries seq + 1. */
  sync(sessionId: string): SessionDeltaState | null {
    this.flushSession(sessionId)
    return this.sent.get(sessionId) ?? null
  }

  flush(): void {
    if (this.timer !== null) {
      this.clearTimer(this.timer)
      this.timer = null
    }
    for (const sessionId of [...this.pending.keys()]) {
      this.flushSession(sessionId)
    }
  }

  private flushSession(sessionId: string): void {
    const pending = this.pending.get(sessionId)
    if (!pending) return
    this.pending.delete(sessionId)
    // why: the manager updates turn objects in place, so the kept base needs its own copies.
    const next = {
      ...pending,
      turns: pending.turns.map((turn) => ({ ...turn })),
    }
    const previous = this.sent.get(sessionId) ?? null
    const deltas = diffSnapshots(previous, next)
    if (deltas.length === 0) return
    this.sent.set(sessionId, { seq: deltas.at(-1)?.seq ?? 0, snapshot: next })
    this.options.send({ deltas, sessionId, type: 'deltas' })
  }
}

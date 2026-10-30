import type {
  ManagedSessionContentItem,
  ManagedSessionErrorKind,
  ManagedSessionPendingApproval,
  ManagedSessionPendingUserInput,
  ManagedSessionPlanApproval,
  ManagedSessionSnapshot,
  ManagedSessionTask,
  ManagedSessionToolCall,
  ManagedSessionTurnSummary,
  ManagedSessionUsage,
  ManagedSessionUsageLimit,
} from './managed-session'
import type { ManagedUsageReport, ManagedUsageSummary } from './managed-usage'
import type { ManagedProviderRuntimeSessionState } from './provider-runtime'

/** The delta schema version; bump it on any change an older consumer would misapply. */
export const SESSION_DELTA_VERSION = 1

/** Coarse activity state for clients that do not track `sessionState`. */
export type SessionDeltaStatus =
  | 'working'
  | 'waiting'
  | 'done'
  | 'error'
  | 'interrupted'

/** Snapshot keys that only `session.patch` or a full snapshot may change. */
export type SessionDeltaPatchableKey = Exclude<
  keyof ManagedSessionSnapshot,
  | 'content'
  | 'detail'
  | 'lastCompletedAt'
  | 'lastError'
  | 'lastErrorAt'
  | 'lastErrorKind'
  | 'pendingApprovals'
  | 'pendingUserInputs'
  | 'planApproval'
  | 'revision'
  | 'running'
  | 'sessionId'
  | 'sessionState'
  | 'turns'
  | 'updatedAt'
  | 'usage'
  | 'usageLimit'
  | 'usageReports'
  | 'usageSummary'
>

type PatchableSnapshot = Pick<ManagedSessionSnapshot, SessionDeltaPatchableKey>

type OptionalKeys<T> = {
  [K in keyof T]-?: undefined extends T[K] ? K : never
}[keyof T]

interface SessionDeltaEnvelope {
  version: typeof SESSION_DELTA_VERSION
  sessionId: string
  /** Steps by exactly one per delta within a session. */
  seq: number
  /** The snapshot `revision` once this delta is applied. */
  revision: number
  /** The snapshot `updatedAt` once applied. */
  updatedAt: string
}

/** One change to a managed session, in the order main produced it. */
export type SessionDelta = SessionDeltaEnvelope &
  (
    | { type: 'snapshot'; snapshot: ManagedSessionSnapshot }
    | { type: 'item.add'; item: ManagedSessionContentItem }
    | {
        type: 'item.text.append'
        itemId: string
        text: string
        itemUpdatedAt: string
      }
    | {
        type: 'item.patch'
        itemId: string
        patch: Partial<Omit<ManagedSessionContentItem, 'id'>>
      }
    | {
        type: 'tool.start'
        item: ManagedSessionContentItem & { tool: ManagedSessionToolCall }
      }
    | {
        type: 'tool.output.append'
        itemId: string
        text: string
        itemUpdatedAt: string
      }
    | {
        type: 'tool.end'
        itemId: string
        status: 'completed' | 'failed'
        exitCode?: number
        startedAt: string
        /** Also the item's `updatedAt`. */
        endedAt: string
      }
    | {
        type: 'reasoning.append'
        itemId: string
        text: string
        itemUpdatedAt: string
      }
    | {
        type: 'plan.update'
        itemId: string
        tasks: ManagedSessionTask[]
        itemUpdatedAt: string
      }
    | { type: 'approval.add'; approval: ManagedSessionPendingApproval }
    | { type: 'approval.resolve'; requestId: string }
    | { type: 'input.add'; input: ManagedSessionPendingUserInput }
    | { type: 'input.resolve'; requestId: string }
    | { type: 'turn'; turn: ManagedSessionTurnSummary }
    | {
        type: 'status'
        status: SessionDeltaStatus
        sessionState: ManagedProviderRuntimeSessionState
        running: boolean
        detail: string | null
        lastCompletedAt: string | null
      }
    | { type: 'usage'; usage: ManagedSessionUsage }
    | {
        type: 'usage.reports'
        usageReports: ManagedUsageReport[]
        usageSummary: ManagedUsageSummary
      }
    | { type: 'limit'; limit: ManagedSessionUsageLimit | null }
    | {
        type: 'error'
        lastError: string | null
        lastErrorAt: string | null
        /** Absent when the error has no known fix. */
        lastErrorKind?: ManagedSessionErrorKind
      }
    | {
        type: 'session.patch'
        set: Partial<PatchableSnapshot>
        unset?: OptionalKeys<PatchableSnapshot>[]
      }
  )

/** What a consumer holds between deltas: the last applied seq and the snapshot it produced. */
export interface SessionDeltaState {
  seq: number
  snapshot: ManagedSessionSnapshot
}

/** Thrown when a delta cannot apply cleanly; the consumer should ask for a fresh snapshot. */
export class SessionDeltaResyncError extends Error {
  readonly reason: 'version' | 'no-base' | 'session' | 'seq-gap' | 'item'

  constructor(reason: SessionDeltaResyncError['reason'], message: string) {
    super(message)
    this.name = 'SessionDeltaResyncError'
    this.reason = reason
  }
}

/** Maps a runtime session state to the coarse status a `status` delta carries. */
export function toSessionDeltaStatus(
  sessionState: ManagedProviderRuntimeSessionState,
): SessionDeltaStatus {
  switch (sessionState) {
    case 'connecting':
    case 'running':
      return 'working'
    case 'waiting':
      return 'waiting'
    case 'ready':
      return 'done'
    case 'stopped':
      return 'interrupted'
    case 'error':
      return 'error'
  }
}

/** Applies one delta without mutating `state`, and throws `SessionDeltaResyncError` when it cannot. */
export function applyDelta(
  state: SessionDeltaState | null,
  delta: SessionDelta,
): SessionDeltaState {
  if (delta.version !== SESSION_DELTA_VERSION) {
    throw new SessionDeltaResyncError(
      'version',
      `Unsupported session delta version ${delta.version}.`,
    )
  }
  if (delta.type === 'snapshot') {
    return { seq: delta.seq, snapshot: delta.snapshot }
  }
  if (!state) {
    throw new SessionDeltaResyncError(
      'no-base',
      `Delta ${delta.seq} arrived before any snapshot.`,
    )
  }
  if (delta.sessionId !== state.snapshot.sessionId) {
    throw new SessionDeltaResyncError(
      'session',
      `Delta for ${delta.sessionId} applied to ${state.snapshot.sessionId}.`,
    )
  }
  if (delta.seq !== state.seq + 1) {
    throw new SessionDeltaResyncError(
      'seq-gap',
      `Expected seq ${state.seq + 1}, got ${delta.seq}.`,
    )
  }

  const previous = state.snapshot
  const snapshot: ManagedSessionSnapshot = {
    ...previous,
    revision: delta.revision,
    updatedAt: delta.updatedAt,
  }
  const updateItem = (
    itemId: string,
    update: (item: ManagedSessionContentItem) => ManagedSessionContentItem,
  ): void => {
    const index = previous.content.findIndex((item) => item.id === itemId)
    if (index === -1) {
      throw new SessionDeltaResyncError(
        'item',
        `Delta ${delta.seq} names unknown item ${itemId}.`,
      )
    }
    const next = update(previous.content[index])
    snapshot.content = previous.content.map((item, at) =>
      at === index ? next : item,
    )
  }
  const updateTool = (
    itemId: string,
    updatedAt: string,
    update: (tool: ManagedSessionToolCall) => ManagedSessionToolCall,
  ): void =>
    updateItem(itemId, (item) => {
      if (!item.tool) {
        throw new SessionDeltaResyncError(
          'item',
          `Delta ${delta.seq} names item ${itemId}, which has no tool call.`,
        )
      }
      return { ...item, tool: update(item.tool), updatedAt }
    })

  switch (delta.type) {
    case 'item.add':
    case 'tool.start':
      snapshot.content = [...previous.content, delta.item]
      break
    case 'item.text.append':
    case 'reasoning.append':
      updateItem(delta.itemId, (item) => ({
        ...item,
        text: item.text + delta.text,
        updatedAt: delta.itemUpdatedAt,
      }))
      break
    case 'item.patch':
      updateItem(delta.itemId, (item) => ({ ...item, ...delta.patch }))
      break
    case 'tool.output.append':
      updateTool(delta.itemId, delta.itemUpdatedAt, (tool) => ({
        ...tool,
        output: (tool.output ?? '') + delta.text,
      }))
      break
    case 'tool.end':
      updateTool(delta.itemId, delta.endedAt, (tool) => ({
        ...tool,
        ...(delta.exitCode === undefined ? {} : { exitCode: delta.exitCode }),
        endedAt: delta.endedAt,
        startedAt: delta.startedAt,
        status: delta.status,
      }))
      break
    case 'plan.update':
      updateTool(delta.itemId, delta.itemUpdatedAt, (tool) => ({
        ...tool,
        tasks: delta.tasks,
      }))
      break
    case 'approval.add':
      snapshot.pendingApprovals = [...previous.pendingApprovals, delta.approval]
      snapshot.planApproval = findPlanApproval(snapshot.pendingApprovals)
      break
    case 'approval.resolve':
      snapshot.pendingApprovals = previous.pendingApprovals.filter(
        (approval) => approval.id !== delta.requestId,
      )
      snapshot.planApproval = findPlanApproval(snapshot.pendingApprovals)
      break
    case 'input.add':
      snapshot.pendingUserInputs = [...previous.pendingUserInputs, delta.input]
      break
    case 'input.resolve':
      snapshot.pendingUserInputs = previous.pendingUserInputs.filter(
        (input) => input.id !== delta.requestId,
      )
      break
    case 'turn':
      snapshot.turns = previous.turns.some((turn) => turn.id === delta.turn.id)
        ? previous.turns.map((turn) =>
            turn.id === delta.turn.id ? delta.turn : turn,
          )
        : [...previous.turns, delta.turn]
      break
    case 'status':
      snapshot.sessionState = delta.sessionState
      snapshot.running = delta.running
      snapshot.detail = delta.detail
      snapshot.lastCompletedAt = delta.lastCompletedAt
      break
    case 'usage':
      snapshot.usage = delta.usage
      break
    case 'usage.reports':
      snapshot.usageReports = delta.usageReports
      snapshot.usageSummary = delta.usageSummary
      break
    case 'limit':
      if (delta.limit) snapshot.usageLimit = delta.limit
      else delete snapshot.usageLimit
      break
    case 'error':
      snapshot.lastError = delta.lastError
      snapshot.lastErrorAt = delta.lastErrorAt
      if (delta.lastErrorKind) snapshot.lastErrorKind = delta.lastErrorKind
      else delete snapshot.lastErrorKind
      break
    case 'session.patch':
      Object.assign(snapshot, delta.set)
      for (const key of delta.unset ?? []) delete snapshot[key]
      break
  }

  return { seq: delta.seq, snapshot }
}

function findPlanApproval(
  approvals: readonly ManagedSessionPendingApproval[],
): ManagedSessionPlanApproval | null {
  const approval = approvals.find(
    (candidate) => candidate.requestType === 'plan-approval',
  )
  return approval ? { detail: approval.detail, id: approval.id } : null
}

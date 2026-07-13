import type { ManagedSessionSnapshot } from '../shared/managed-session'
import type { TerminalEvent, TerminalSessionConfig } from '../shared/terminal'
import {
  type WorkspaceActivityCollectionSnapshot,
  type WorkspaceActivityEvent,
  type WorkspaceActivitySnapshot,
  resolveWorkspaceActivityList,
} from '../shared/workspace-activity'

interface WorkspaceActivityServiceOptions {
  readonly getNow?: () => string
  readonly onUpdate: (event: WorkspaceActivityEvent) => void
  readonly onWorkspaceVisited?: (
    workspaceId: string,
    processedThrough: string,
  ) => void
  readonly visitWatermarks?: Record<string, string>
}

interface FallbackTerminalSession {
  exitCode: number | null
  paneId: string
  running: boolean
  sessionId: string
  updatedAt: string
  workspaceId: string
}

function createActivity(input: {
  detail?: string | null
  paneId: string
  provider: WorkspaceActivitySnapshot['provider']
  sessionId: string
  source: WorkspaceActivitySnapshot['source']
  state: WorkspaceActivitySnapshot['state']
  updatedAt: string
  workspaceId: string
}): WorkspaceActivitySnapshot {
  return {
    detail: input.detail ?? null,
    paneId: input.paneId,
    provider: input.provider,
    sessionId: input.sessionId,
    source: input.source,
    state: input.state,
    updatedAt: input.updatedAt,
    workspaceId: input.workspaceId,
  }
}

function deriveManagedActivity(
  snapshot: ManagedSessionSnapshot,
  visitedThrough: string | null,
): WorkspaceActivitySnapshot | null {
  if (
    snapshot.lastErrorAt &&
    visitedThrough &&
    snapshot.lastErrorAt > visitedThrough
  ) {
    return createActivity({
      detail: snapshot.lastError,
      paneId: snapshot.paneId,
      provider: snapshot.provider,
      sessionId: snapshot.sessionId,
      source: 'managed',
      state: 'error',
      updatedAt: snapshot.lastErrorAt,
      workspaceId: snapshot.workspaceId,
    })
  }

  if (snapshot.planApproval) {
    return createActivity({
      detail: snapshot.planApproval.detail,
      paneId: snapshot.paneId,
      provider: snapshot.provider,
      sessionId: snapshot.sessionId,
      source: 'managed',
      state: 'pending-approval',
      updatedAt: snapshot.updatedAt,
      workspaceId: snapshot.workspaceId,
    })
  }

  if (snapshot.pendingApprovals.length > 0) {
    return createActivity({
      detail: snapshot.pendingApprovals[0]?.detail ?? snapshot.detail,
      paneId: snapshot.paneId,
      provider: snapshot.provider,
      sessionId: snapshot.sessionId,
      source: 'managed',
      state: 'pending-approval',
      updatedAt: snapshot.updatedAt,
      workspaceId: snapshot.workspaceId,
    })
  }

  if (snapshot.pendingUserInputs.length > 0) {
    return createActivity({
      detail: snapshot.pendingUserInputs[0]?.detail ?? snapshot.detail,
      paneId: snapshot.paneId,
      provider: snapshot.provider,
      sessionId: snapshot.sessionId,
      source: 'managed',
      state: 'awaiting-input',
      updatedAt: snapshot.updatedAt,
      workspaceId: snapshot.workspaceId,
    })
  }

  if (snapshot.sessionState === 'connecting') {
    return createActivity({
      paneId: snapshot.paneId,
      provider: snapshot.provider,
      sessionId: snapshot.sessionId,
      source: 'managed',
      state: 'connecting',
      updatedAt: snapshot.updatedAt,
      workspaceId: snapshot.workspaceId,
    })
  }

  if (
    snapshot.running &&
    (snapshot.sessionState === 'running' ||
      snapshot.turns.some((turn) => turn.state === 'running'))
  ) {
    return createActivity({
      paneId: snapshot.paneId,
      provider: snapshot.provider,
      sessionId: snapshot.sessionId,
      source: 'managed',
      state: 'working',
      updatedAt: snapshot.updatedAt,
      workspaceId: snapshot.workspaceId,
    })
  }

  if (
    snapshot.interactionMode === 'plan' &&
    snapshot.sessionState === 'ready'
  ) {
    return createActivity({
      detail: snapshot.detail,
      paneId: snapshot.paneId,
      provider: snapshot.provider,
      sessionId: snapshot.sessionId,
      source: 'managed',
      state: 'plan-ready',
      updatedAt: snapshot.updatedAt,
      workspaceId: snapshot.workspaceId,
    })
  }

  if (
    snapshot.lastCompletedAt &&
    visitedThrough &&
    snapshot.lastCompletedAt > visitedThrough
  ) {
    return createActivity({
      paneId: snapshot.paneId,
      provider: snapshot.provider,
      sessionId: snapshot.sessionId,
      source: 'managed',
      state: 'completed',
      updatedAt: snapshot.lastCompletedAt,
      workspaceId: snapshot.workspaceId,
    })
  }

  return null
}

export class WorkspaceActivityService {
  private readonly collections = new Map<
    string,
    WorkspaceActivityCollectionSnapshot
  >()
  private readonly fallbackSessions = new Map<string, FallbackTerminalSession>()
  private readonly getNow: () => string
  private readonly managedSnapshots = new Map<string, ManagedSessionSnapshot>()
  private readonly processedThroughByWorkspace = new Map<string, string>()
  private readonly visitWatermarks = new Map<string, string>()

  public constructor(
    private readonly options: WorkspaceActivityServiceOptions,
  ) {
    this.getNow = options.getNow ?? (() => new Date().toISOString())
    for (const [workspaceId, watermark] of Object.entries(
      options.visitWatermarks ?? {},
    )) {
      this.visitWatermarks.set(workspaceId, watermark)
    }
  }

  public getSnapshot(): Record<string, WorkspaceActivityCollectionSnapshot> {
    return Object.fromEntries(this.collections)
  }

  public handleManagedSessionSnapshot(snapshot: ManagedSessionSnapshot): void {
    const existing = this.managedSnapshots.get(snapshot.sessionId)
    if (
      existing &&
      (snapshot.runtimeGeneration < existing.runtimeGeneration ||
        (snapshot.runtimeGeneration === existing.runtimeGeneration &&
          snapshot.revision <= existing.revision))
    ) {
      return
    }

    this.managedSnapshots.set(snapshot.sessionId, snapshot)
    this.recordProcessed(snapshot.workspaceId, snapshot.updatedAt)
    this.publish(snapshot.workspaceId)
  }

  public handleManagedSessionRemoved(sessionId: string): void {
    const snapshot = this.managedSnapshots.get(sessionId)
    if (!snapshot) {
      return
    }

    this.managedSnapshots.delete(sessionId)
    this.publish(snapshot.workspaceId)
  }

  public handleTerminalEvent(event: TerminalEvent): void {
    const session = this.fallbackSessions.get(event.sessionId)
    if (!session) {
      return
    }

    session.updatedAt = this.getNow()
    if (event.type === 'exit') {
      session.exitCode = event.exitCode
      session.running = false
    }
    this.recordProcessed(session.workspaceId, session.updatedAt)
    this.publish(session.workspaceId)
  }

  public markWorkspaceVisited(workspaceId: string): void {
    const processedThrough =
      this.processedThroughByWorkspace.get(workspaceId) ?? this.getNow()
    this.visitWatermarks.set(workspaceId, processedThrough)
    this.options.onWorkspaceVisited?.(workspaceId, processedThrough)
    this.publish(workspaceId)
  }

  public trackSession(config: TerminalSessionConfig): void {
    if (config.mode !== 'shell') {
      return
    }

    const updatedAt = this.getNow()
    this.fallbackSessions.set(config.sessionId, {
      exitCode: null,
      paneId: config.paneId,
      running: true,
      sessionId: config.sessionId,
      updatedAt,
      workspaceId: config.workspaceId,
    })
    this.recordProcessed(config.workspaceId, updatedAt)
    this.publish(config.workspaceId)
  }

  public handleSessionLaunchFailure(
    config: TerminalSessionConfig,
    error: unknown,
  ): void {
    if (config.mode !== 'shell') {
      return
    }

    const updatedAt = this.getNow()
    this.fallbackSessions.set(config.sessionId, {
      exitCode: 1,
      paneId: config.paneId,
      running: false,
      sessionId: config.sessionId,
      updatedAt,
      workspaceId: config.workspaceId,
    })
    this.recordProcessed(config.workspaceId, updatedAt)
    this.publish(
      config.workspaceId,
      error instanceof Error ? error.message : 'Launch failed',
    )
  }

  private publish(workspaceId: string, terminalError?: string): void {
    const visitedThrough = this.visitWatermarks.get(workspaceId) ?? null
    const activities = resolveWorkspaceActivityList([
      ...[...this.managedSnapshots.values()]
        .filter((snapshot) => snapshot.workspaceId === workspaceId)
        .map((snapshot) => deriveManagedActivity(snapshot, visitedThrough))
        .filter(
          (activity): activity is WorkspaceActivitySnapshot =>
            activity !== null,
        ),
      ...[...this.fallbackSessions.values()]
        .filter(
          (session) => session.workspaceId === workspaceId && session.running,
        )
        .map((session) =>
          createActivity({
            paneId: session.paneId,
            provider: 'terminal',
            sessionId: session.sessionId,
            source: 'fallback',
            state: 'terminal-running',
            updatedAt: session.updatedAt,
            workspaceId,
          }),
        ),
      ...[...this.fallbackSessions.values()]
        .filter(
          (session) =>
            session.workspaceId === workspaceId &&
            !session.running &&
            session.exitCode !== null &&
            session.exitCode !== 0 &&
            visitedThrough !== null &&
            session.updatedAt > visitedThrough,
        )
        .map((session) =>
          createActivity({
            detail:
              terminalError ?? `Terminal exited with code ${session.exitCode}`,
            paneId: session.paneId,
            provider: 'terminal',
            sessionId: session.sessionId,
            source: 'fallback',
            state: 'error',
            updatedAt: session.updatedAt,
            workspaceId,
          }),
        ),
    ])
    const previous = this.collections.get(workspaceId)
    const collection: WorkspaceActivityCollectionSnapshot = {
      activities,
      revision: (previous?.revision ?? 0) + 1,
      workspaceId,
    }

    this.collections.set(workspaceId, collection)
    this.options.onUpdate({
      activities,
      collection,
      revision: collection.revision,
      workspaceId,
    })
  }

  private recordProcessed(workspaceId: string, updatedAt: string): void {
    const current = this.processedThroughByWorkspace.get(workspaceId)
    if (!current || updatedAt > current) {
      this.processedThroughByWorkspace.set(workspaceId, updatedAt)
    }
  }
}

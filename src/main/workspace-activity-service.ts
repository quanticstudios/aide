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

  const pendingApproval = snapshot.pendingApprovals.find(
    (approval) => approval.requestType !== 'plan-approval',
  )
  if (pendingApproval) {
    return createActivity({
      detail: pendingApproval.detail ?? snapshot.detail,
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

  if (snapshot.planApproval) {
    return createActivity({
      detail: snapshot.planApproval.detail,
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
  private readonly activitiesByWorkspace = new Map<
    string,
    WorkspaceActivitySnapshot[]
  >()
  private readonly fallbackSessions = new Map<string, FallbackTerminalSession>()
  private readonly getNow: () => string
  private readonly managedSnapshots = new Map<string, ManagedSessionSnapshot>()
  private readonly processedThroughByWorkspace = new Map<string, string>()
  private readonly visitWatermarks = new Map<string, string>()
  private revision = 0
  private visibleWorkspaceId: string | null = null

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

  public getSnapshot(): WorkspaceActivityCollectionSnapshot {
    return {
      activitiesByWorkspace: Object.fromEntries(this.activitiesByWorkspace),
      revision: this.revision,
    }
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
    if (this.visibleWorkspaceId === snapshot.workspaceId) {
      this.acknowledgeProcessed(snapshot.workspaceId)
    }
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
    if (this.visibleWorkspaceId === session.workspaceId) {
      this.acknowledgeProcessed(session.workspaceId)
    }
    this.publish(session.workspaceId)
  }

  public markWorkspaceVisited(workspaceId: string): void {
    this.visibleWorkspaceId = workspaceId
    this.acknowledgeProcessed(workspaceId)
    this.publish(workspaceId)
  }

  public setVisibleWorkspace(workspaceId: string | null): void {
    this.visibleWorkspaceId = workspaceId
    if (workspaceId) {
      this.acknowledgeProcessed(workspaceId)
      this.publish(workspaceId)
    }
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
    if (this.visibleWorkspaceId === config.workspaceId) {
      this.acknowledgeProcessed(config.workspaceId)
    }
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
    if (this.visibleWorkspaceId === config.workspaceId) {
      this.acknowledgeProcessed(config.workspaceId)
    }
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
    if (activities.length === 0) {
      this.activitiesByWorkspace.delete(workspaceId)
    } else {
      this.activitiesByWorkspace.set(workspaceId, activities)
    }
    this.revision += 1
    this.options.onUpdate({
      activities,
      revision: this.revision,
      workspaceId,
    })
  }

  private acknowledgeProcessed(workspaceId: string): void {
    const processedThrough = this.processedThroughByWorkspace.get(workspaceId)
    if (!processedThrough) {
      return
    }
    const current = this.visitWatermarks.get(workspaceId)
    if (current && current >= processedThrough) {
      return
    }
    this.visitWatermarks.set(workspaceId, processedThrough)
    this.options.onWorkspaceVisited?.(workspaceId, processedThrough)
  }

  private recordProcessed(workspaceId: string, updatedAt: string): void {
    const current = this.processedThroughByWorkspace.get(workspaceId)
    if (!current || updatedAt > current) {
      this.processedThroughByWorkspace.set(workspaceId, updatedAt)
    }
  }
}

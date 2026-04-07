import type { ManagedProviderRuntimeEvent } from '../shared/provider-runtime'
import type {
  TerminalEvent,
  TerminalLaunchMode,
  TerminalSessionConfig,
} from '../shared/terminal'
import {
  type WorkspaceActivityEvent,
  type WorkspaceActivityProvider,
  type WorkspaceActivitySnapshot,
  resolveAggregateWorkspaceActivity,
} from '../shared/workspace-activity'
import {
  ManagedTerminalProviderAdapter,
  ManagedTerminalProviderProjector,
} from './terminal-provider-runtime'

interface WorkspaceActivityServiceOptions {
  readonly getNow?: () => string
  readonly onUpdate: (event: WorkspaceActivityEvent) => void
}

type WorkspaceActivitySource = 'managed' | 'fallback'
type FallbackSessionState = 'ready' | 'running' | 'stopped' | 'error'

interface SessionActivityState {
  buffer: string
  exitCode: number | null
  lastSeenAt: string | null
  mode: TerminalLaunchMode
  paneId: string
  provider: WorkspaceActivityProvider
  runtimeAdapter: ManagedTerminalProviderAdapter | null
  runtimeProjector: ManagedTerminalProviderProjector | null
  running: boolean
  sessionId: string
  sessionState: FallbackSessionState
  source: WorkspaceActivitySource
  workspaceId: string
}

const MAX_BUFFER_LENGTH = 24_000
const SHELL_PROMPT_PATTERN = /(^|\n)[^\n]*[>$#]\s$/m
const CLAUDE_READY_PATTERN =
  /(^|\n)\s*(?:>\s*$|how can i help you today\?\s*$)/im
const CODEX_READY_PATTERN = /(^|\n)\s*(?:›\s*$|>\s*$)/im

function detectFallbackProvider(buffer: string): WorkspaceActivityProvider {
  if (/claude code/i.test(buffer)) {
    return 'claude'
  }

  if (/\b(?:openai\s+)?codex\b/i.test(buffer)) {
    return 'codex'
  }

  return 'terminal'
}

function resolveProvider(mode: TerminalLaunchMode): WorkspaceActivityProvider {
  if (mode === 'claude' || mode === 'codex') {
    return mode
  }

  return 'terminal'
}

function resolveSource(mode: TerminalLaunchMode): WorkspaceActivitySource {
  return mode === 'shell' ? 'fallback' : 'managed'
}

function resolveReadyPattern(
  provider: WorkspaceActivityProvider,
): RegExp | null {
  if (provider === 'claude') {
    return CLAUDE_READY_PATTERN
  }

  if (provider === 'codex') {
    return CODEX_READY_PATTERN
  }

  return SHELL_PROMPT_PATTERN
}

function createActivitySnapshot(input: {
  detail?: string | null
  paneId: string
  provider: WorkspaceActivityProvider
  sessionId: string
  source: WorkspaceActivitySource
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

function createSessionState(
  config: TerminalSessionConfig,
  updatedAt: string,
): SessionActivityState {
  const runtimeAdapter =
    config.mode === 'claude' || config.mode === 'codex'
      ? new ManagedTerminalProviderAdapter(config.mode, config.mode)
      : null
  const runtimeProjector =
    config.mode === 'claude' || config.mode === 'codex'
      ? new ManagedTerminalProviderProjector(config.mode)
      : null

  runtimeProjector?.apply(
    runtimeAdapter?.createSessionStartEvents(updatedAt) ?? [],
  )

  return {
    buffer: '',
    exitCode: null,
    lastSeenAt: updatedAt,
    mode: config.mode,
    paneId: config.paneId,
    provider: resolveProvider(config.mode),
    runtimeAdapter,
    runtimeProjector,
    running: true,
    sessionId: config.sessionId,
    sessionState: 'ready',
    source: resolveSource(config.mode),
    workspaceId: config.workspaceId,
  }
}

function updateFallbackSessionState(session: SessionActivityState): void {
  session.provider = detectFallbackProvider(session.buffer)
  const readyPattern = resolveReadyPattern(session.provider)

  if (readyPattern?.test(session.buffer)) {
    session.sessionState = 'ready'
    return
  }

  session.sessionState = session.running ? 'running' : 'ready'
}

function deriveLiveSessionActivity(
  session: SessionActivityState,
  lastVisitedAt: string | null,
): WorkspaceActivitySnapshot | null {
  if (session.source === 'managed') {
    const runtime = session.runtimeProjector?.getSnapshot()

    if (!runtime) {
      return null
    }

    if (
      runtime.lastErrorAt &&
      (!lastVisitedAt || runtime.lastErrorAt > lastVisitedAt)
    ) {
      return createActivitySnapshot({
        detail: runtime.lastError,
        paneId: session.paneId,
        provider: runtime.provider,
        sessionId: session.sessionId,
        source: session.source,
        state: 'error',
        updatedAt: runtime.lastErrorAt,
        workspaceId: session.workspaceId,
      })
    }

    if (runtime.hasPendingApproval) {
      return createActivitySnapshot({
        detail: runtime.detail,
        paneId: session.paneId,
        provider: runtime.provider,
        sessionId: session.sessionId,
        source: session.source,
        state: 'pending-approval',
        updatedAt: runtime.lastSeenAt ?? new Date(0).toISOString(),
        workspaceId: session.workspaceId,
      })
    }

    if (runtime.hasPendingUserInput) {
      return createActivitySnapshot({
        detail: runtime.detail,
        paneId: session.paneId,
        provider: runtime.provider,
        sessionId: session.sessionId,
        source: session.source,
        state: 'awaiting-input',
        updatedAt: runtime.lastSeenAt ?? new Date(0).toISOString(),
        workspaceId: session.workspaceId,
      })
    }

    if (runtime.sessionState === 'connecting') {
      return createActivitySnapshot({
        paneId: session.paneId,
        provider: runtime.provider,
        sessionId: session.sessionId,
        source: session.source,
        state: 'connecting',
        updatedAt: runtime.lastSeenAt ?? new Date(0).toISOString(),
        workspaceId: session.workspaceId,
      })
    }

    if (runtime.sessionState === 'running' || runtime.activeTurnStartedAt) {
      return createActivitySnapshot({
        paneId: session.paneId,
        provider: runtime.provider,
        sessionId: session.sessionId,
        source: session.source,
        state: 'working',
        updatedAt:
          runtime.lastSeenAt ??
          runtime.activeTurnStartedAt ??
          new Date(0).toISOString(),
        workspaceId: session.workspaceId,
      })
    }

    if (
      runtime.lastCompletedAt &&
      (!lastVisitedAt || runtime.lastCompletedAt > lastVisitedAt)
    ) {
      return createActivitySnapshot({
        paneId: session.paneId,
        provider: runtime.provider,
        sessionId: session.sessionId,
        source: session.source,
        state: 'completed',
        updatedAt: runtime.lastCompletedAt,
        workspaceId: session.workspaceId,
      })
    }

    return null
  }

  if (session.provider !== 'terminal' && session.sessionState === 'running') {
    return createActivitySnapshot({
      paneId: session.paneId,
      provider: session.provider,
      sessionId: session.sessionId,
      source: session.source,
      state: 'working',
      updatedAt: session.lastSeenAt ?? new Date(0).toISOString(),
      workspaceId: session.workspaceId,
    })
  }

  if (session.provider === 'terminal' && session.sessionState === 'running') {
    return createActivitySnapshot({
      paneId: session.paneId,
      provider: 'terminal',
      sessionId: session.sessionId,
      source: session.source,
      state: 'terminal-running',
      updatedAt: session.lastSeenAt ?? new Date(0).toISOString(),
      workspaceId: session.workspaceId,
    })
  }

  return null
}

function applyManagedSessionEvents(
  session: SessionActivityState,
  updatedAt: string,
  applyEvents: () => readonly ManagedProviderRuntimeEvent[],
): void {
  session.lastSeenAt = updatedAt
  session.runtimeProjector?.apply(applyEvents())
}

export class WorkspaceActivityService {
  private readonly getNow: () => string
  private readonly lastVisitedAtByWorkspace = new Map<string, string>()
  private readonly sessions = new Map<string, SessionActivityState>()
  private readonly snapshotByWorkspace = new Map<
    string,
    WorkspaceActivitySnapshot[]
  >()

  public constructor(
    private readonly options: WorkspaceActivityServiceOptions,
  ) {
    this.getNow = options.getNow ?? (() => new Date().toISOString())
  }

  public getSnapshot(): Record<string, WorkspaceActivitySnapshot[]> {
    return Object.fromEntries(this.snapshotByWorkspace)
  }

  public handleSessionLaunchFailure(
    config: TerminalSessionConfig,
    error: unknown,
  ): void {
    const updatedAt = this.getNow()
    const message = error instanceof Error ? error.message : 'Launch failed'
    const session = createSessionState(config, updatedAt)

    session.running = false
    session.exitCode = 1

    if (session.source === 'managed') {
      applyManagedSessionEvents(
        session,
        updatedAt,
        () =>
          session.runtimeAdapter?.handleLaunchFailure(message, updatedAt) ?? [],
      )
    } else {
      session.sessionState = 'error'
    }

    this.sessions.set(config.sessionId, session)
    this.publishWorkspaceActivity(config.workspaceId)
  }

  public handleTerminalEvent(event: TerminalEvent): void {
    const session = this.sessions.get(event.sessionId)

    if (!session) {
      return
    }

    const updatedAt = this.getNow()
    session.lastSeenAt = updatedAt

    if (event.type === 'data') {
      session.buffer = `${session.buffer}${event.data}`.slice(
        -MAX_BUFFER_LENGTH,
      )
      session.running = true
      session.exitCode = null

      if (session.source === 'managed') {
        applyManagedSessionEvents(
          session,
          updatedAt,
          () =>
            session.runtimeAdapter?.handleOutput(event.data, updatedAt) ?? [],
        )
      } else {
        updateFallbackSessionState(session)
      }
    } else {
      session.exitCode = event.exitCode
      session.running = false

      if (session.source === 'managed') {
        applyManagedSessionEvents(
          session,
          updatedAt,
          () =>
            session.runtimeAdapter?.handleExit(event.exitCode, updatedAt) ?? [],
        )
      } else if (event.exitCode && event.exitCode !== 0) {
        session.sessionState = 'error'
      } else {
        session.sessionState = 'stopped'
      }
    }

    this.publishWorkspaceActivity(session.workspaceId)
  }

  public handleTerminalInput(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId)

    if (!session) {
      return
    }

    const updatedAt = this.getNow()
    session.lastSeenAt = updatedAt

    if (!data.includes('\n') && !data.includes('\r')) {
      this.publishWorkspaceActivity(session.workspaceId)
      return
    }

    if (session.source === 'managed') {
      applyManagedSessionEvents(
        session,
        updatedAt,
        () => session.runtimeAdapter?.handleInput(data, updatedAt) ?? [],
      )
    } else {
      session.buffer = ''
      session.sessionState = 'running'
    }

    this.publishWorkspaceActivity(session.workspaceId)
  }

  public markWorkspaceVisited(workspaceId: string): void {
    this.lastVisitedAtByWorkspace.set(workspaceId, this.getNow())
    this.publishWorkspaceActivity(workspaceId)
  }

  public trackSession(config: TerminalSessionConfig): void {
    this.sessions.set(
      config.sessionId,
      createSessionState(config, this.getNow()),
    )
    this.publishWorkspaceActivity(config.workspaceId)
  }

  private publishWorkspaceActivity(workspaceId: string): void {
    const activities = [...this.sessions.values()]
      .filter((session) => session.workspaceId === workspaceId)
      .map((session) =>
        deriveLiveSessionActivity(
          session,
          this.lastVisitedAtByWorkspace.get(workspaceId) ?? null,
        ),
      )
      .filter(
        (snapshot): snapshot is WorkspaceActivitySnapshot => snapshot !== null,
      )
      .sort((left, right) =>
        resolveAggregateWorkspaceActivity([left, right]) === left ? -1 : 1,
      )

    if (activities.length > 0) {
      this.snapshotByWorkspace.set(workspaceId, activities)
    } else {
      this.snapshotByWorkspace.delete(workspaceId)
    }

    this.options.onUpdate({
      activities,
      workspaceId,
    })
  }
}

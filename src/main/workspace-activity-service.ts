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

interface WorkspaceActivityServiceOptions {
  readonly getNow?: () => string
  readonly onUpdate: (event: WorkspaceActivityEvent) => void
}

type WorkspaceActivitySource = 'managed' | 'fallback'
type SessionRuntimeState =
  | 'connecting'
  | 'ready'
  | 'running'
  | 'waiting'
  | 'stopped'
  | 'error'

interface SessionActivityState {
  activeTurnStartedAt: string | null
  buffer: string
  detail: string | null
  exitCode: number | null
  hasPendingApproval: boolean
  hasPendingUserInput: boolean
  lastCompletedAt: string | null
  lastError: string | null
  lastErrorAt: string | null
  lastSeenAt: string | null
  mode: TerminalLaunchMode
  paneId: string
  provider: WorkspaceActivityProvider
  running: boolean
  sessionId: string
  sessionState: SessionRuntimeState
  source: WorkspaceActivitySource
  workspaceId: string
}

const MAX_BUFFER_LENGTH = 24_000
const SHELL_PROMPT_PATTERN = /(^|\n)[^\n]*[>$#]\s$/m
const CLAUDE_READY_PATTERN =
  /(^|\n)\s*(?:>\s*$|how can i help you today\?\s*$)/im
const CODEX_READY_PATTERN = /(^|\n)\s*(?:›\s*$|>\s*$)/im

const APPROVAL_MARKERS = [
  'approval required',
  'permission required',
  'needs approval',
  'allow this action',
  'confirm to continue',
  'bypass permissions',
  'mcp server failed',
  'shift+tab to cycle',
] as const

const INPUT_MARKERS = [
  'select an option',
  'choose an option',
  'awaiting input',
  'how would you like to proceed',
  'press enter to continue',
  'y/n',
  'yes/no',
  'which option',
  'pick an option',
  'enter to continue',
  'continue?',
] as const

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

function findRecentLineDetail(
  buffer: string,
  markers: readonly string[],
): string | null {
  const lines = buffer
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-16)
    .reverse()

  for (const line of lines) {
    const normalized = line.toLowerCase()

    if (markers.some((marker) => normalized.includes(marker))) {
      return line
    }
  }

  return null
}

function createActivitySnapshot(input: {
  detail?: string | null
  provider: WorkspaceActivityProvider
  source: WorkspaceActivitySource
  state: WorkspaceActivitySnapshot['state']
  updatedAt: string
  workspaceId: string
}): WorkspaceActivitySnapshot {
  return {
    detail: input.detail ?? null,
    provider: input.provider,
    source: input.source,
    state: input.state,
    updatedAt: input.updatedAt,
    workspaceId: input.workspaceId,
  }
}

function createSessionState(
  config: TerminalSessionConfig,
  initialState?: Partial<SessionActivityState>,
): SessionActivityState {
  return {
    activeTurnStartedAt: null,
    buffer: '',
    detail: null,
    exitCode: null,
    hasPendingApproval: false,
    hasPendingUserInput: false,
    lastCompletedAt: null,
    lastError: null,
    lastErrorAt: null,
    lastSeenAt: null,
    mode: config.mode,
    paneId: config.paneId,
    provider: resolveProvider(config.mode),
    running: true,
    sessionId: config.sessionId,
    sessionState: config.mode === 'shell' ? 'ready' : 'connecting',
    source: resolveSource(config.mode),
    workspaceId: config.workspaceId,
    ...initialState,
  }
}

function updateManagedSessionState(
  session: SessionActivityState,
  updatedAt: string,
): void {
  const approvalDetail = findRecentLineDetail(session.buffer, APPROVAL_MARKERS)

  if (approvalDetail) {
    session.detail = approvalDetail
    session.hasPendingApproval = true
    session.hasPendingUserInput = false
    session.sessionState = 'waiting'
    return
  }

  const inputDetail = findRecentLineDetail(session.buffer, INPUT_MARKERS)

  if (inputDetail) {
    session.detail = inputDetail
    session.hasPendingApproval = false
    session.hasPendingUserInput = true
    session.sessionState = 'waiting'
    return
  }

  const readyPattern = resolveReadyPattern(session.provider)

  if (readyPattern?.test(session.buffer)) {
    if (session.activeTurnStartedAt) {
      session.lastCompletedAt = updatedAt
    }

    session.activeTurnStartedAt = null
    session.detail = null
    session.hasPendingApproval = false
    session.hasPendingUserInput = false
    session.sessionState = 'ready'
    return
  }

  session.detail = null
  session.hasPendingApproval = false
  session.hasPendingUserInput = false
  session.sessionState = session.activeTurnStartedAt ? 'running' : 'connecting'
}

function updateFallbackSessionState(session: SessionActivityState): void {
  session.provider = detectFallbackProvider(session.buffer)
  session.detail = null

  const readyPattern = resolveReadyPattern(session.provider)

  if (readyPattern?.test(session.buffer)) {
    session.activeTurnStartedAt = null
    session.sessionState = 'ready'
    return
  }

  session.sessionState = session.activeTurnStartedAt ? 'running' : 'ready'
}

function deriveLiveSessionActivity(
  session: SessionActivityState,
  lastVisitedAt: string | null,
): WorkspaceActivitySnapshot | null {
  if (
    session.lastErrorAt &&
    (!lastVisitedAt || session.lastErrorAt > lastVisitedAt)
  ) {
    return createActivitySnapshot({
      detail: session.lastError,
      provider: session.provider,
      source: session.source,
      state: 'error',
      updatedAt: session.lastErrorAt,
      workspaceId: session.workspaceId,
    })
  }

  if (session.source === 'managed') {
    if (session.hasPendingApproval) {
      return createActivitySnapshot({
        detail: session.detail,
        provider: session.provider,
        source: session.source,
        state: 'pending-approval',
        updatedAt: session.lastSeenAt ?? new Date(0).toISOString(),
        workspaceId: session.workspaceId,
      })
    }

    if (session.hasPendingUserInput) {
      return createActivitySnapshot({
        detail: session.detail,
        provider: session.provider,
        source: session.source,
        state: 'awaiting-input',
        updatedAt: session.lastSeenAt ?? new Date(0).toISOString(),
        workspaceId: session.workspaceId,
      })
    }

    if (session.sessionState === 'connecting') {
      return createActivitySnapshot({
        provider: session.provider,
        source: session.source,
        state: 'connecting',
        updatedAt: session.lastSeenAt ?? new Date(0).toISOString(),
        workspaceId: session.workspaceId,
      })
    }

    if (session.sessionState === 'running' || session.activeTurnStartedAt) {
      return createActivitySnapshot({
        provider: session.provider,
        source: session.source,
        state: 'working',
        updatedAt:
          session.lastSeenAt ??
          session.activeTurnStartedAt ??
          new Date(0).toISOString(),
        workspaceId: session.workspaceId,
      })
    }

    if (
      session.lastCompletedAt &&
      (!lastVisitedAt || session.lastCompletedAt > lastVisitedAt)
    ) {
      return createActivitySnapshot({
        provider: session.provider,
        source: session.source,
        state: 'completed',
        updatedAt: session.lastCompletedAt,
        workspaceId: session.workspaceId,
      })
    }

    return null
  }

  if (session.provider !== 'terminal' && session.sessionState === 'running') {
    return createActivitySnapshot({
      provider: session.provider,
      source: session.source,
      state: 'working',
      updatedAt:
        session.lastSeenAt ??
        session.activeTurnStartedAt ??
        new Date(0).toISOString(),
      workspaceId: session.workspaceId,
    })
  }

  if (session.provider === 'terminal' && session.sessionState === 'running') {
    return createActivitySnapshot({
      provider: 'terminal',
      source: session.source,
      state: 'terminal-running',
      updatedAt:
        session.lastSeenAt ??
        session.activeTurnStartedAt ??
        new Date(0).toISOString(),
      workspaceId: session.workspaceId,
    })
  }

  return null
}

export class WorkspaceActivityService {
  private readonly getNow: () => string
  private readonly lastVisitedAtByWorkspace = new Map<string, string>()
  private readonly sessions = new Map<string, SessionActivityState>()
  private readonly snapshotByWorkspace = new Map<
    string,
    WorkspaceActivitySnapshot
  >()

  public constructor(
    private readonly options: WorkspaceActivityServiceOptions,
  ) {
    this.getNow = options.getNow ?? (() => new Date().toISOString())
  }

  public getSnapshot(): Record<string, WorkspaceActivitySnapshot> {
    return Object.fromEntries(this.snapshotByWorkspace)
  }

  public handleSessionLaunchFailure(
    config: TerminalSessionConfig,
    error: unknown,
  ): void {
    const updatedAt = this.getNow()
    const message = error instanceof Error ? error.message : 'Launch failed'

    this.sessions.set(
      config.sessionId,
      createSessionState(config, {
        detail: message,
        lastError: message,
        lastErrorAt: updatedAt,
        lastSeenAt: updatedAt,
        running: false,
        sessionState: 'error',
      }),
    )
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
        updateManagedSessionState(session, updatedAt)
      } else {
        updateFallbackSessionState(session)
      }
    } else {
      session.exitCode = event.exitCode
      session.running = false

      if (event.exitCode && event.exitCode !== 0) {
        session.lastError = `Process exited with code ${event.exitCode}`
        session.lastErrorAt = updatedAt
        session.sessionState = 'error'
      } else {
        session.sessionState = 'stopped'
        session.activeTurnStartedAt = null
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

    session.buffer = ''
    session.activeTurnStartedAt = updatedAt
    session.detail = null
    session.hasPendingApproval = false
    session.hasPendingUserInput = false
    session.lastError = null
    session.lastErrorAt = null
    session.sessionState = 'running'
    this.publishWorkspaceActivity(session.workspaceId)
  }

  public markWorkspaceVisited(workspaceId: string): void {
    this.lastVisitedAtByWorkspace.set(workspaceId, this.getNow())
    this.publishWorkspaceActivity(workspaceId)
  }

  public trackSession(config: TerminalSessionConfig): void {
    this.sessions.set(
      config.sessionId,
      createSessionState(config, {
        lastSeenAt: this.getNow(),
      }),
    )
    this.publishWorkspaceActivity(config.workspaceId)
  }

  private publishWorkspaceActivity(workspaceId: string): void {
    const activity = resolveAggregateWorkspaceActivity(
      [...this.sessions.values()]
        .filter((session) => session.workspaceId === workspaceId)
        .map((session) =>
          deriveLiveSessionActivity(
            session,
            this.lastVisitedAtByWorkspace.get(workspaceId) ?? null,
          ),
        )
        .filter(
          (snapshot): snapshot is WorkspaceActivitySnapshot =>
            snapshot !== null,
        ),
    )

    if (activity) {
      this.snapshotByWorkspace.set(workspaceId, activity)
    } else {
      this.snapshotByWorkspace.delete(workspaceId)
    }

    this.options.onUpdate({
      activity,
      workspaceId,
    })
  }
}

import type { TerminalEvent, TerminalSessionConfig } from '../shared/terminal'
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

interface SessionActivityState {
  buffer: string
  exitCode: number | null
  lastEventAt: string | null
  lastInputAt: string | null
  lastSubmitAt: string | null
  provider: WorkspaceActivityProvider
  running: boolean
  sessionId: string
  workspaceId: string
}

const MAX_BUFFER_LENGTH = 24_000

const CLAUDE_READY_PATTERN =
  /(^|\n)\s*(?:>\s*$|how can i help you today\?\s*$)/im
const CODEX_READY_PATTERN = /(^|\n)\s*(?:›\s*$|>\s*$)/im

const ATTENTION_MARKERS = [
  'mcp server failed',
  'permission required',
  'approval required',
  'needs approval',
  'confirm',
  'bypass permissions',
] as const

const AWAITING_INPUT_MARKERS = [
  'select an option',
  'choose an option',
  'press enter',
  'y/n',
  'yes/no',
  'awaiting input',
] as const

function detectProvider(buffer: string): WorkspaceActivityProvider {
  if (/claude code/i.test(buffer)) {
    return 'claude'
  }

  if (/\b(?:openai\s+)?codex\b/i.test(buffer)) {
    return 'codex'
  }

  return 'terminal'
}

function resolveReadyState(session: SessionActivityState): boolean {
  if (session.provider === 'claude') {
    return CLAUDE_READY_PATTERN.test(session.buffer)
  }

  if (session.provider === 'codex') {
    return CODEX_READY_PATTERN.test(session.buffer)
  }

  return false
}

function findRecentLineDetail(
  buffer: string,
  markers: readonly string[],
): string | null {
  const lines = buffer
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-12)
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
  state: WorkspaceActivitySnapshot['state']
  updatedAt: string
  workspaceId: string
}): WorkspaceActivitySnapshot {
  return {
    detail: input.detail ?? null,
    provider: input.provider,
    state: input.state,
    updatedAt: input.updatedAt,
    workspaceId: input.workspaceId,
  }
}

function deriveLiveSessionActivity(
  session: SessionActivityState,
  updatedAt: string,
  acknowledgedAt: string | null,
): WorkspaceActivitySnapshot | null {
  if (!session.running) {
    if (
      acknowledgedAt &&
      session.lastEventAt &&
      acknowledgedAt >= session.lastEventAt
    ) {
      return null
    }

    if (session.exitCode && session.exitCode !== 0) {
      return createActivitySnapshot({
        detail: `Process exited with code ${session.exitCode}`,
        provider: session.provider,
        state: 'error',
        updatedAt,
        workspaceId: session.workspaceId,
      })
    }

    return null
  }

  const attentionDetail = findRecentLineDetail(
    session.buffer,
    ATTENTION_MARKERS,
  )

  if (
    attentionDetail &&
    (!acknowledgedAt ||
      !session.lastEventAt ||
      acknowledgedAt < session.lastEventAt)
  ) {
    return createActivitySnapshot({
      detail: attentionDetail,
      provider: session.provider,
      state: 'attention',
      updatedAt,
      workspaceId: session.workspaceId,
    })
  }

  const awaitingInputDetail = findRecentLineDetail(
    session.buffer,
    AWAITING_INPUT_MARKERS,
  )

  if (
    awaitingInputDetail &&
    (!acknowledgedAt ||
      !session.lastEventAt ||
      acknowledgedAt < session.lastEventAt)
  ) {
    return createActivitySnapshot({
      detail: awaitingInputDetail,
      provider: session.provider,
      state: 'awaiting-input',
      updatedAt,
      workspaceId: session.workspaceId,
    })
  }

  if (session.lastSubmitAt && session.lastEventAt === session.lastSubmitAt) {
    return createActivitySnapshot({
      provider: session.provider,
      state: 'working',
      updatedAt,
      workspaceId: session.workspaceId,
    })
  }

  if (resolveReadyState(session)) {
    return createActivitySnapshot({
      provider: session.provider,
      state: 'ready',
      updatedAt,
      workspaceId: session.workspaceId,
    })
  }

  if (session.provider !== 'terminal' || session.lastSubmitAt) {
    return createActivitySnapshot({
      provider: session.provider,
      state: 'working',
      updatedAt,
      workspaceId: session.workspaceId,
    })
  }

  return null
}

export class WorkspaceActivityService {
  private readonly getNow: () => string
  private readonly acknowledgedAtByWorkspace = new Map<string, string>()
  private readonly sessions = new Map<string, SessionActivityState>()
  private readonly stickyByWorkspace = new Map<
    string,
    WorkspaceActivitySnapshot
  >()
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

  public handleTerminalEvent(event: TerminalEvent): void {
    const session = this.sessions.get(event.sessionId)

    if (!session) {
      return
    }

    if (event.type === 'data') {
      session.buffer = `${session.buffer}${event.data}`.slice(
        -MAX_BUFFER_LENGTH,
      )
      session.lastEventAt = this.getNow()
      session.provider = detectProvider(session.buffer)
      session.running = true
    } else {
      session.exitCode = event.exitCode
      session.lastEventAt = this.getNow()
      session.running = false
    }

    this.publishWorkspaceActivity(session.workspaceId)
  }

  public handleTerminalInput(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId)

    if (!session) {
      return
    }

    session.lastInputAt = this.getNow()
    session.lastEventAt = session.lastInputAt

    if (data.includes('\n') || data.includes('\r')) {
      session.lastSubmitAt = this.getNow()
      session.lastEventAt = session.lastSubmitAt
    }

    this.publishWorkspaceActivity(session.workspaceId)
  }

  public markWorkspaceVisited(workspaceId: string): void {
    this.stickyByWorkspace.delete(workspaceId)
    this.acknowledgedAtByWorkspace.set(workspaceId, this.getNow())
    this.publishWorkspaceActivity(workspaceId)
  }

  public trackSession(config: TerminalSessionConfig): void {
    this.sessions.set(config.sessionId, {
      buffer: '',
      exitCode: null,
      lastEventAt: null,
      lastInputAt: null,
      lastSubmitAt: null,
      provider: 'terminal',
      running: true,
      sessionId: config.sessionId,
      workspaceId: config.workspaceId,
    })
    this.publishWorkspaceActivity(config.workspaceId)
  }

  private publishWorkspaceActivity(workspaceId: string): void {
    const updatedAt = this.getNow()
    const liveActivity = resolveAggregateWorkspaceActivity(
      [...this.sessions.values()]
        .filter((session) => session.workspaceId === workspaceId)
        .map((session) =>
          deriveLiveSessionActivity(
            session,
            updatedAt,
            this.acknowledgedAtByWorkspace.get(workspaceId) ?? null,
          ),
        )
        .filter(
          (activity): activity is WorkspaceActivitySnapshot =>
            activity !== null,
        ),
    )

    if (
      liveActivity?.state === 'attention' ||
      liveActivity?.state === 'error'
    ) {
      this.stickyByWorkspace.set(workspaceId, liveActivity)
    } else if (liveActivity) {
      this.stickyByWorkspace.delete(workspaceId)
    }

    const nextActivity =
      liveActivity ?? this.stickyByWorkspace.get(workspaceId) ?? null
    const previousActivity = this.snapshotByWorkspace.get(workspaceId) ?? null

    if (
      previousActivity &&
      nextActivity &&
      previousActivity.provider === nextActivity.provider &&
      previousActivity.state === nextActivity.state &&
      previousActivity.detail === nextActivity.detail
    ) {
      return
    }

    if (!nextActivity) {
      this.snapshotByWorkspace.delete(workspaceId)
    } else {
      this.snapshotByWorkspace.set(workspaceId, nextActivity)
    }

    this.options.onUpdate({
      activity: nextActivity,
      workspaceId,
    })
  }
}

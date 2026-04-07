import type {
  ManagedProviderRuntimeEvent,
  ManagedProviderRuntimeProvider,
  ManagedProviderRuntimeSessionState,
} from '../shared/provider-runtime'
import type { TerminalLaunchMode } from '../shared/terminal'

export type ManagedSessionRuntimeState = ManagedProviderRuntimeSessionState

export interface ManagedSessionRuntimeSnapshot {
  activeTurnStartedAt: string | null
  detail: string | null
  hasPendingApproval: boolean
  hasPendingUserInput: boolean
  lastCompletedAt: string | null
  lastError: string | null
  lastErrorAt: string | null
  lastSeenAt: string | null
  provider: ManagedProviderRuntimeProvider
  sessionState: ManagedSessionRuntimeState
}

interface ProviderPatternSet {
  approval: RegExp[]
  input: RegExp[]
  ready: RegExp
}

interface PendingRequestState {
  detail: string | null
  requestId: string
}

const MAX_BUFFER_LENGTH = 16_000

const PROVIDER_PATTERNS: Record<
  Exclude<TerminalLaunchMode, 'shell'>,
  ProviderPatternSet
> = {
  claude: {
    approval: [
      /\bapproval required\b/i,
      /\bpermission required\b/i,
      /\ballow this action\b/i,
      /\bdo you want to (?:allow|proceed)\b/i,
      /\brequires your approval\b/i,
    ],
    input: [
      /\bselect an option\b/i,
      /\bchoose an option\b/i,
      /\bhow would you like to proceed\b/i,
      /\bwhat would you like to work on today\?\b/i,
      /\bhow are you doing today\?\b/i,
      /\bwhich option\b/i,
      /\benter to select\b/i,
      /\bpress enter to continue\b/i,
      /\bcontinue\?\s*$/i,
    ],
    ready: /(^|\n)\s*(?:>\s*$|how can i help you today\?\s*$)/im,
  },
  codex: {
    approval: [
      /\bapproval required\b/i,
      /\bpermission required\b/i,
      /\ballow this action\b/i,
      /\bconfirm to continue\b/i,
      /\bapprove this action\b/i,
    ],
    input: [
      /\bselect an option\b/i,
      /\bchoose an option\b/i,
      /\bhow would you like to proceed\b/i,
      /\bwhich option\b/i,
      /\by\/n\b/i,
      /\byes\/no\b/i,
    ],
    ready: /(^|\n)\s*(?:›\s*$|>\s*$)/im,
  },
}

function findRecentLineDetail(
  buffer: string,
  patterns: readonly RegExp[],
): string | null {
  const lines = buffer
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-20)
    .reverse()

  for (const line of lines) {
    if (patterns.some((pattern) => pattern.test(line))) {
      return line
    }
  }

  return null
}

export class ManagedTerminalProviderAdapter {
  private activeTurnId: string | null = null
  private buffer = ''
  private nextRequestSequence = 1
  private nextTurnSequence = 1
  private openApproval: PendingRequestState | null = null
  private openUserInput: PendingRequestState | null = null
  private sessionState: ManagedSessionRuntimeState = 'connecting'

  public constructor(
    private readonly provider: ManagedProviderRuntimeProvider,
    private readonly mode: Exclude<TerminalLaunchMode, 'shell'>,
  ) {}

  public createSessionStartEvents(
    createdAt: string,
  ): ManagedProviderRuntimeEvent[] {
    return [
      {
        createdAt,
        provider: this.provider,
        type: 'session.started',
      },
      {
        createdAt,
        provider: this.provider,
        state: 'connecting',
        type: 'session.state.changed',
      },
    ]
  }

  public handleInput(
    data: string,
    updatedAt: string,
  ): ManagedProviderRuntimeEvent[] {
    if (!data.includes('\n') && !data.includes('\r')) {
      return []
    }

    const events: ManagedProviderRuntimeEvent[] = []

    if (this.openApproval) {
      events.push({
        createdAt: updatedAt,
        provider: this.provider,
        requestId: this.openApproval.requestId,
        type: 'request.resolved',
      })
      this.openApproval = null
    }

    if (this.openUserInput) {
      events.push({
        createdAt: updatedAt,
        provider: this.provider,
        requestId: this.openUserInput.requestId,
        type: 'user-input.resolved',
      })
      this.openUserInput = null
    }

    this.activeTurnId = `${this.provider}:turn:${this.nextTurnSequence++}`
    events.push({
      createdAt: updatedAt,
      provider: this.provider,
      turnId: this.activeTurnId,
      type: 'turn.started',
    })

    if (this.sessionState !== 'running') {
      this.sessionState = 'running'
      events.push({
        createdAt: updatedAt,
        provider: this.provider,
        state: 'running',
        type: 'session.state.changed',
      })
    }

    this.buffer = ''

    return events
  }

  public handleOutput(
    data: string,
    updatedAt: string,
  ): ManagedProviderRuntimeEvent[] {
    this.buffer = `${this.buffer}${data}`.slice(-MAX_BUFFER_LENGTH)
    const patterns = PROVIDER_PATTERNS[this.mode]
    const approvalDetail = findRecentLineDetail(this.buffer, patterns.approval)
    const inputDetail = findRecentLineDetail(this.buffer, patterns.input)
    const isReady = patterns.ready.test(this.buffer)
    const events: ManagedProviderRuntimeEvent[] = []

    if (approvalDetail) {
      if (this.openUserInput) {
        events.push({
          createdAt: updatedAt,
          provider: this.provider,
          requestId: this.openUserInput.requestId,
          type: 'user-input.resolved',
        })
        this.openUserInput = null
      }

      if (
        this.openApproval?.detail !== approvalDetail ||
        this.openApproval === null
      ) {
        this.openApproval = {
          detail: approvalDetail,
          requestId: `${this.provider}:approval:${this.nextRequestSequence++}`,
        }
        events.push({
          createdAt: updatedAt,
          detail: approvalDetail,
          provider: this.provider,
          requestId: this.openApproval.requestId,
          type: 'request.opened',
        })
      }

      if (this.sessionState !== 'waiting') {
        this.sessionState = 'waiting'
        events.push({
          createdAt: updatedAt,
          detail: approvalDetail,
          provider: this.provider,
          state: 'waiting',
          type: 'session.state.changed',
        })
      }

      return events
    }

    if (inputDetail) {
      if (this.openApproval) {
        events.push({
          createdAt: updatedAt,
          provider: this.provider,
          requestId: this.openApproval.requestId,
          type: 'request.resolved',
        })
        this.openApproval = null
      }

      if (
        this.openUserInput?.detail !== inputDetail ||
        this.openUserInput === null
      ) {
        this.openUserInput = {
          detail: inputDetail,
          requestId: `${this.provider}:input:${this.nextRequestSequence++}`,
        }
        events.push({
          createdAt: updatedAt,
          detail: inputDetail,
          provider: this.provider,
          requestId: this.openUserInput.requestId,
          type: 'user-input.requested',
        })
      }

      if (this.sessionState !== 'waiting') {
        this.sessionState = 'waiting'
        events.push({
          createdAt: updatedAt,
          detail: inputDetail,
          provider: this.provider,
          state: 'waiting',
          type: 'session.state.changed',
        })
      }

      return events
    }

    if (this.openApproval || this.openUserInput) {
      if (this.sessionState !== 'waiting') {
        this.sessionState = 'waiting'
        events.push({
          createdAt: updatedAt,
          detail:
            this.openApproval?.detail ??
            this.openUserInput?.detail ??
            undefined,
          provider: this.provider,
          state: 'waiting',
          type: 'session.state.changed',
        })
      }

      return events
    }

    if (isReady) {
      if (this.activeTurnId) {
        events.push({
          createdAt: updatedAt,
          provider: this.provider,
          state: 'completed',
          turnId: this.activeTurnId,
          type: 'turn.completed',
        })
        this.activeTurnId = null
      }

      if (this.sessionState !== 'ready') {
        this.sessionState = 'ready'
        events.push({
          createdAt: updatedAt,
          provider: this.provider,
          state: 'ready',
          type: 'session.state.changed',
        })
      }

      return events
    }

    if (this.activeTurnId && this.sessionState !== 'running') {
      this.sessionState = 'running'
      events.push({
        createdAt: updatedAt,
        provider: this.provider,
        state: 'running',
        type: 'session.state.changed',
      })
    }

    return events
  }

  public handleExit(
    exitCode: number | null,
    updatedAt: string,
  ): ManagedProviderRuntimeEvent[] {
    const events: ManagedProviderRuntimeEvent[] = []

    if (exitCode && exitCode !== 0) {
      events.push({
        createdAt: updatedAt,
        message: `Process exited with code ${exitCode}`,
        provider: this.provider,
        type: 'runtime.error',
      })
      this.sessionState = 'error'
    } else {
      this.sessionState = 'stopped'
    }

    events.push({
      createdAt: updatedAt,
      exitCode,
      provider: this.provider,
      type: 'session.exited',
    })

    return events
  }

  public handleLaunchFailure(
    message: string,
    updatedAt: string,
  ): ManagedProviderRuntimeEvent[] {
    this.sessionState = 'error'

    return [
      {
        createdAt: updatedAt,
        message,
        provider: this.provider,
        type: 'runtime.error',
      },
      {
        createdAt: updatedAt,
        detail: message,
        provider: this.provider,
        state: 'error',
        type: 'session.state.changed',
      },
    ]
  }
}

export class ManagedTerminalProviderProjector {
  private activeTurnStartedAt: string | null = null
  private detail: string | null = null
  private lastCompletedAt: string | null = null
  private lastError: string | null = null
  private lastErrorAt: string | null = null
  private lastSeenAt: string | null = null
  private readonly pendingApprovals = new Map<string, PendingRequestState>()
  private readonly pendingUserInputs = new Map<string, PendingRequestState>()
  private sessionState: ManagedSessionRuntimeState = 'connecting'

  public constructor(
    private readonly provider: ManagedProviderRuntimeProvider,
  ) {}

  public apply(events: readonly ManagedProviderRuntimeEvent[]): void {
    for (const event of events) {
      this.lastSeenAt = event.createdAt

      switch (event.type) {
        case 'session.started':
          this.sessionState = 'connecting'
          break
        case 'session.state.changed':
          this.sessionState = event.state
          if (event.detail) {
            this.detail = event.detail
          } else if (event.state !== 'waiting') {
            this.detail = null
          }
          break
        case 'session.exited':
          this.sessionState =
            event.exitCode && event.exitCode !== 0 ? 'error' : 'stopped'
          this.activeTurnStartedAt = null
          break
        case 'turn.started':
          this.activeTurnStartedAt = event.createdAt
          this.lastError = null
          this.lastErrorAt = null
          this.sessionState = 'running'
          break
        case 'turn.completed':
          this.activeTurnStartedAt = null
          if (event.state === 'completed') {
            this.lastCompletedAt = event.createdAt
            if (
              this.pendingApprovals.size === 0 &&
              this.pendingUserInputs.size === 0
            ) {
              this.sessionState = 'ready'
            }
          } else {
            this.lastError = event.errorMessage ?? `Turn ${event.state}`
            this.lastErrorAt = event.createdAt
            this.sessionState = 'error'
          }
          break
        case 'request.opened':
          this.pendingApprovals.set(event.requestId, {
            detail: event.detail ?? null,
            requestId: event.requestId,
          })
          this.detail = event.detail ?? null
          this.sessionState = 'waiting'
          break
        case 'request.resolved':
          this.pendingApprovals.delete(event.requestId)
          this.detail = this.resolvePendingDetail()
          if (
            this.pendingApprovals.size === 0 &&
            this.pendingUserInputs.size === 0
          ) {
            this.sessionState = this.activeTurnStartedAt ? 'running' : 'ready'
          }
          break
        case 'user-input.requested':
          this.pendingUserInputs.set(event.requestId, {
            detail: event.detail ?? null,
            requestId: event.requestId,
          })
          this.detail = event.detail ?? null
          this.sessionState = 'waiting'
          break
        case 'user-input.resolved':
          this.pendingUserInputs.delete(event.requestId)
          this.detail = this.resolvePendingDetail()
          if (
            this.pendingApprovals.size === 0 &&
            this.pendingUserInputs.size === 0
          ) {
            this.sessionState = this.activeTurnStartedAt ? 'running' : 'ready'
          }
          break
        case 'runtime.error':
          this.lastError = event.message
          this.lastErrorAt = event.createdAt
          this.detail = event.message
          this.sessionState = 'error'
          break
      }
    }
  }

  public getSnapshot(): ManagedSessionRuntimeSnapshot {
    return {
      activeTurnStartedAt: this.activeTurnStartedAt,
      detail: this.detail,
      hasPendingApproval: this.pendingApprovals.size > 0,
      hasPendingUserInput: this.pendingUserInputs.size > 0,
      lastCompletedAt: this.lastCompletedAt,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
      lastSeenAt: this.lastSeenAt,
      provider: this.provider,
      sessionState: this.sessionState,
    }
  }

  private resolvePendingDetail(): string | null {
    const approval = this.pendingApprovals.values().next().value as
      | PendingRequestState
      | undefined

    if (approval?.detail) {
      return approval.detail
    }

    const input = this.pendingUserInputs.values().next().value as
      | PendingRequestState
      | undefined

    return input?.detail ?? null
  }
}

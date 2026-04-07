import type { TerminalLaunchMode } from '../shared/terminal'
import type { WorkspaceActivityProvider } from '../shared/workspace-activity'

export type ManagedSessionRuntimeState =
  | 'connecting'
  | 'ready'
  | 'running'
  | 'waiting'
  | 'stopped'
  | 'error'

export interface ManagedSessionRuntimeSnapshot {
  activeTurnStartedAt: string | null
  detail: string | null
  hasPendingApproval: boolean
  hasPendingUserInput: boolean
  lastCompletedAt: string | null
  lastError: string | null
  lastErrorAt: string | null
  lastSeenAt: string | null
  provider: Exclude<WorkspaceActivityProvider, 'terminal'>
  sessionState: ManagedSessionRuntimeState
}

interface ProviderPatternSet {
  approval: RegExp[]
  input: RegExp[]
  ready: RegExp
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

export class ManagedTerminalProviderRuntime {
  private activeTurnStartedAt: string | null = null
  private buffer = ''
  private detail: string | null = null
  private hasPendingApproval = false
  private hasPendingUserInput = false
  private lastCompletedAt: string | null = null
  private lastError: string | null = null
  private lastErrorAt: string | null = null
  private lastSeenAt: string | null = null
  private sessionState: ManagedSessionRuntimeState = 'connecting'

  public constructor(
    private readonly provider: Exclude<WorkspaceActivityProvider, 'terminal'>,
    private readonly mode: Exclude<TerminalLaunchMode, 'shell'>,
  ) {}

  public getSnapshot(): ManagedSessionRuntimeSnapshot {
    return {
      activeTurnStartedAt: this.activeTurnStartedAt,
      detail: this.detail,
      hasPendingApproval: this.hasPendingApproval,
      hasPendingUserInput: this.hasPendingUserInput,
      lastCompletedAt: this.lastCompletedAt,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
      lastSeenAt: this.lastSeenAt,
      provider: this.provider,
      sessionState: this.sessionState,
    }
  }

  public handleInput(data: string, updatedAt: string): void {
    this.lastSeenAt = updatedAt

    if (!data.includes('\n') && !data.includes('\r')) {
      return
    }

    this.buffer = ''
    this.detail = null
    this.hasPendingApproval = false
    this.hasPendingUserInput = false
    this.lastError = null
    this.lastErrorAt = null
    this.activeTurnStartedAt = updatedAt
    this.sessionState = 'running'
  }

  public handleOutput(data: string, updatedAt: string): void {
    this.lastSeenAt = updatedAt
    this.buffer = `${this.buffer}${data}`.slice(-MAX_BUFFER_LENGTH)

    const patterns = PROVIDER_PATTERNS[this.mode]
    const approvalDetail = findRecentLineDetail(this.buffer, patterns.approval)

    if (approvalDetail) {
      this.detail = approvalDetail
      this.hasPendingApproval = true
      this.hasPendingUserInput = false
      this.sessionState = 'waiting'
      return
    }

    const inputDetail = findRecentLineDetail(this.buffer, patterns.input)

    if (inputDetail) {
      this.detail = inputDetail
      this.hasPendingApproval = false
      this.hasPendingUserInput = true
      this.sessionState = 'waiting'
      return
    }

    if (patterns.ready.test(this.buffer)) {
      if (this.activeTurnStartedAt) {
        this.lastCompletedAt = updatedAt
      }

      this.activeTurnStartedAt = null
      this.detail = null
      this.hasPendingApproval = false
      this.hasPendingUserInput = false
      this.sessionState = 'ready'
      return
    }

    this.detail = null
    this.hasPendingApproval = false
    this.hasPendingUserInput = false
    this.sessionState = this.activeTurnStartedAt ? 'running' : 'connecting'
  }

  public handleExit(exitCode: number | null, updatedAt: string): void {
    this.lastSeenAt = updatedAt

    if (exitCode && exitCode !== 0) {
      this.lastError = `Process exited with code ${exitCode}`
      this.lastErrorAt = updatedAt
      this.sessionState = 'error'
      return
    }

    this.activeTurnStartedAt = null
    this.hasPendingApproval = false
    this.hasPendingUserInput = false
    this.sessionState = 'stopped'
  }

  public handleLaunchFailure(message: string, updatedAt: string): void {
    this.detail = message
    this.lastError = message
    this.lastErrorAt = updatedAt
    this.lastSeenAt = updatedAt
    this.sessionState = 'error'
  }
}

import type {
  ManagedProviderRuntimeProvider,
  ManagedProviderRuntimeSessionState,
} from './provider-runtime'
import type { TerminalLaunchMode } from './terminal'

export type ManagedSessionProvider = ManagedProviderRuntimeProvider

export type ManagedSessionRequestType =
  | 'command-execution-approval'
  | 'file-change-approval'
  | 'file-read-approval'
  | 'dynamic-tool-call'
  | 'tool-user-input'
  | 'unknown'

export type ManagedSessionContentKind =
  | 'assistant-text'
  | 'reasoning-text'
  | 'reasoning-summary-text'
  | 'command-output'
  | 'file-change-output'
  | 'system'
  | 'user-prompt'

export interface ManagedSessionConfig {
  cwd: string
  mode: Exclude<TerminalLaunchMode, 'shell'>
  paneId: string
  sessionId: string
  workspaceId: string
}

export type ManagedSessionTurnState =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export interface ManagedSessionTurnSummary {
  completedAt: string | null
  id: string
  startedAt: string
  state: ManagedSessionTurnState
}

export interface ManagedSessionContentItem {
  id: string
  kind: ManagedSessionContentKind
  text: string
  turnId: string | null
  updatedAt: string
}

export interface ManagedSessionPendingApproval {
  detail: string | null
  id: string
  requestType: ManagedSessionRequestType
}

export interface ManagedSessionPromptOption {
  description?: string
  id: string
  label: string
}

export interface ManagedSessionUserQuestion {
  header?: string
  id: string
  options: ManagedSessionPromptOption[]
  prompt: string
}

export interface ManagedSessionPendingUserInput {
  detail: string | null
  id: string
  questions: ManagedSessionUserQuestion[]
}

export interface ManagedSessionUsage {
  cachedInputTokens?: number
  inputTokens: number
  maxTokens?: number
  outputTokens: number
}

export interface ManagedSessionSnapshot {
  content: ManagedSessionContentItem[]
  detail: string | null
  lastCompletedAt: string | null
  lastError: string | null
  paneId: string
  pendingApprovals: ManagedSessionPendingApproval[]
  pendingUserInputs: ManagedSessionPendingUserInput[]
  provider: ManagedSessionProvider
  running: boolean
  sessionId: string
  sessionState: ManagedProviderRuntimeSessionState
  turns: ManagedSessionTurnSummary[]
  updatedAt: string
  usage?: ManagedSessionUsage
  workspaceId: string
}

export type ManagedSessionDecision = 'accept' | 'accept-for-session' | 'deny'

export type ManagedSessionEvent =
  | {
      snapshot: ManagedSessionSnapshot
      type: 'snapshot'
    }
  | {
      sessionId: string
      type: 'removed'
    }

import type {
  ManagedProviderRuntimeProvider,
  ManagedProviderRuntimeSessionState,
} from './provider-runtime'
import type { ManagedSessionMode } from './terminal'

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

export type ManagedSessionEffort = 'high' | 'low' | 'max' | 'medium'

/**
 * Claude-only: an extra thinking budget on top of the base `effort` tier.
 * - `default` → no override, SDK uses the effort tier as-is.
 * - `extra` → enables thinking with a ~16K token budget (UI label "Max").
 * - `ultra` → enables thinking with a ~32K token budget (UI label "Ultrathink").
 */
export type ManagedSessionThinkingBudget = 'default' | 'extra' | 'ultra'

/**
 * Claude-only: UI hint for which context window to request. Not yet forwarded
 * to the Agent SDK — no first-class option in the SDK surface today. Stored to
 * persist user intent; runtime treats it as informational.
 */
export type ManagedSessionContextWindow = '200k' | '1m'

export type ManagedSessionPermissionMode =
  | 'acceptEdits'
  | 'bypassPermissions'
  | 'default'
  | 'plan'

export interface ManagedSessionConfig {
  /**
   * Claude-only: UI-stored context window preference. Currently informational —
   * the Claude Agent SDK does not expose a 1M-context flag in `Options`, so
   * this is persisted but not forwarded to the runtime.
   */
  contextWindow?: ManagedSessionContextWindow
  cwd: string
  effort?: ManagedSessionEffort
  /**
   * Codex-only: UI-stored "fast mode" toggle. Currently not forwarded — Codex
   * CLI's JSON-RPC `thread/start` schema does not expose a service tier knob.
   */
  fastMode?: boolean
  mode: ManagedSessionMode
  model?: string
  paneId: string
  permissionMode?: ManagedSessionPermissionMode
  sessionId: string
  /**
   * Claude-only: extra thinking-budget tier above the base effort level.
   * `default` is the no-op state. `extra` and `ultra` enable Claude SDK
   * `thinking: { type: 'enabled', budgetTokens }` on top of the effort tier.
   */
  thinkingBudget?: ManagedSessionThinkingBudget
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
  provider: ManagedSessionProvider
  startedAt: string
  state: ManagedSessionTurnState
}

export interface ManagedSessionContentItem {
  id: string
  kind: ManagedSessionContentKind
  provider: ManagedSessionProvider | null
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

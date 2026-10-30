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
  | 'plan-approval'
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

/** A provider-advertised reasoning effort identifier. */
export type ManagedSessionEffort = string

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

export type ManagedSessionInteractionMode = 'build' | 'plan'

export interface ManagedSessionConfig {
  /**
   * Claude-only: UI-stored context window preference. Currently informational —
   * the Claude Agent SDK does not expose a 1M-context flag in `Options`, so
   * this is persisted but not forwarded to the runtime.
   */
  contextWindow?: ManagedSessionContextWindow
  cwd: string
  effort?: ManagedSessionEffort
  interactionMode?: ManagedSessionInteractionMode
  mode: ManagedSessionMode
  model?: string
  paneId: string
  permissionMode?: ManagedSessionPermissionMode
  /** Codex app-server `model/list` service tier identifier. */
  serviceTier?: string
  sessionId: string
  /** A safe fallback explanation prepared by the main-process capability gate. */
  selectionNotice?: string | null
  /**
   * Claude-only: extra thinking-budget tier above the base effort level.
   * `default` is the no-op state. `extra` and `ultra` enable Claude SDK
   * `thinking: { type: 'enabled', budgetTokens }` on top of the effort tier.
   */
  thinkingBudget?: ManagedSessionThinkingBudget
  workspaceId: string
}

export interface ManagedSessionProviderSelection {
  effort?: ManagedSessionEffort
  mode: ManagedSessionMode
  model?: string
  serviceTier?: string
}

export type ManagedSessionTurnState =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

/**
 * Patch capture deliberately remains in the main process. Snapshots carry only
 * this small summary; the renderer requests the patch body when the user opens
 * a completed turn.
 */
export type ManagedSessionTurnDiffStatus =
  | 'capturing'
  | 'empty'
  | 'error'
  | 'ready'
  | 'truncated'

export type ManagedSessionTurnBinaryChanges = 'none' | 'present' | 'unknown'

export interface ManagedSessionTurnDiffSummary {
  binaryChanges: ManagedSessionTurnBinaryChanges
  changedFileCount: number
  message: string | null
  patchByteLength: number
  status: ManagedSessionTurnDiffStatus
}

export interface ManagedSessionTurnPatch extends ManagedSessionTurnDiffSummary {
  patch: string | null
  turnId: string
}

export interface ManagedSessionTurnSummary {
  completedAt: string | null
  diff: ManagedSessionTurnDiffSummary
  id: string
  provider: ManagedSessionProvider
  sequence: number
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

export interface ManagedSessionPlanApproval {
  detail: string | null
  id: string
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
  effort: ManagedSessionEffort | null
  interactionMode: ManagedSessionInteractionMode
  lastCompletedAt: string | null
  lastError: string | null
  lastErrorAt: string | null
  model: string | null
  paneId: string
  pendingApprovals: ManagedSessionPendingApproval[]
  pendingUserInputs: ManagedSessionPendingUserInput[]
  planApproval: ManagedSessionPlanApproval | null
  provider: ManagedSessionProvider
  revision: number
  running: boolean
  runtimeGeneration: number
  selectionNotice: string | null
  serviceTier: string | null
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
      revision: number
      snapshot: ManagedSessionSnapshot
      type: 'snapshot'
    }
  | {
      revision: number
      sessionId: string
      type: 'removed'
    }

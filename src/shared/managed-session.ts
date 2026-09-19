import type { ManagedSessionAgentConfig } from './conversation-routing'
import type { FleetState } from './fleet'
import type { JevGateOverrides } from './jev-gates'
import type { ManagedUsageReport, ManagedUsageSummary } from './managed-usage'
import type {
  ManagedProviderRuntimeProvider,
  ManagedProviderRuntimeSessionState,
  ManagedProviderRuntimeTask,
  ManagedProviderRuntimeToolCall,
  ManagedProviderRuntimeToolRequest,
} from './provider-runtime'
import type { ResolvedProviderSkill } from './provider-skills'
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
  | 'tool-call'
  | 'user-prompt'

export type ManagedSessionToolCall = ManagedProviderRuntimeToolCall

export type ManagedSessionTask = ManagedProviderRuntimeTask

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

export const MANAGED_SESSION_MAX_ATTACHMENTS = 8
export const MANAGED_SESSION_MAX_IMAGE_BYTES = 5 * 1024 * 1024
export const MANAGED_SESSION_MAX_TOTAL_IMAGE_BYTES = 10 * 1024 * 1024

export type ManagedSessionAttachment =
  | {
      data: string
      id: string
      kind: 'image'
      mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
      name: string
      sizeBytes: number
    }
  | {
      id: string
      kind: 'workspace-file'
      path: string
    }

export interface ManagedSessionProviderImage {
  data: string
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp'
  name: string
  path?: string
}

export interface ManagedSessionQueuedInput {
  attachments: ManagedSessionAttachment[]
  checkpointId?: string
  createdAt: string
  id: string
  lastError?: string
  recipients: string[]
  skill?: ResolvedProviderSkill
  text: string
}

export interface ManagedSessionConfig {
  agents?: readonly ManagedSessionAgentConfig[]
  /**
   * Claude-only: UI-stored context window preference. Currently informational —
   * the Claude Agent SDK does not expose a 1M-context flag in `Options`, so
   * this is persisted but not forwarded to the runtime.
   */
  contextWindow?: ManagedSessionContextWindow
  cwd: string
  effort?: ManagedSessionEffort
  interactionMode?: ManagedSessionInteractionMode
  /** Chat-level Jev gate overrides layered above workspace and global settings. */
  jevGates?: JevGateOverrides
  mode: ManagedSessionMode
  model?: string
  orchestratorSelection?: ManagedSessionProviderSelection
  paneId: string
  permissionMode?: ManagedSessionPermissionMode
  readOnly?: boolean
  /** Codex app-server `model/list` service tier identifier. */
  serviceTier?: string | null
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
  serviceTier?: string | null
}

export type ManagedSessionTurnState =
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export interface ManagedSessionTurnSummary {
  checkpointId?: string
  recipientAlias?: string
  requestText?: string
  completedAt: string | null
  id: string
  provider: ManagedSessionProvider
  startedAt: string
  state: ManagedSessionTurnState
}

export interface ManagedSessionContentItem {
  attachments?: ManagedSessionAttachment[]
  id: string
  kind: ManagedSessionContentKind
  phase?: 'commentary' | 'final_answer'
  model?: string | null
  provider: ManagedSessionProvider | null
  text: string
  /** Present only on `tool-call` items. */
  tool?: ManagedSessionToolCall
  turnId: string | null
  updatedAt: string
}

export type ManagedSessionToolRequest = ManagedProviderRuntimeToolRequest

export interface ManagedSessionPendingApproval {
  detail: string | null
  id: string
  request?: ManagedSessionToolRequest
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
  contextTokens?: number
  inputTokens: number
  maxTokens?: number
  outputTokens: number
}

export interface ManagedSessionSnapshot {
  pendingProviderSelection?: ManagedSessionProviderSelection
  preparingActivityId?: string
  fleet?: FleetState
  agents?: readonly ManagedSessionAgentConfig[]
  jevGates?: JevGateOverrides
  content: ManagedSessionContentItem[]
  detail: string | null
  effort: ManagedSessionEffort | null
  interactionMode: ManagedSessionInteractionMode
  lastCompletedAt: string | null
  lastError: string | null
  lastErrorAt: string | null
  model: string | null
  orchestratorSelection?: ManagedSessionProviderSelection
  paneId: string
  pendingApprovals: ManagedSessionPendingApproval[]
  pendingUserInputs: ManagedSessionPendingUserInput[]
  permissionMode: ManagedSessionPermissionMode
  planApproval: ManagedSessionPlanApproval | null
  provider: ManagedSessionProvider
  queuePaused?: boolean
  queuedInputs?: ManagedSessionQueuedInput[]
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
  usageReports?: ManagedUsageReport[]
  usageSummary?: ManagedUsageSummary
  workspaceId: string
}

export interface ManagedSessionPreparationResult {
  images: ManagedSessionProviderImage[]
  text: string
}

export interface PersistedManagedSession {
  config: ManagedSessionConfig
  snapshot: ManagedSessionSnapshot
}

export interface ManagedSessionHistoryItem {
  provider: ManagedSessionProvider | null
  role: 'assistant' | 'user'
  text: string
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

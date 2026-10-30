import type { ManagedSessionUsageLimit } from './managed-session'
import type { ManagedUsageReport } from './managed-usage'
import type { WorkspaceActivityProvider } from './workspace-activity'

export type ManagedProviderRuntimeProvider = Exclude<
  WorkspaceActivityProvider,
  'terminal'
>

export type ManagedProviderRuntimeSessionState =
  | 'connecting'
  | 'ready'
  | 'running'
  | 'waiting'
  | 'stopped'
  | 'error'

export type ManagedProviderRuntimeTurnState =
  | 'completed'
  | 'failed'
  | 'cancelled'
  | 'interrupted'

export type ManagedProviderRuntimeRequestType =
  | 'command-execution-approval'
  | 'file-change-approval'
  | 'file-read-approval'
  | 'plan-approval'
  | 'dynamic-tool-call'
  | 'tool-user-input'
  | 'unknown'

export type ManagedProviderRuntimeContentKind =
  | 'assistant-text'
  | 'reasoning-text'
  | 'reasoning-summary-text'
  | 'command-output'
  | 'file-change-output'
  | 'system'
  | 'tool-call'

/** One entry of a provider-reported task list. */
export interface ManagedProviderRuntimeTask {
  status: 'pending' | 'in_progress' | 'completed'
  subject: string
}

/** One provider tool invocation and everything known about it so far. */
export interface ManagedProviderRuntimeToolCall {
  callId: string
  command?: string
  diff?: string
  exitCode?: number
  files?: { path: string; status: string }[]
  input: unknown
  output?: string
  /** One-line status the provider reports while the call runs. */
  progress?: string
  status: 'running' | 'completed' | 'failed'
  /** Present only on task-list calls such as `TodoWrite`. */
  tasks?: ManagedProviderRuntimeTask[]
  toolName: string
}

/** The structured tool request behind an approval, rendered by the approval card. */
export interface ManagedProviderRuntimeToolRequest {
  command?: string
  cwd?: string
  diff?: string
  filePath?: string
  input?: unknown
  toolName: string
}

export interface ManagedProviderRuntimePromptOption {
  description?: string
  id: string
  label: string
}

export interface ManagedProviderRuntimeUserQuestion {
  header?: string
  id: string
  options: ManagedProviderRuntimePromptOption[]
  prompt: string
}

interface ManagedProviderRuntimeEventBase {
  createdAt: string
  provider: ManagedProviderRuntimeProvider
  runtimeGeneration?: number
}

export type ManagedProviderRuntimeEvent =
  | (ManagedProviderRuntimeEventBase & {
      type: 'session.started'
    })
  | (ManagedProviderRuntimeEventBase & {
      detail?: string
      state: ManagedProviderRuntimeSessionState
      type: 'session.state.changed'
    })
  | (ManagedProviderRuntimeEventBase & {
      exitCode: number | null
      type: 'session.exited'
    })
  | (ManagedProviderRuntimeEventBase & {
      /** Sends the CLI still held when it started this turn for them. */
      queuedSendCount?: number
      turnId: string
      type: 'turn.started'
    })
  | (ManagedProviderRuntimeEventBase & {
      errorMessage?: string
      state: ManagedProviderRuntimeTurnState
      turnId: string
      type: 'turn.completed'
    })
  | (ManagedProviderRuntimeEventBase & {
      detail?: string
      request?: ManagedProviderRuntimeToolRequest
      requestType?: ManagedProviderRuntimeRequestType
      requestId: string
      type: 'request.opened'
    })
  | (ManagedProviderRuntimeEventBase & {
      requestId: string
      type: 'request.resolved'
    })
  | (ManagedProviderRuntimeEventBase & {
      kind: ManagedProviderRuntimeContentKind
      phase?: 'commentary' | 'final_answer'
      model?: string
      itemId: string
      text: string
      /** invariant: the backend sends the full merged call, not a delta. */
      tool?: ManagedProviderRuntimeToolCall
      type: 'content.delta'
    })
  | (ManagedProviderRuntimeEventBase & {
      detail?: string
      questions?: ManagedProviderRuntimeUserQuestion[]
      requestId: string
      type: 'user-input.requested'
    })
  | (ManagedProviderRuntimeEventBase & {
      requestId: string
      type: 'user-input.resolved'
    })
  | (ManagedProviderRuntimeEventBase & {
      message: string
      type: 'runtime.error'
    })
  | (ManagedProviderRuntimeEventBase & {
      /** The reached limit, or null once the provider says usage is allowed again. */
      limit: ManagedSessionUsageLimit | null
      type: 'session.limit.updated'
    })
  | (ManagedProviderRuntimeEventBase & {
      cachedInputTokens?: number
      contextTokens?: number
      inputTokens: number
      maxTokens?: number
      outputTokens: number
      report?: Omit<ManagedUsageReport, 'runtimeGeneration'>
      type: 'session.usage.updated'
    })

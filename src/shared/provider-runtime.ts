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
      itemId: string
      text: string
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
      cachedInputTokens?: number
      inputTokens: number
      maxTokens?: number
      outputTokens: number
      type: 'session.usage.updated'
    })

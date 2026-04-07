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
      requestId: string
      type: 'request.opened'
    })
  | (ManagedProviderRuntimeEventBase & {
      requestId: string
      type: 'request.resolved'
    })
  | (ManagedProviderRuntimeEventBase & {
      detail?: string
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

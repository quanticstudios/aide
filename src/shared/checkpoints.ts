import type {
  ManagedSessionConfig,
  ManagedSessionSnapshot,
} from './managed-session'

export type CheckpointRestoreMode =
  | 'code-and-conversation'
  | 'conversation-only'

export interface TurnCheckpointChange {
  path: string
  previousPath?: string
  status:
    | 'added'
    | 'copied'
    | 'deleted'
    | 'modified'
    | 'renamed'
    | 'type-changed'
}

export interface TurnCheckpointSummary {
  capturedAt: string
  checkpointId: string
  sessionId: string
  workspaceId: string
}

export interface TurnCheckpointPreview {
  changes: TurnCheckpointChange[]
  checkpoint: TurnCheckpointSummary
  createdAt: string
  expiresAt: string
  previewId: string
  sessionRevision: number
  turnChanges: TurnCheckpointChange[] | null
}

export interface TurnCheckpointCaptureInput {
  config: ManagedSessionConfig
  editedPrompt: string
  snapshot: ManagedSessionSnapshot
}

export interface TurnCheckpointRestoreSeed {
  checkpointId: string
  config: ManagedSessionConfig
  editedPrompt: string
  mode: CheckpointRestoreMode
  snapshot: ManagedSessionSnapshot
  sourceSessionId: string
}

export interface TurnCheckpointRestoreResult {
  checkpointId: string
  editedPrompt: string
  mode: CheckpointRestoreMode
  sessionId: string
  sourceSessionId: string
}

export interface ManagedTurnCheckpointRecorder {
  captureTurn(input: TurnCheckpointCaptureInput): Promise<TurnCheckpointSummary>
  completeTurn(checkpointId: string): Promise<void>
}

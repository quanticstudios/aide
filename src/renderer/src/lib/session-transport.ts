import type {
  CheckpointRestoreMode,
  TurnCheckpointDiff,
  TurnCheckpointPreview,
  TurnCheckpointRestoreResult,
} from '../../../shared/checkpoints'
import type { AideApi } from '../../../shared/ipc'
import type {
  ManagedSessionAttachment,
  ManagedSessionConfig,
  ManagedSessionDecision,
  ManagedSessionInteractionMode,
  ManagedSessionPermissionMode,
  ManagedSessionProviderSelection,
  ManagedSessionQueueAction,
  ManagedSessionSnapshot,
} from '../../../shared/managed-session'
import type { ProviderSkillSelection } from '../../../shared/provider-skills'
import type { ManagedSessionUpdate } from './managed-session-events'

type SendInput = (
  sessionId: string,
  text: string,
  attachments?: readonly ManagedSessionAttachment[],
  selectedSkill?: ProviderSkillSelection,
) => Promise<void>

/**
 * Everything the renderer asks of the session backend: the session list, one session's snapshots, and every session command.
 * @remarks Command names are the web protocol's (ENG-2693). The backend picks start, steer or refuse for each `send`; `queue` holds a message until the running turn ends.
 */
export interface SessionTransport {
  /** Saved sessions, optionally filtered by a search query. */
  listSessions: AideApi['getTaskLibrary']
  /** Calls `listener` whenever the session list changes; returns the unsubscribe. */
  subscribeSessionList: (listener: () => void) => () => void
  /** Archives, pins, renames or marks a session read. */
  updateSession: AideApi['updateTaskMetadata']
  /** Streams one session's snapshots; returns the unsubscribe. */
  subscribeSession: (
    sessionId: string,
    listener: (update: ManagedSessionUpdate) => void,
  ) => () => void
  /** Snapshots of every live session, keyed by session id. */
  getSessions: () => Promise<Record<string, ManagedSessionSnapshot>>
  /** The saved snapshot of a session that is no longer live. */
  getSavedSession: AideApi['getTaskTranscript']
  start: (input: ManagedSessionConfig) => Promise<ManagedSessionSnapshot>
  send: SendInput
  queue: SendInput
  /** Edits, reorders, deletes, resumes, or promotes to steer the queued messages. */
  updateQueue: (
    sessionId: string,
    action: ManagedSessionQueueAction,
  ) => Promise<void>
  interrupt: (sessionId: string) => Promise<void>
  resolveApproval: (
    sessionId: string,
    requestId: string,
    decision: ManagedSessionDecision,
    reason?: string,
  ) => Promise<void>
  resolveInput: (
    sessionId: string,
    requestId: string,
    answers: Record<string, string | string[]>,
  ) => Promise<void>
  setModel: (
    sessionId: string,
    selection: ManagedSessionProviderSelection,
  ) => Promise<ManagedSessionSnapshot>
  setMode: (
    sessionId: string,
    interactionMode: ManagedSessionInteractionMode,
  ) => Promise<ManagedSessionSnapshot>
  setPermissionMode: (
    sessionId: string,
    permissionMode: ManagedSessionPermissionMode,
  ) => Promise<ManagedSessionSnapshot>
  fork: (sessionId: string, responseContentItemId: string) => Promise<void>
  implementPlanInNewThread: (
    sessionId: string,
    requestId: string,
  ) => Promise<void>
  getCheckpointDiff: (
    sessionId: string,
    checkpointId: string,
  ) => Promise<TurnCheckpointDiff>
  previewRewind: (
    sessionId: string,
    checkpointId: string,
  ) => Promise<TurnCheckpointPreview>
  rewind: (
    previewId: string,
    mode: CheckpointRestoreMode,
  ) => Promise<TurnCheckpointRestoreResult>
  close: (sessionId: string) => Promise<void>
}

let current: SessionTransport | null = null

/** Replaces the transport every session caller gets; `null` until the daemon transport starts. */
export function setSessionTransport(transport: SessionTransport | null): void {
  current = transport
}

/** The renderer's session transport, or `null` before the daemon transport starts. */
export function getSessionTransport(): SessionTransport | null {
  return current
}

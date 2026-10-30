import type { AideApi } from '../../../shared/ipc'
import {
  type ManagedSessionUpdate,
  subscribeManagedSession,
} from './managed-session-events'

/**
 * Everything the renderer asks of the session backend: the session list, one session's snapshots, and every session command.
 * @remarks Command names are the web protocol's (ENG-2693). Steer and queue have no command of their own: the backend picks start, steer or refuse for each `send`.
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
  getSessions: AideApi['getManagedSessionSnapshots']
  /** The saved snapshot of a session that is no longer live. */
  getSavedSession: AideApi['getTaskTranscript']
  start: AideApi['createManagedSession']
  send: AideApi['sendManagedSessionInput']
  interrupt: AideApi['interruptManagedSession']
  resolveApproval: AideApi['resolveManagedSessionRequest']
  resolveInput: AideApi['resolveManagedSessionUserInput']
  setModel: AideApi['switchManagedSessionProvider']
  setMode: AideApi['configureManagedSessionMode']
  setPermissionMode: AideApi['configureManagedSessionPermissionMode']
  setAgents: AideApi['configureManagedSessionAgents']
  fork: AideApi['branchManagedSession']
  getCheckpointDiff: AideApi['getTurnCheckpointDiff']
  previewRewind: AideApi['previewTurnCheckpointRestore']
  rewind: AideApi['restoreTurnCheckpoint']
  close: AideApi['closeManagedSession']
  acceptFleetNode: AideApi['acceptManagedFleetNode']
}

/** Wraps the Electron preload bridge. The only renderer code that may call its session methods. */
export function createIpcTransport(api: AideApi): SessionTransport {
  return {
    listSessions: (...args) => api.getTaskLibrary(...args),
    subscribeSessionList: (listener) => api.onTaskLibraryChanged(listener),
    updateSession: (...args) => api.updateTaskMetadata(...args),
    subscribeSession: (sessionId, listener) =>
      subscribeManagedSession(api, sessionId, listener),
    getSessions: () => api.getManagedSessionSnapshots(),
    getSavedSession: (...args) => api.getTaskTranscript(...args),
    start: (...args) => api.createManagedSession(...args),
    send: (...args) => api.sendManagedSessionInput(...args),
    interrupt: (...args) => api.interruptManagedSession(...args),
    resolveApproval: (...args) => api.resolveManagedSessionRequest(...args),
    resolveInput: (...args) => api.resolveManagedSessionUserInput(...args),
    setModel: (...args) => api.switchManagedSessionProvider(...args),
    setMode: (...args) => api.configureManagedSessionMode(...args),
    setPermissionMode: (...args) =>
      api.configureManagedSessionPermissionMode(...args),
    setAgents: (...args) => api.configureManagedSessionAgents(...args),
    fork: (...args) => api.branchManagedSession(...args),
    getCheckpointDiff: (...args) => api.getTurnCheckpointDiff(...args),
    previewRewind: (...args) => api.previewTurnCheckpointRestore(...args),
    rewind: (...args) => api.restoreTurnCheckpoint(...args),
    close: (...args) => api.closeManagedSession(...args),
    acceptFleetNode: (...args) => api.acceptManagedFleetNode(...args),
  }
}

let override: SessionTransport | null = null
const ipcTransports = new WeakMap<AideApi, SessionTransport>()

/** Replaces the transport every session caller gets; `null` restores the IPC one. */
export function setSessionTransport(transport: SessionTransport | null): void {
  override = transport
}

/** The renderer's session transport, or `null` when the preload bridge did not load. */
export function getSessionTransport(): SessionTransport | null {
  if (override) return override
  const api = typeof window === 'undefined' ? null : (window.aide ?? null)
  if (!api) return null
  let transport = ipcTransports.get(api)
  if (!transport) {
    transport = createIpcTransport(api)
    ipcTransports.set(api, transport)
  }
  return transport
}

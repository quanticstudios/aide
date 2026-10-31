import { useSyncExternalStore } from 'react'
import { version } from '../../../../package.json'
import type { AideApi } from '../../../shared/ipc'
import { createDaemonTransport, type DaemonTransport } from './daemon-transport'
import { createIpcTransport, setSessionTransport } from './session-transport'

/** Where sessions run: aide's own session manager, or pitwall's daemon over its web protocol. */
export type SessionBackend = 'built-in' | 'pitwall'

const STORAGE_KEY = 'aide.session-backend'
const CHAT_IDS_KEY = 'aide.pitwall-chat-ids'
const listeners = new Set<() => void>()
const taskOpenListeners = new Set<(sessionId: string) => void>()
let daemon: DaemonTransport | null = null

/**
 * Calls `listener` when the daemon backend asks to open one of its sessions.
 * @remarks main's `taskOpen` cannot do it: main checks its own task library, which has no pitwall chats.
 */
export function onDaemonTaskOpen(
  listener: (sessionId: string) => void,
): () => void {
  taskOpenListeners.add(listener)
  return () => {
    taskOpenListeners.delete(listener)
  }
}

/** The stored choice, else the default Electron main passed (`AIDE_SESSION_BACKEND`), else built-in. */
export function getSessionBackend(): SessionBackend {
  try {
    const stored =
      window.localStorage.getItem(STORAGE_KEY) ??
      window.aide?.defaultSessionBackend
    return stored === 'pitwall' ? 'pitwall' : 'built-in'
  } catch {
    return 'built-in'
  }
}

function applySessionBackend(): void {
  daemon?.dispose()
  daemon = null
  const api: AideApi | undefined = window.aide
  if (api && getSessionBackend() === 'pitwall') {
    const ipc = createIpcTransport(api)
    daemon = createDaemonTransport({
      chatIds: {
        load: () => {
          try {
            return JSON.parse(
              window.localStorage.getItem(CHAT_IDS_KEY) ?? '{}',
            ) as Record<string, string>
          } catch {
            return {}
          }
        },
        save: (chatIds) =>
          window.localStorage.setItem(CHAT_IDS_KEY, JSON.stringify(chatIds)),
      },
      clientVersion: version,
      getEndpoint: () => api.getPitwallEndpoint(),
      openTask: async (sessionId) => {
        for (const listener of taskOpenListeners) listener(sessionId)
      },
      getWorkspaces: async () =>
        (await api.getStorageSnapshot()).workspaces.map((workspace) => ({
          id: workspace.id,
          path: workspace.worktreePath,
        })),
      aideTasks: ipc,
      reportSession: (sessionId, snapshot) =>
        void api
          .reportDaemonSession(sessionId, snapshot)
          .catch(() => undefined),
    })
  }
  setSessionTransport(daemon)
  for (const listener of listeners) listener()
}

/** Stores the choice and swaps the session transport; built-in sessions stay in aide's database either way. */
export function setSessionBackend(backend: SessionBackend): void {
  window.localStorage.setItem(STORAGE_KEY, backend)
  applySessionBackend()
}

export function initializeSessionBackend(): void {
  applySessionBackend()
}

function subscribeSessionBackend(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** The active backend; re-renders after every switch. */
export function useSessionBackend(): SessionBackend {
  return useSyncExternalStore(
    subscribeSessionBackend,
    getSessionBackend,
    () => 'built-in',
  )
}

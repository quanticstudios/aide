import { useSyncExternalStore } from 'react'
import { version } from '../../../../package.json'
import type { AideApi } from '../../../shared/ipc'
import { createDaemonTransport, type DaemonTransport } from './daemon-transport'
import { createIpcTransport, setSessionTransport } from './session-transport'

/** Where sessions run: aide's own session manager, or pitwall's daemon over its web protocol. */
export type SessionBackend = 'built-in' | 'pitwall'

const STORAGE_KEY = 'aide.session-backend'
const CHAT_IDS_KEY = 'aide.pitwall-chat-ids'
const CLOSED_CHATS_KEY = 'aide.pitwall-closed-chats'
const NOTICE_KEY = 'aide.pitwall-default-notice-seen'
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

/** The stored choice, else the default Electron main passed (`AIDE_SESSION_BACKEND`), else pitwall. */
export function getSessionBackend(): SessionBackend {
  try {
    const stored =
      window.localStorage.getItem(STORAGE_KEY) ??
      window.aide?.defaultSessionBackend
    return stored === 'built-in' ? 'built-in' : 'pitwall'
  } catch {
    return 'pitwall'
  }
}

function isOnDefaultBackend(): boolean {
  return (
    window.localStorage.getItem(STORAGE_KEY) === null &&
    !window.aide?.defaultSessionBackend
  )
}

/** Whether to tell an upgraded install, once, that its sessions moved to pitwall and how to switch back. */
export function isDaemonDefaultNoticeDue(): boolean {
  try {
    return (
      isOnDefaultBackend() && window.localStorage.getItem(NOTICE_KEY) === null
    )
  } catch {
    return false
  }
}

export function dismissDaemonDefaultNotice(): void {
  window.localStorage.setItem(NOTICE_KEY, '1')
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
      closedChats: {
        load: () => {
          try {
            return JSON.parse(
              window.localStorage.getItem(CLOSED_CHATS_KEY) ?? '[]',
            ) as string[]
          } catch {
            return []
          }
        },
        save: (chats) =>
          window.localStorage.setItem(CLOSED_CHATS_KEY, JSON.stringify(chats)),
      },
      clientVersion: version,
      getEndpoint: () => api.getPitwallEndpoint(),
      resolveSkill: (workspaceId, skill) =>
        api.resolveProviderSkill(workspaceId, skill),
      openTask: async (sessionId) => {
        for (const listener of taskOpenListeners) listener(sessionId)
      },
      getWorkspaces: async () => {
        const { projects, workspaces } = await api.getStorageSnapshot()
        return workspaces.map((workspace) => ({
          id: workspace.id,
          path: workspace.worktreePath,
          label: workspace.name,
          branch: workspace.branchName,
          project: projects.find((p) => p.id === workspace.projectId)?.name,
        }))
      },
      aideTasks: ipc,
      subscribeLocalChanges: (listener) => ipc.subscribeSessionList(listener),
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
  try {
    // why: a fresh install never had built-in sessions, so nothing changed for it.
    if (isOnDefaultBackend() && !window.aide?.isExistingInstall) {
      dismissDaemonDefaultNotice()
    }
  } catch {}
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

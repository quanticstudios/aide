import { version } from '../../../../package.json'
import type { AideApi } from '../../../shared/ipc'
import { createDaemonTransport, type DaemonTransport } from './daemon-transport'
import { setSessionTransport } from './session-transport'

const CHAT_IDS_KEY = 'aide.pitwall-chat-ids'
const CLOSED_CHATS_KEY = 'aide.pitwall-closed-chats'
// why: 'built-in' here means the user went back to the built-in backend, which ENG-2898 removed.
const STORAGE_KEY = 'aide.session-backend'
const NOTICE_KEY = 'aide.pitwall-default-notice-seen'
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

/** Whether to tell an upgraded install, once, that its sessions now run on pitwall. */
export function isDaemonDefaultNoticeDue(): boolean {
  try {
    return (
      window.localStorage.getItem(NOTICE_KEY) === null ||
      window.localStorage.getItem(STORAGE_KEY) === 'built-in'
    )
  } catch {
    return false
  }
}

export function dismissDaemonDefaultNotice(): void {
  window.localStorage.setItem(NOTICE_KEY, '1')
  window.localStorage.removeItem(STORAGE_KEY)
}

/** Starts the daemon transport every session caller uses; sessions run on pitwall's daemon. */
export function initializeSessionBackend(): void {
  try {
    // why: a fresh install never had built-in sessions, so nothing changed for it.
    if (!window.aide?.isExistingInstall) dismissDaemonDefaultNotice()
  } catch {}
  daemon?.dispose()
  daemon = null
  const api: AideApi | undefined = window.aide
  if (api) {
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
      takeImportedOpenChats: () => api.takeImportedOpenSessions(),
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
      aideTasks: {
        listSessions: (...args) => api.getTaskLibrary(...args),
        updateSession: (...args) => api.updateTaskMetadata(...args),
      },
      subscribeLocalChanges: (listener) => api.onTaskLibraryChanged(listener),
      reportSession: (sessionId, snapshot) =>
        void api
          .reportDaemonSession(sessionId, snapshot)
          .catch(() => undefined),
    })
  }
  setSessionTransport(daemon)
}

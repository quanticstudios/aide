import type { PitwallEndpoint } from '../shared/ipc'
import type { ManagedSessionSnapshot } from '../shared/managed-session'
import type { AideDatabase, SessionImportCandidate } from './database'
import { taskTitle } from './task-library'

/** The `protocol` of pitwall's docs/web-protocol.md, as the renderer's daemon transport speaks it. */
const PROTOCOL = 1
/** pitwall closes on a frame over 16 MiB; a bigger session stays in aide's database and keeps the tables. */
const MAX_FRAME_BYTES = 16 * 1024 * 1024 - 64 * 1024
const CALL_TIMEOUT_MS = 30_000

export interface SessionImportResult {
  /** The backup taken before the session tables dropped, else null. */
  dropped: string | null
  /** Sessions pitwall does not hold yet; they stay in aide's database. */
  failed: string[]
  verified: number
}

export interface ImportSessionsOptions {
  appVersion: string
  /** Copies the database and returns the copy's path; runs only before a drop. */
  backup: () => string
  createSocket?: (url: string) => WebSocket
  database: Pick<
    AideDatabase,
    | 'dropImportedSessionTables'
    | 'listSessionImportCandidates'
    | 'recordSessionImport'
  >
  endpoint: PitwallEndpoint
  timeoutMs?: number
}

interface Daemon {
  call: (
    type: string,
    fields: Record<string, unknown>,
  ) => Promise<Record<string, unknown>>
  close: () => void
}

/**
 * Copies aide's stored sessions into pitwall as archived chats, reads each back, and drops aide's session tables once every one has been in pitwall for a release.
 * @remarks Idempotent and resumable: a session counts only after pitwall's copy reads back with its transcript, and a run sends only the ones not verified at their current `updated_at`. Throws when pitwall cannot be reached, which changes nothing.
 */
export async function importSessions(
  options: ImportSessionsOptions,
): Promise<SessionImportResult> {
  const pending = options.database
    .listSessionImportCandidates()
    .filter((candidate) => candidate.verifiedUpdatedAt !== candidate.updatedAt)
  const failed: string[] = []
  let verified = 0
  if (pending.length > 0) {
    const daemon = await connect(options)
    try {
      for (const candidate of pending) {
        if (await importOne(daemon, candidate)) {
          options.database.recordSessionImport(
            candidate.sessionId,
            candidate.updatedAt,
            options.appVersion,
          )
          verified += 1
        } else {
          failed.push(candidate.sessionId)
        }
      }
    } finally {
      daemon.close()
    }
  }
  return {
    dropped: options.database.dropImportedSessionTables(
      options.appVersion,
      options.backup,
    ),
    failed,
    verified,
  }
}

/** Sends one session and reads it back; false when pitwall refused it or its copy lacks part of the transcript. */
async function importOne(
  daemon: Daemon,
  { persisted, pinned, sessionId, title, updatedAt }: SessionImportCandidate,
): Promise<boolean> {
  if (!persisted) return false
  const { config, snapshot } = persisted
  const live = ['connecting', 'running', 'waiting'].includes(
    snapshot.sessionState,
  )
  // An archived chat has no provider behind it, so nothing in it may wait or run.
  const archived: ManagedSessionSnapshot = {
    ...snapshot,
    pendingApprovals: [],
    pendingUserInputs: [],
    planApproval: null,
    running: false,
    sessionState: live ? 'stopped' : snapshot.sessionState,
    turns: snapshot.turns.map((turn) =>
      turn.state === 'running'
        ? { ...turn, completedAt: updatedAt, state: 'interrupted' }
        : turn,
    ),
  }
  const fields = {
    sessionId,
    dir: config.cwd,
    provider: config.mode,
    model: config.model,
    effort: config.effort,
    permissionMode: config.permissionMode,
    title: taskTitle({ title }, snapshot),
    pinned,
    createdAt: rfc3339(
      snapshot.turns[0]?.startedAt ?? snapshot.content[0]?.createdAt,
    ),
    updatedAt: rfc3339(updatedAt),
    snapshot: archived,
  }
  if (Buffer.byteLength(JSON.stringify(fields)) > MAX_FRAME_BYTES) return false
  try {
    await daemon.call('import', fields)
    const read = await daemon.call('read', { sessionId, after: 0 })
    return holdsTranscript(
      read.snapshot as ManagedSessionSnapshot | undefined,
      snapshot,
    )
  } catch (error) {
    if (error instanceof DaemonGone) throw error
    return false
  }
}

/** Whether every item of aide's transcript is in pitwall's copy with the same text; a chat continued in pitwall may hold more. */
function holdsTranscript(
  copy: ManagedSessionSnapshot | undefined,
  original: ManagedSessionSnapshot,
): boolean {
  if (copy?.sessionId !== original.sessionId) return false
  const items = new Map(copy.content.map((item) => [item.id, item]))
  return original.content.every((item) => {
    const found = items.get(item.id)
    return found?.kind === item.kind && found.text === item.text
  })
}

function rfc3339(value: string | undefined): string | undefined {
  const time = value ? Date.parse(value) : Number.NaN
  return Number.isNaN(time) ? undefined : new Date(time).toISOString()
}

class DaemonGone extends Error {}

/** A connection to pitwall's web protocol that has said `hello` and can `import`. */
function connect(options: ImportSessionsOptions): Promise<Daemon> {
  const timeoutMs = options.timeoutMs ?? CALL_TIMEOUT_MS
  const ws = (options.createSocket ?? ((url) => new WebSocket(url)))(
    options.endpoint.url,
  )
  const pending = new Map<
    string,
    {
      reject: (error: Error) => void
      resolve: (data: Record<string, unknown>) => void
    }
  >()
  let nextId = 0
  const daemon: Daemon = {
    call: (type, fields) =>
      new Promise((resolve, reject) => {
        const id = String(++nextId)
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`pitwall did not answer ${type} in time.`))
        }, timeoutMs)
        pending.set(id, {
          reject: (error) => {
            clearTimeout(timer)
            reject(error)
          },
          resolve: (data) => {
            clearTimeout(timer)
            resolve(data)
          },
        })
        ws.send(JSON.stringify({ ...fields, type, id }))
      }),
    close: () => ws.close(1000),
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.close(1000)
      reject(new DaemonGone('pitwall did not say welcome in time.'))
    }, timeoutMs)
    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'hello',
          protocol: PROTOCOL,
          token: options.endpoint.token,
          client: { name: 'aide', version: options.appVersion },
        }),
      )
    }
    ws.onclose = (event) => {
      clearTimeout(timer)
      const error = new DaemonGone(
        `The connection to pitwall closed: ${event.reason || event.code}`,
      )
      for (const request of pending.values()) request.reject(error)
      pending.clear()
      reject(error)
    }
    ws.onmessage = (event) => {
      let message: Record<string, unknown>
      try {
        message = JSON.parse(String(event.data))
      } catch {
        return
      }
      if (message.type === 'welcome') {
        clearTimeout(timer)
        const capabilities = message.capabilities
        if (
          message.protocol !== PROTOCOL ||
          !Array.isArray(capabilities) ||
          !capabilities.includes('import')
        ) {
          ws.close(1000)
          reject(new Error('This pitwall cannot import sessions yet.'))
          return
        }
        resolve(daemon)
        return
      }
      if (message.type !== 'result' || typeof message.id !== 'string') return
      const request = pending.get(message.id)
      if (!request) return
      pending.delete(message.id)
      if (message.ok) {
        request.resolve((message.data as Record<string, unknown>) ?? {})
      } else {
        request.reject(
          new Error(String(message.message ?? message.code ?? 'refused')),
        )
      }
    }
  })
}

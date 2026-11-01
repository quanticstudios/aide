import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import type {
  ManagedSessionSnapshot,
  PersistedManagedSession,
} from '../shared/managed-session'
import { type AideDatabase, createAideDatabase } from './database'
import { backupBeforeSessionDrop } from './persistence-recovery'
import { importSessions } from './session-import'

const ENDPOINT = { token: 'f'.repeat(64), url: 'ws://127.0.0.1:1/ws' }

function session(
  workspaceId: string,
  sessionId: string,
  texts: string[],
  updatedAt = '2026-09-01T10:00:00.000Z',
): PersistedManagedSession {
  return {
    config: {
      cwd: '/workspace/app',
      mode: 'claude',
      model: 'claude-opus-5-5',
      paneId: `pane-${sessionId}`,
      sessionId,
      workspaceId,
    },
    snapshot: {
      content: texts.map((text, index) => ({
        createdAt: '2026-09-01T09:00:00.000Z',
        id: `${sessionId}-item-${index}`,
        kind: index % 2 === 0 ? 'user-prompt' : 'assistant-text',
        provider: 'claude',
        text,
        turnId: 'turn-1',
        updatedAt,
      })),
      detail: null,
      effort: null,
      interactionMode: 'build',
      lastCompletedAt: null,
      lastError: null,
      lastErrorAt: null,
      model: null,
      paneId: `pane-${sessionId}`,
      pendingApprovals: [],
      pendingUserInputs: [],
      permissionMode: 'default',
      planApproval: null,
      provider: 'claude',
      revision: 3,
      running: true,
      runtimeGeneration: 1,
      selectionNotice: null,
      serviceTier: null,
      sessionId,
      sessionState: 'running',
      turns: [
        {
          completedAt: null,
          id: 'turn-1',
          provider: 'claude',
          startedAt: '2026-09-01T09:00:00.000Z',
          state: 'running',
        },
      ],
      updatedAt,
      workspaceId,
    },
  }
}

interface FakePitwallOptions {
  capabilities?: string[]
  /** Answers `import` of these sessions with `ok: false`. */
  refuse?: Set<string>
  /** Drops the transcript's last item from these sessions, as a broken store would. */
  truncate?: Set<string>
  /** Closes the connection on the nth `import`. */
  closeOnImport?: number
}

/** pitwall's daemon as `importSessions` sees it: archived chats in a map, `import` and `read`. */
class FakePitwall {
  readonly chats = new Map<
    string,
    { pinned: boolean; title: string; snapshot: ManagedSessionSnapshot }
  >()
  imports = 0

  constructor(private readonly options: FakePitwallOptions = {}) {}

  createSocket = (): WebSocket => {
    const socket = {
      onclose: null as
        | ((event: { code: number; reason: string }) => void)
        | null,
      onmessage: null as ((event: { data: string }) => void) | null,
      onopen: null as (() => void) | null,
      close: () => {
        queueMicrotask(() => socket.onclose?.({ code: 1000, reason: '' }))
      },
      send: (data: string) => {
        queueMicrotask(() => this.receive(socket, JSON.parse(data)))
      },
    }
    queueMicrotask(() => socket.onopen?.())
    return socket as unknown as WebSocket
  }

  private receive(
    socket: {
      onclose: ((event: { code: number; reason: string }) => void) | null
      onmessage: ((event: { data: string }) => void) | null
    },
    frame: Record<string, unknown>,
  ): void {
    const reply = (message: Record<string, unknown>) =>
      socket.onmessage?.({ data: JSON.stringify(message) })
    const sessionId = frame.sessionId as string
    switch (frame.type) {
      case 'hello':
        reply({
          type: 'welcome',
          protocol: 1,
          deltaVersion: 1,
          server: { name: 'pitwall', version: 'test' },
          capabilities: this.options.capabilities ?? ['read', 'import'],
        })
        return
      case 'import': {
        this.imports += 1
        if (this.imports === this.options.closeOnImport) {
          socket.onclose?.({ code: 1001, reason: 'daemon exiting' })
          return
        }
        if (this.options.refuse?.has(sessionId)) {
          reply({
            type: 'result',
            id: frame.id,
            ok: false,
            code: 'invalid',
            message: 'no',
          })
          return
        }
        const snapshot = frame.snapshot as ManagedSessionSnapshot
        if (this.options.truncate?.has(sessionId)) snapshot.content.pop()
        this.chats.set(sessionId, {
          pinned: frame.pinned === true,
          snapshot,
          title: frame.title as string,
        })
        reply({
          type: 'result',
          id: frame.id,
          ok: true,
          data: { imported: true },
        })
        return
      }
      case 'read': {
        const chat = this.chats.get(sessionId)
        reply(
          chat
            ? {
                type: 'result',
                id: frame.id,
                ok: true,
                data: { seq: 1, snapshot: chat.snapshot, deltas: [] },
              }
            : {
                type: 'result',
                id: frame.id,
                ok: false,
                code: 'not-found',
                message: 'no chat',
              },
        )
      }
    }
  }
}

function countRows(databasePath: string): number {
  const copy = new DatabaseSync(databasePath, { readOnly: true })
  try {
    return (
      copy
        .prepare('SELECT COUNT(*) AS count FROM managed_session_snapshots')
        .get() as { count: number }
    ).count
  } finally {
    copy.close()
  }
}

describe('importSessions', () => {
  let directory: string
  let databasePath: string
  let database: AideDatabase
  let workspaceId: string

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'aide-session-import-'))
    databasePath = path.join(directory, 'aide.sqlite3')
    database = createAideDatabase(databasePath)
    const project = database.createProject({
      defaultBranch: 'main',
      name: 'app',
      remoteUrl: null,
      repoRoot: '/workspace/app',
    })
    workspaceId = database.createWorkspace({
      branchName: 'main',
      name: 'Main',
      projectId: project.id,
      windowId: null,
      worktreePath: '/workspace/app',
    }).id
    database.saveManagedSession(
      session(workspaceId, 'session-1', ['Fix the login form', 'Done.']),
    )
    database.saveManagedSession(
      session(workspaceId, 'session-2', ['Rename the button', 'Renamed.']),
    )
    database.updateTaskMetadata('session-2', {
      pinned: true,
      title: 'Button rename',
    })
  })

  afterEach(() => {
    database.close()
    rmSync(directory, { force: true, recursive: true })
  })

  function run(pitwall: FakePitwall, appVersion = '0.0.3') {
    return importSessions({
      appVersion,
      backup: () => backupBeforeSessionDrop(databasePath),
      createSocket: pitwall.createSocket,
      database,
      endpoint: ENDPOINT,
    })
  }

  it('imports every session with its title, pin and transcript, once, and drops the tables a release later behind a backup', async () => {
    const pitwall = new FakePitwall()
    expect(await run(pitwall)).toEqual({
      dropped: null,
      failed: [],
      verified: 2,
    })
    expect(pitwall.chats.get('session-1')?.title).toBe('Fix the login form')
    expect(pitwall.chats.get('session-2')?.title).toBe('Button rename')
    expect(pitwall.chats.get('session-1')?.pinned).toBe(false)
    expect(pitwall.chats.get('session-2')?.pinned).toBe(true)
    for (const stored of database.listManagedSessions()) {
      const chat = pitwall.chats.get(stored.config.sessionId)?.snapshot
      expect(chat?.content.map((item) => item.text)).toEqual(
        stored.snapshot.content.map((item) => item.text),
      )
      expect(chat).toMatchObject({ running: false, sessionState: 'stopped' })
      expect(chat?.turns[0]?.state).toBe('interrupted')
    }

    // Idempotent: nothing is sent again, and nothing drops in the release that imported.
    expect(await run(pitwall)).toEqual({
      dropped: null,
      failed: [],
      verified: 0,
    })
    expect(pitwall.imports).toBe(2)
    expect(database.listManagedSessions()).toHaveLength(2)

    const result = await run(pitwall, '0.0.4')
    expect(result.dropped).not.toBeNull()
    expect(result.verified).toBe(0)
    expect(database.listManagedSessions()).toEqual([])
    expect(database.listSessionImportCandidates()).toEqual([])
    const backup = result.dropped as string
    expect(existsSync(backup)).toBe(true)
    expect(path.dirname(backup)).toBe(path.join(directory, 'recovery'))
    expect(countRows(backup)).toBe(2)
    expect(await run(pitwall, '0.0.5')).toEqual({
      dropped: null,
      failed: [],
      verified: 0,
    })
  })

  it('hands the daemon transport each session aide had open, once, also after the tables drop', async () => {
    database.updateTaskMetadata('session-1', { archived: true })
    const pitwall = new FakePitwall()
    expect(database.takeImportedOpenSessions()).toEqual([])
    await run(pitwall)
    expect(database.takeImportedOpenSessions()).toEqual(['session-2'])
    expect(database.takeImportedOpenSessions()).toEqual([])

    database.saveManagedSession(
      session(workspaceId, 'session-3', ['Add a test', 'Added.']),
    )
    expect((await run(pitwall, '0.0.4')).dropped).toBeNull()
    expect((await run(pitwall, '0.0.5')).dropped).not.toBeNull()
    expect(database.takeImportedOpenSessions()).toEqual(['session-3'])
  })

  it('keeps every session in aide when pitwall refuses one or loses part of a transcript, and finishes on a later run', async () => {
    const broken = new FakePitwall({
      refuse: new Set(['session-1']),
      truncate: new Set(['session-2']),
    })
    expect(await run(broken, '0.0.3')).toEqual({
      dropped: null,
      failed: ['session-1', 'session-2'],
      verified: 0,
    })
    expect(await run(broken, '0.0.4')).toMatchObject({ dropped: null })
    expect(database.listManagedSessions()).toHaveLength(2)

    const fixed = new FakePitwall()
    expect(await run(fixed, '0.0.4')).toEqual({
      dropped: null,
      failed: [],
      verified: 2,
    })
    expect((await run(fixed, '0.0.5')).dropped).not.toBeNull()
  })

  it('changes nothing when pitwall goes away mid-import, and resumes from the sessions it verified', async () => {
    const flaky = new FakePitwall({ closeOnImport: 2 })
    await expect(run(flaky)).rejects.toThrow('daemon exiting')
    expect(database.listManagedSessions()).toHaveLength(2)
    expect(
      database
        .listSessionImportCandidates()
        .map((candidate) => candidate.verifiedUpdatedAt !== null),
    ).toEqual([true, false])

    const pitwall = new FakePitwall()
    expect(await run(pitwall)).toMatchObject({ verified: 1 })
    expect(pitwall.imports).toBe(1)
  })

  it('refuses a pitwall without import and leaves the database as it was', async () => {
    await expect(
      run(new FakePitwall({ capabilities: ['read'] })),
    ).rejects.toThrow('cannot import')
    expect(database.listSessionImportCandidates()).toHaveLength(2)
  })

  it('imports a session again when it changed after its import, and waits a release before dropping it', async () => {
    const pitwall = new FakePitwall()
    await run(pitwall, '0.0.3')
    database.saveManagedSession(
      session(
        workspaceId,
        'session-1',
        ['Fix the login form', 'Done.', 'And the signup form', 'Done too.'],
        '2026-09-02T10:00:00.000Z',
      ),
    )
    expect(await run(pitwall, '0.0.4')).toEqual({
      dropped: null,
      failed: [],
      verified: 1,
    })
    expect(pitwall.chats.get('session-1')?.snapshot.content).toHaveLength(4)
    expect((await run(pitwall, '0.0.5')).dropped).not.toBeNull()
  })

  it('keeps the tables while a stored session no longer parses', async () => {
    const raw = new DatabaseSync(databasePath)
    raw.exec(
      `INSERT INTO managed_session_snapshots (session_id, workspace_id, pane_id, payload_json, updated_at)
       VALUES ('broken', '${workspaceId}', 'pane', '{"config":{}}', '2026-09-03T00:00:00.000Z')`,
    )
    raw.close()
    const pitwall = new FakePitwall()
    expect(await run(pitwall, '0.0.3')).toMatchObject({ failed: ['broken'] })
    expect(await run(pitwall, '0.0.4')).toMatchObject({ dropped: null })
    expect(countRows(databasePath)).toBe(3)
  })

  it('brings the session tables back when a built-in session is saved after the drop', async () => {
    const pitwall = new FakePitwall()
    await run(pitwall, '0.0.3')
    await run(pitwall, '0.0.4')
    expect(database.getTaskMetadata('session-1').title).toBeNull()
    database.saveManagedSession(session(workspaceId, 'session-3', ['Later']))
    expect(database.listManagedSessions()).toHaveLength(1)
    expect(await run(pitwall, '0.0.4')).toMatchObject({
      verified: 1,
      dropped: null,
    })
  })
})

// @vitest-environment happy-dom
import { setTimeout as sleep } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'

import { diffSnapshots } from '../../../main/managed-session-ipc'
import type { ManagedSessionIpcEvent } from '../../../shared/ipc'
import type { ManagedSessionSnapshot } from '../../../shared/managed-session'

const commits = { count: 0 }
// why: React reads the DevTools hook once when react-dom loads, so the stub must exist before the dynamic imports.
Object.assign(globalThis, {
  __REACT_DEVTOOLS_GLOBAL_HOOK__: {
    checkDCE() {},
    inject: () => 1,
    isDisabled: false,
    onCommitFiberRoot() {
      commits.count += 1
    },
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    onScheduleFiberRoot() {},
    renderers: new Map(),
    supportsFiber: true,
  },
})
const { createElement } = await import('react')
const { createRoot } = await import('react-dom/client')
const { default: FleetDrawer } = await import('./FleetDrawer')

function snapshot(revision: number, text: string): ManagedSessionSnapshot {
  return {
    content: [
      {
        id: 'reply',
        kind: 'assistant-text',
        provider: 'codex',
        text,
        turnId: 'turn-1',
        updatedAt: '2026-10-24T10:00:00.000Z',
      },
    ],
    detail: null,
    effort: null,
    interactionMode: 'build',
    lastCompletedAt: null,
    lastError: null,
    lastErrorAt: null,
    model: null,
    paneId: 'pane-1',
    pendingApprovals: [],
    pendingUserInputs: [],
    permissionMode: 'default',
    planApproval: null,
    provider: 'codex',
    revision,
    running: true,
    runtimeGeneration: 1,
    selectionNotice: null,
    serviceTier: null,
    sessionId: 'session-1',
    sessionState: 'running',
    turns: [],
    updatedAt: '2026-10-24T10:00:00.000Z',
    workspaceId: 'workspace-1',
  } as ManagedSessionSnapshot
}

let unmount = () => {}
afterEach(() => unmount())

/** Mounts the drawer over a fake bridge, streams 20 token deltas, and returns the React commits they caused. */
async function countStreamingCommits(isOpen: boolean): Promise<number> {
  let emit: (event: ManagedSessionIpcEvent) => void = () => {}
  let main = { seq: 1, snapshot: snapshot(1, 'a') }
  Object.assign(window, {
    aide: {
      getManagedSessionSnapshots: async () => ({}),
      getTaskTranscript: async () => null,
      onManagedSessionEvent: (
        callback: (event: ManagedSessionIpcEvent) => void,
      ) => {
        emit = callback
        return () => {}
      },
      syncManagedSession: async () => main,
    },
  })
  const root = createRoot(document.createElement('div'))
  unmount = () => root.unmount()
  root.render(
    createElement(FleetDrawer, {
      isOpen,
      jevGates: null,
      onClose: () => {},
      sessionId: 'session-1',
    }),
  )
  await sleep(20)

  const before = commits.count
  for (let revision = 2; revision <= 21; revision += 1) {
    const next = snapshot(revision, 'a'.repeat(revision))
    const deltas = diffSnapshots(main, next)
    main = { seq: deltas.at(-1)?.seq ?? main.seq, snapshot: next }
    // why: each IPC message arrives in its own task, outside the frame flush.
    emit({ deltas, sessionId: 'session-1', type: 'deltas' })
    await sleep(1)
  }
  return commits.count - before
}

describe('FleetDrawer', () => {
  it('commits while open and its session streams', async () => {
    expect(await countStreamingCommits(true)).toBeGreaterThan(0)
  })

  it('does not commit while closed and its session streams', async () => {
    expect(await countStreamingCommits(false)).toBe(0)
  })
})

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const rendererRoot = fileURLToPath(new URL('..', import.meta.url))
const ipcTypes = readFileSync(
  fileURLToPath(new URL('../../../shared/ipc.ts', import.meta.url)),
  'utf8',
)

// why: sessions run on pitwall's daemon; main no longer answers any of these (ENG-2898).
const REMOVED_SESSION_BRIDGE_METHODS = [
  'acceptManagedFleetNode',
  'branchManagedSession',
  'closeManagedSession',
  'configureManagedSessionAgents',
  'configureManagedSessionJevGates',
  'configureManagedSessionMode',
  'configureManagedSessionPermissionMode',
  'createManagedSession',
  'getManagedSessionSnapshots',
  'getTurnCheckpointDiff',
  'implementManagedSessionPlanInNewThread',
  'interruptManagedSession',
  'listTurnCheckpoints',
  'onManagedSessionEvent',
  'previewTurnCheckpointRestore',
  'queueManagedSessionInput',
  'resolveManagedSessionRequest',
  'resolveManagedSessionUserInput',
  'restoreTurnCheckpoint',
  'sendManagedSessionInput',
  'switchManagedSessionProvider',
  'syncManagedSession',
  'updateManagedSessionQueue',
]

// aide's own task library (titles, pins, archive, unread), which the daemon transport merges into pitwall's list.
const TASK_LIBRARY_BRIDGE_METHODS = [
  'getTaskLibrary',
  'getTaskTranscript',
  'onTaskLibraryChanged',
  'updateTaskMetadata',
]

describe('session bridge', () => {
  it('has none of the built-in backend session methods', () => {
    for (const method of REMOVED_SESSION_BRIDGE_METHODS) {
      expect(ipcTypes).not.toMatch(new RegExp(`\\b${method}:`))
    }
  })

  it('reaches the task library only from the transport types and the daemon wiring', () => {
    const pattern = new RegExp(
      `\\b(${TASK_LIBRARY_BRIDGE_METHODS.join('|')})\\b`,
    )
    const offenders = readdirSync(rendererRoot, { recursive: true })
      .map(String)
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .map((file) => relative(rendererRoot, join(rendererRoot, file)))
      .filter(
        (file) =>
          !['lib/session-backend.ts', 'lib/session-transport.ts'].includes(
            file,
          ),
      )
      .flatMap((file) => {
        const match = pattern.exec(
          readFileSync(join(rendererRoot, file), 'utf8'),
        )
        return match ? [`${file}: ${match[1]}`] : []
      })

    expect(offenders).toEqual([])
  })
})

import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'

import type { AideApi } from '../../../shared/ipc'
import { createIpcTransport } from './session-transport'

const rendererRoot = fileURLToPath(new URL('..', import.meta.url))
const ipcTypes = readFileSync(
  fileURLToPath(new URL('../../../shared/ipc.ts', import.meta.url)),
  'utf8',
)

// why: workspace file pickers, task notifications and onTaskOpen/openTask are app-shell calls, not session ones, so they stay on window.aide.
const SESSION_BRIDGE_METHODS = [
  'acceptManagedFleetNode',
  'branchManagedSession',
  'closeManagedSession',
  'configureManagedSessionAgents',
  'configureManagedSessionJevGates',
  'configureManagedSessionMode',
  'configureManagedSessionPermissionMode',
  'createManagedSession',
  'getManagedSessionSnapshots',
  'getTaskLibrary',
  'getTaskTranscript',
  'getTurnCheckpointDiff',
  'implementManagedSessionPlanInNewThread',
  'interruptManagedSession',
  'listTurnCheckpoints',
  'onManagedSessionEvent',
  'onTaskLibraryChanged',
  'previewTurnCheckpointRestore',
  'queueManagedSessionInput',
  'resolveManagedSessionRequest',
  'resolveManagedSessionUserInput',
  'restoreTurnCheckpoint',
  'sendManagedSessionInput',
  'switchManagedSessionProvider',
  'syncManagedSession',
  'updateManagedSessionQueue',
  'updateTaskMetadata',
]

// IpcTransport and the delta hub it feeds from the bridge.
const ALLOWED_FILES = [
  'lib/session-transport.ts',
  'lib/managed-session-events.ts',
]

describe('session bridge calls', () => {
  it('names methods the bridge still has', () => {
    for (const method of SESSION_BRIDGE_METHODS) {
      expect(ipcTypes).toMatch(new RegExp(`\\b${method}:`))
    }
  })

  it('happen only inside IpcTransport', () => {
    const pattern = new RegExp(`\\b(${SESSION_BRIDGE_METHODS.join('|')})\\b`)
    const offenders = readdirSync(rendererRoot, { recursive: true })
      .map(String)
      .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
      .map((file) => relative(rendererRoot, join(rendererRoot, file)))
      .filter((file) => !ALLOWED_FILES.includes(file))
      .flatMap((file) => {
        const match = pattern.exec(
          readFileSync(join(rendererRoot, file), 'utf8'),
        )
        return match ? [`${file}: ${match[1]}`] : []
      })

    expect(offenders).toEqual([])
  })
})

describe('createIpcTransport', () => {
  it('forwards commands with the arguments it was given', async () => {
    const api = {
      interruptManagedSession: vi.fn(async () => undefined),
      sendManagedSessionInput: vi.fn(async () => undefined),
    } as unknown as AideApi
    const transport = createIpcTransport(api)

    await transport.send('session-1', 'hi')
    await transport.interrupt('session-1')

    expect(api.sendManagedSessionInput).toHaveBeenCalledWith('session-1', 'hi')
    expect(vi.mocked(api.interruptManagedSession).mock.calls).toEqual([
      ['session-1'],
    ])
  })
})

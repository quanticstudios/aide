import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { DiagnosticsService } from './diagnostics-service'

const temporaryDirectories: string[] = []

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(path.join(tmpdir(), 'aide-diagnostics-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

function createService(directory: string): DiagnosticsService {
  return new DiagnosticsService({
    logDirectory: directory,
    maxLogBytes: 80,
    maxLogFiles: 2,
    now: () => new Date('2026-07-13T12:00:00.000Z'),
    runtime: {
      appName: 'aide',
      appVersion: '0.1.0',
      arch: 'x64',
      chromeVersion: '138.0.0.0',
      electronVersion: '43.0.0',
      nodeVersion: '24.17.0',
      platform: 'linux',
    },
  })
}

describe('DiagnosticsService', () => {
  it('records only structured events and rotates local logs', () => {
    const directory = createTemporaryDirectory()
    const service = createService(directory)

    service.record('main-uncaught-exception')
    service.record('renderer-exception')
    service.record('renderer-unhandled-rejection')
    service.record('terminal output: token=secret' as never)

    expect(service.getSnapshot()).toMatchObject({
      revision: 3,
      version: 1,
      recentEvents: [
        { type: 'main-uncaught-exception' },
        { type: 'renderer-exception' },
        { type: 'renderer-unhandled-rejection' },
      ],
    })
    expect(readdirSync(directory)).toEqual(
      expect.arrayContaining(['diagnostics.jsonl', 'diagnostics.1.jsonl']),
    )
    expect(
      readFileSync(path.join(directory, 'diagnostics.jsonl'), 'utf8'),
    ).not.toContain('token=secret')
  })

  it('writes a ZIP with only the redacted snapshot and event records', () => {
    const directory = createTemporaryDirectory()
    const service = createService(directory)
    const destination = path.join(directory, 'support.zip')

    service.record('renderer-exception')
    service.exportSupportBundle(destination)

    const bundle = readFileSync(destination)
    const bundleText = bundle.toString('utf8')

    expect(bundle.subarray(0, 4)).toEqual(Buffer.from([0x50, 0x4b, 0x03, 0x04]))
    expect(bundleText).toContain('diagnostics.json')
    expect(bundleText).toContain('events.jsonl')
    expect(bundleText).toContain('renderer-exception')
    expect(bundleText).not.toContain('/home/')
    expect(bundleText).not.toContain('process.env')
  })

  it('restores allowlisted crash events from local logs after relaunch', () => {
    const directory = createTemporaryDirectory()
    const firstService = createService(directory)
    firstService.record('main-uncaught-exception')

    const relaunchedService = createService(directory)

    expect(relaunchedService.getSnapshot().recentEvents).toEqual([
      {
        occurredAt: '2026-07-13T12:00:00.000Z',
        type: 'main-uncaught-exception',
      },
    ])
    expect(relaunchedService.getSnapshot().revision).toBe(1)
  })

  it('ignores malformed and non-allowlisted persisted log records', () => {
    const directory = createTemporaryDirectory()
    writeFileSync(
      path.join(directory, 'diagnostics.jsonl'),
      [
        JSON.stringify({
          occurredAt: '2026-07-13T11:59:00.000Z',
          type: 'main-uncaught-exception',
        }),
        '{not-json}',
        JSON.stringify({
          occurredAt: '2026-07-13T12:00:00.000Z',
          payload: 'token=secret',
          type: 'unknown-event',
        }),
        JSON.stringify({
          occurredAt: '2026-07-13T12:00:00.000Z',
          type: 'renderer-crashed',
        }),
      ].join('\n'),
    )

    expect(createService(directory).getSnapshot().recentEvents).toEqual([
      {
        occurredAt: '2026-07-13T11:59:00.000Z',
        type: 'main-uncaught-exception',
      },
      {
        occurredAt: '2026-07-13T12:00:00.000Z',
        type: 'renderer-crashed',
      },
    ])
  })
})

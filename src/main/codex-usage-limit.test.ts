import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import {
  CodexManagedSessionBackend,
  ManagedSessionManager,
} from './managed-session-manager'

it('reads the Codex reset time after a turn fails on the usage limit', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'aide-codex-limit-'))
  const executable = path.join(directory, 'codex-fixture.cjs')
  writeFileSync(
    executable,
    `#!${process.execPath}
const readline = require('node:readline');
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  const request = JSON.parse(line);
  if (request.id === undefined) return;
  if (request.method === 'thread/start') {
    send({ id: request.id, result: { thread: { id: 'thread' }, model: 'codex-test' } });
    return;
  }
  if (request.method === 'account/rateLimits/read') {
    send({ id: request.id, result: { rateLimits: { limitId: 'codex', primary: { usedPercent: 100, windowDurationMins: 300, resetsAt: 1792767600 }, secondary: null } } });
    return;
  }
  if (request.method === 'turn/start') {
    send({ method: 'turn/started', params: { turn: { id: 'turn' } } });
    send({ method: 'turn/completed', params: { turn: { id: 'turn', status: 'failed', error: { message: "You've hit your usage limit.", codexErrorInfo: 'usageLimitExceeded' } } } });
  }
  send({ id: request.id, result: {} });
});
`,
  )
  chmodSync(executable, 0o755)
  vi.stubEnv('AIDE_CODEX_COMMAND', executable)
  const manager = new ManagedSessionManager({
    createBackend: (config, emit) =>
      new CodexManagedSessionBackend(config, emit, () =>
        new Date().toISOString(),
      ),
    onRuntimeEvent: () => undefined,
    onUpdate: () => undefined,
  })
  try {
    await manager.createSession({
      cwd: directory,
      mode: 'codex',
      paneId: 'pane',
      sessionId: 'session',
      workspaceId: 'workspace',
    })
    await manager.sendInput('session', 'Hello')
    await vi.waitFor(() =>
      expect(manager.getSnapshots().session.usageLimit).toEqual({
        label: '5-hour limit',
        limitId: 'codex',
        provider: 'codex',
        resetsAt: '2026-10-23T15:00:00.000Z',
      }),
    )
    expect(manager.getSnapshots().session.lastError).toBe(
      "You've hit your usage limit.",
    )
  } finally {
    await manager.closeAll()
    vi.unstubAllEnvs()
    rmSync(directory, { force: true, recursive: true })
  }
})

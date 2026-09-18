import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { expect, it, vi } from 'vitest'
import {
  CodexManagedSessionBackend,
  ManagedSessionManager,
} from './managed-session-manager'

it('preserves Codex message phases from lifecycle events without duplicating streamed text', async () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'aide-codex-phase-'))
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
  if (request.method === 'turn/start') {
    send({ method: 'turn/started', params: { turn: { id: 'turn' } } });
    for (const [id, phase, text] of [['progress', 'commentary', 'Checking.'], ['answer', 'final_answer', 'Tokyo.'], ['unknown', null, 'Legacy.']]) {
      send({ method: 'item/started', params: { item: { id, type: 'agentMessage', phase: id === 'answer' ? null : phase } } });
      if (id !== 'unknown') send({ method: 'item/agentMessage/delta', params: { itemId: id, delta: text } });
      send({ method: 'item/completed', params: { item: { id, type: 'agentMessage', phase, text } } });
    }
    send({ method: 'turn/completed', params: { turn: { id: 'turn', status: 'completed' } } });
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
    await manager.sendInput('session', 'What is the capital of Japan?')
    const messages = manager
      .getSnapshots()
      .session.content.filter((item) => item.kind === 'assistant-text')
    expect(messages).toEqual([
      expect.objectContaining({
        id: 'progress',
        phase: 'commentary',
        text: 'Checking.',
      }),
      expect.objectContaining({
        id: 'answer',
        phase: 'final_answer',
        text: 'Tokyo.',
      }),
      expect.objectContaining({
        id: 'unknown',
        phase: undefined,
        text: 'Legacy.',
      }),
    ])
  } finally {
    await manager.closeAll()
    vi.unstubAllEnvs()
    rmSync(directory, { force: true, recursive: true })
  }
})

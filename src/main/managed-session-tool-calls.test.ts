import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const { query } = vi.hoisted(() => ({ query: vi.fn() }))

vi.mock('@anthropic-ai/claude-agent-sdk', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  query,
}))

import {
  CodexManagedSessionBackend,
  ManagedSessionManager,
} from './managed-session-manager'

function createClaudeToolQuery(prompt: AsyncIterable<unknown>) {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        model: 'claude-test',
        subtype: 'init',
        type: 'system',
        uuid: 'init-event',
      }
      await prompt[Symbol.asyncIterator]().next()
      yield {
        message: {
          id: 'assistant-1',
          content: [
            {
              id: 'call-1',
              input: { command: 'echo hello', description: 'Greet' },
              name: 'Bash',
              type: 'tool_use',
            },
          ],
          model: 'claude-test',
          usage: { input_tokens: 1, output_tokens: 1 },
        },
        parent_tool_use_id: null,
        session_id: 'session',
        type: 'assistant',
        uuid: 'assistant-event',
      }
      yield {
        message: {
          content: [
            {
              content: 'hello',
              is_error: false,
              tool_use_id: 'call-1',
              type: 'tool_result',
            },
          ],
          role: 'user',
        },
        parent_tool_use_id: null,
        session_id: 'session',
        type: 'user',
        uuid: 'user-event',
      }
      yield {
        modelUsage: {},
        session_id: 'session',
        subtype: 'success',
        total_cost_usd: 0,
        type: 'result',
        uuid: 'result-event',
      }
    },
    close: vi.fn(),
    interrupt: vi.fn(),
  }
}

function createClaudeQuery(
  prompt: AsyncIterable<unknown>,
  messages: unknown[],
) {
  return {
    async *[Symbol.asyncIterator]() {
      yield {
        model: 'claude-test',
        subtype: 'init',
        type: 'system',
        uuid: 'init-event',
      }
      await prompt[Symbol.asyncIterator]().next()
      yield* messages
      yield {
        modelUsage: {},
        session_id: 'session',
        subtype: 'success',
        total_cost_usd: 0,
        type: 'result',
        uuid: 'result-event',
      }
    },
    close: vi.fn(),
    interrupt: vi.fn(),
  }
}

async function startClaudeSession() {
  const manager = new ManagedSessionManager({
    onRuntimeEvent: () => undefined,
    onUpdate: () => undefined,
  })
  await manager.createSession({
    cwd: '/tmp/workspace',
    mode: 'claude',
    paneId: 'pane',
    readOnly: true,
    sessionId: 'session',
    workspaceId: 'workspace',
  })
  return manager
}

async function waitForCompletedTurn(manager: ManagedSessionManager) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const snapshot = manager.getSnapshots().session
    if (snapshot?.turns.some((turn) => turn.state === 'completed')) {
      return snapshot
    }
    await new Promise((resolve) => setTimeout(resolve, 0))
  }

  throw new Error('Turn did not complete.')
}

describe('tool call content items', () => {
  afterEach(() => {
    query.mockReset()
  })

  it('merges a Claude tool_use and tool_result pair into one completed item', async () => {
    query.mockImplementation(({ prompt }) => createClaudeToolQuery(prompt))
    const manager = new ManagedSessionManager({
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })
    await manager.createSession({
      cwd: '/tmp/workspace',
      mode: 'claude',
      paneId: 'pane',
      readOnly: true,
      sessionId: 'session',
      workspaceId: 'workspace',
    })
    await manager.sendInput('session', 'run echo')
    const snapshot = await waitForCompletedTurn(manager)
    const toolCalls = snapshot.content.filter(
      (item) => item.kind === 'tool-call',
    )

    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]?.tool).toEqual({
      callId: 'call-1',
      command: 'echo hello',
      input: { command: 'echo hello', description: 'Greet' },
      output: 'hello',
      status: 'completed',
      toolName: 'Bash',
    })

    await manager.closeAll()
  })

  it('routes Bash tool input through the rtk PreToolUse hook', async () => {
    query.mockImplementation(({ prompt }) => createClaudeToolQuery(prompt))
    const manager = await startClaudeSession()
    const options = query.mock.calls.at(-1)?.[0].options

    expect(options.hooks.PreToolUse).toEqual([
      { hooks: [expect.any(Function)], matcher: 'Bash' },
    ])

    await manager.closeAll()
  })

  it('derives a unified diff for a Claude Edit call', async () => {
    query.mockImplementation(({ prompt }) => ({
      async *[Symbol.asyncIterator]() {
        yield {
          model: 'claude-test',
          subtype: 'init',
          type: 'system',
          uuid: 'init-event',
        }
        await prompt[Symbol.asyncIterator]().next()
        yield {
          message: {
            id: 'assistant-1',
            content: [
              {
                id: 'call-edit',
                input: {
                  file_path: 'README.md',
                  new_string: 'after',
                  old_string: 'before',
                },
                name: 'Edit',
                type: 'tool_use',
              },
            ],
            model: 'claude-test',
            usage: { input_tokens: 1, output_tokens: 1 },
          },
          parent_tool_use_id: null,
          session_id: 'session',
          type: 'assistant',
          uuid: 'assistant-event',
        }
        yield {
          modelUsage: {},
          session_id: 'session',
          subtype: 'success',
          total_cost_usd: 0,
          type: 'result',
          uuid: 'result-event',
        }
      },
      close: vi.fn(),
      interrupt: vi.fn(),
    }))
    const manager = new ManagedSessionManager({
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })
    await manager.createSession({
      cwd: '/tmp/workspace',
      mode: 'claude',
      paneId: 'pane',
      readOnly: true,
      sessionId: 'session',
      workspaceId: 'workspace',
    })
    await manager.sendInput('session', 'edit the readme')
    const snapshot = await waitForCompletedTurn(manager)
    const tool = snapshot.content.find(
      (item) => item.kind === 'tool-call',
    )?.tool

    expect(tool?.files).toEqual([{ path: 'README.md', status: 'modified' }])
    expect(tool?.diff).toContain('-before')
    expect(tool?.diff).toContain('+after')
  })

  it('maps a Claude TodoWrite call to a task list', async () => {
    query.mockImplementation(({ prompt }) =>
      createClaudeQuery(prompt, [
        {
          message: {
            id: 'assistant-1',
            content: [
              {
                id: 'call-todos',
                input: {
                  todos: [
                    { content: 'Read the ticket', status: 'completed' },
                    { content: 'Write the checklist', status: 'in_progress' },
                    { content: 'Ship the PR', status: 'pending' },
                  ],
                },
                name: 'TodoWrite',
                type: 'tool_use',
              },
            ],
            model: 'claude-test',
            usage: { input_tokens: 1, output_tokens: 1 },
          },
          parent_tool_use_id: null,
          session_id: 'session',
          type: 'assistant',
          uuid: 'assistant-event',
        },
      ]),
    )
    const manager = await startClaudeSession()
    await manager.sendInput('session', 'plan the work')
    const snapshot = await waitForCompletedTurn(manager)
    const tool = snapshot.content.find(
      (item) => item.kind === 'tool-call',
    )?.tool

    expect(tool?.toolName).toBe('TodoWrite')
    expect(tool?.tasks).toEqual([
      { status: 'completed', subject: 'Read the ticket' },
      { status: 'in_progress', subject: 'Write the checklist' },
      { status: 'pending', subject: 'Ship the PR' },
    ])

    await manager.closeAll()
  })

  it('nests subagent text and task progress under the parent Task call', async () => {
    query.mockImplementation(({ prompt }) =>
      createClaudeQuery(prompt, [
        {
          message: {
            id: 'assistant-1',
            content: [
              {
                id: 'call-task',
                input: { description: 'Explore the repo', prompt: 'Explore' },
                name: 'Task',
                type: 'tool_use',
              },
            ],
            model: 'claude-test',
            usage: { input_tokens: 1, output_tokens: 1 },
          },
          parent_tool_use_id: null,
          session_id: 'session',
          type: 'assistant',
          uuid: 'assistant-event',
        },
        {
          message: {
            id: 'assistant-sub-1',
            content: [{ text: 'Listing the repo root.', type: 'text' }],
            model: 'claude-test',
            usage: { input_tokens: 1, output_tokens: 1 },
          },
          parent_tool_use_id: 'call-task',
          session_id: 'session',
          type: 'assistant',
          uuid: 'assistant-sub-1-event',
        },
        {
          message: {
            id: 'assistant-sub-2',
            content: [{ text: ' Found 12 source files.', type: 'text' }],
            model: 'claude-test',
            usage: { input_tokens: 1, output_tokens: 1 },
          },
          parent_tool_use_id: 'call-task',
          session_id: 'session',
          type: 'assistant',
          uuid: 'assistant-sub-2-event',
        },
        {
          description: 'Explore the repo',
          session_id: 'session',
          subtype: 'task_progress',
          summary: 'Reading src/main',
          task_id: 'task-1',
          tool_use_id: 'call-task',
          type: 'system',
          usage: { duration_ms: 1, tool_uses: 1, total_tokens: 1 },
          uuid: 'task-progress-event',
        },
        {
          message: {
            content: [
              {
                content: 'Done.',
                is_error: false,
                tool_use_id: 'call-task',
                type: 'tool_result',
              },
            ],
            role: 'user',
          },
          parent_tool_use_id: null,
          session_id: 'session',
          type: 'user',
          uuid: 'user-event',
        },
      ]),
    )
    const manager = await startClaudeSession()
    await manager.sendInput('session', 'explore')
    const snapshot = await waitForCompletedTurn(manager)
    const toolCalls = snapshot.content.filter(
      (item) => item.kind === 'tool-call',
    )

    expect(toolCalls).toHaveLength(1)
    expect(toolCalls[0]?.tool).toMatchObject({
      progress: 'Reading src/main',
      status: 'completed',
      toolName: 'Task',
    })
    expect(toolCalls[0]?.tool?.output).toBe(
      'Listing the repo root. Found 12 source files.Done.',
    )
    expect(
      snapshot.content.filter((item) => item.kind === 'reasoning-summary-text'),
    ).toHaveLength(0)

    await manager.closeAll()
  })

  it('completes a Codex commandExecution item with exit code and output', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'aide-codex-tool-'))
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
    send({ method: 'item/started', params: { item: { id: 'cmd-1', type: 'commandExecution', command: 'echo hello' } } });
    send({ method: 'item/commandExecution/outputDelta', params: { itemId: 'cmd-1', delta: 'hello\\n' } });
    send({ method: 'item/completed', params: { item: { id: 'cmd-1', type: 'commandExecution', command: 'echo hello', exitCode: 0, status: 'completed' } } });
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
      await manager.sendInput('session', 'run echo')
      const toolCalls = manager
        .getSnapshots()
        .session.content.filter((item) => item.kind === 'tool-call')

      expect(toolCalls).toHaveLength(1)
      expect(toolCalls[0]?.tool).toMatchObject({
        callId: 'cmd-1',
        command: 'echo hello',
        exitCode: 0,
        output: 'hello\n',
        status: 'completed',
        toolName: 'Shell',
      })
    } finally {
      await manager.closeAll()
      vi.unstubAllEnvs()
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('passes deny feedback to Claude as the permission message', async () => {
    let denial: Promise<unknown> | undefined
    query.mockImplementation(
      ({
        options,
        prompt,
      }: {
        options: {
          canUseTool: (
            toolName: string,
            input: Record<string, unknown>,
            callbackOptions: { signal: AbortSignal; suggestions: [] },
          ) => Promise<unknown>
        }
        prompt: AsyncIterable<unknown>
      }) => ({
        async *[Symbol.asyncIterator]() {
          yield {
            model: 'claude-test',
            subtype: 'init',
            type: 'system',
            uuid: 'init-event',
          }
          await prompt[Symbol.asyncIterator]().next()
          denial = options.canUseTool(
            'Bash',
            { command: 'rm -rf build' },
            { signal: new AbortController().signal, suggestions: [] },
          )
          await denial
        },
        close: vi.fn(),
        interrupt: vi.fn(),
      }),
    )
    const manager = new ManagedSessionManager({
      onRuntimeEvent: () => undefined,
      onUpdate: () => undefined,
    })

    try {
      await manager.createSession({
        cwd: '/tmp/workspace',
        mode: 'claude',
        paneId: 'pane',
        sessionId: 'session',
        workspaceId: 'workspace',
      })
      await manager.sendInput('session', 'clean the build')
      await vi.waitFor(() =>
        expect(manager.getSnapshots().session.pendingApprovals).toHaveLength(1),
      )
      await manager.resolveRequest(
        'session',
        manager.getSnapshots().session.pendingApprovals[0]?.id ?? '',
        'deny',
        'Keep the build folder.',
      )

      await expect(denial).resolves.toEqual({
        behavior: 'deny',
        message:
          'User declined tool execution. The user said: Keep the build folder.',
      })
    } finally {
      await manager.closeAll()
    }
  })

  it('declines a Codex approval and steers the turn with the deny feedback', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'aide-codex-deny-'))
    const executable = path.join(directory, 'codex-fixture.cjs')
    const log = path.join(directory, 'messages.jsonl')
    writeFileSync(
      executable,
      `#!${process.execPath}
const fs = require('node:fs');
const readline = require('node:readline');
const send = (message) => process.stdout.write(JSON.stringify(message) + '\\n');
readline.createInterface({ input: process.stdin }).on('line', (line) => {
  fs.appendFileSync(${JSON.stringify(log)}, line + '\\n');
  const request = JSON.parse(line);
  if (request.method === 'thread/start') {
    send({ id: request.id, result: { thread: { id: 'thread' }, model: 'codex-test' } });
    return;
  }
  if (request.method === 'turn/start') {
    send({ method: 'turn/started', params: { turn: { id: 'turn' } } });
    send({ id: 'approval-1', method: 'item/commandExecution/requestApproval', params: { command: 'rm -rf build' } });
  }
  if (request.id !== undefined && request.method) send({ id: request.id, result: {} });
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
      await manager.sendInput('session', 'clean the build')
      await vi.waitFor(() =>
        expect(manager.getSnapshots().session.pendingApprovals).toHaveLength(1),
      )
      await manager.resolveRequest(
        'session',
        manager.getSnapshots().session.pendingApprovals[0]?.id ?? '',
        'deny',
        'Keep the build folder.',
      )

      const messages = readFileSync(log, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as Record<string, unknown>)
      expect(messages).toContainEqual({
        id: 'approval-1',
        result: { decision: 'decline' },
      })
      expect(messages).toContainEqual(
        expect.objectContaining({
          method: 'turn/steer',
          params: expect.objectContaining({
            expectedTurnId: 'turn',
            input: [
              expect.objectContaining({
                text: 'The user declined that request and said: Keep the build folder.',
              }),
            ],
          }),
        }),
      )
    } finally {
      await manager.closeAll()
      vi.unstubAllEnvs()
      rmSync(directory, { force: true, recursive: true })
    }
  })
})

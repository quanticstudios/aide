import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import readline from 'node:readline'

import {
  type CanUseTool,
  type PermissionResult,
  type PermissionUpdate,
  type SDKMessage,
  type SDKUserMessage,
  query,
} from '@anthropic-ai/claude-agent-sdk'

import type {
  ManagedSessionConfig,
  ManagedSessionContentItem,
  ManagedSessionDecision,
  ManagedSessionEvent,
  ManagedSessionPendingApproval,
  ManagedSessionPendingUserInput,
  ManagedSessionSnapshot,
  ManagedSessionTurnSummary,
  ManagedSessionUsage,
  ManagedSessionUserQuestion,
} from '../shared/managed-session'
import type {
  ManagedProviderRuntimeContentKind,
  ManagedProviderRuntimeEvent,
  ManagedProviderRuntimeProvider,
  ManagedProviderRuntimeRequestType,
  ManagedProviderRuntimeUserQuestion,
} from '../shared/provider-runtime'
import { ManagedTerminalProviderProjector } from './terminal-provider-runtime'
import { resolveTerminalWorkingDirectory } from './terminal-shell'

interface ManagedSessionManagerOptions {
  getNow?: () => string
  onRuntimeEvent: (
    meta: {
      mode: ManagedProviderRuntimeProvider
      paneId: string
      sessionId: string
      workspaceId: string
    },
    event: ManagedProviderRuntimeEvent,
  ) => void
  onUpdate: (event: ManagedSessionEvent) => void
}

interface ManagedSessionMutableState {
  activeTurnId: string | null
  backend: ManagedSessionBackend
  config: ManagedSessionConfig
  contentByKey: Map<string, ManagedSessionContentItem>
  orderedContentKeys: string[]
  pendingApprovals: Map<string, ManagedSessionPendingApproval>
  pendingUserInputs: Map<string, ManagedSessionPendingUserInput>
  pendingUserPromptText: string | null
  projector: ManagedTerminalProviderProjector
  snapshot: ManagedSessionSnapshot
  turns: Map<string, ManagedSessionTurnSummary>
  usage: ManagedSessionUsage | null
}

interface ManagedSessionBackend {
  close(): Promise<void>
  interrupt(): Promise<void>
  sendInput(text: string): Promise<void>
  resolveRequest(
    requestId: string,
    decision: ManagedSessionDecision,
  ): Promise<void>
  resolveUserInput(
    requestId: string,
    answers: Record<string, string | string[]>,
  ): Promise<void>
  start(): Promise<void>
}

class AsyncQueue<T> implements AsyncIterable<T> {
  private done = false
  private readonly items: T[] = []
  private pendingResolve:
    | ((value: IteratorResult<T, undefined>) => void)
    | null = null

  public enqueue(value: T): void {
    if (this.done) {
      return
    }

    if (this.pendingResolve) {
      const resolve = this.pendingResolve
      this.pendingResolve = null
      resolve({ done: false, value })
      return
    }

    this.items.push(value)
  }

  public end(): void {
    this.done = true

    if (this.pendingResolve) {
      const resolve = this.pendingResolve
      this.pendingResolve = null
      resolve({ done: true, value: undefined })
    }
  }

  public [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length > 0) {
          return Promise.resolve({
            done: false,
            value: this.items.shift() as T,
          })
        }

        if (this.done) {
          return Promise.resolve({ done: true, value: undefined })
        }

        return new Promise<IteratorResult<T, undefined>>((resolve) => {
          this.pendingResolve = resolve
        })
      },
    }
  }
}

function buildEmptySnapshot(
  config: ManagedSessionConfig,
  updatedAt: string,
): ManagedSessionSnapshot {
  return {
    content: [],
    detail: null,
    lastCompletedAt: null,
    lastError: null,
    paneId: config.paneId,
    pendingApprovals: [],
    pendingUserInputs: [],
    provider: config.mode,
    running: true,
    sessionId: config.sessionId,
    sessionState: 'connecting',
    turns: [],
    updatedAt,
    workspaceId: config.workspaceId,
  }
}

function createContentKey(
  kind: ManagedProviderRuntimeContentKind | 'user-prompt',
  itemId: string,
): string {
  return `${kind}:${itemId}`
}

function summarizeToolRequest(
  toolName: string,
  input: Record<string, unknown>,
): string {
  const command =
    typeof input.command === 'string'
      ? input.command
      : typeof input.cmd === 'string'
        ? input.cmd
        : null

  if (command) {
    return `${toolName}: ${command.trim().slice(0, 240)}`
  }

  return `${toolName}: ${JSON.stringify(input).slice(0, 240)}`
}

function classifyToolRequestType(
  toolName: string,
): ManagedProviderRuntimeRequestType {
  const normalized = toolName.toLowerCase()

  if (normalized.includes('read')) {
    return 'file-read-approval'
  }

  if (
    normalized.includes('edit') ||
    normalized.includes('write') ||
    normalized.includes('patch') ||
    normalized.includes('replace')
  ) {
    return 'file-change-approval'
  }

  if (
    normalized.includes('bash') ||
    normalized.includes('command') ||
    normalized.includes('shell')
  ) {
    return 'command-execution-approval'
  }

  return 'dynamic-tool-call'
}

function normalizeClaudeQuestions(
  rawQuestions: unknown,
): ManagedProviderRuntimeUserQuestion[] {
  if (!Array.isArray(rawQuestions)) {
    return []
  }

  return rawQuestions.flatMap((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      return []
    }

    const record = entry as Record<string, unknown>
    const prompt =
      typeof record.question === 'string' ? record.question.trim() : ''
    const header =
      typeof record.header === 'string' ? record.header.trim() : undefined
    const id =
      typeof record.header === 'string' && record.header.trim().length > 0
        ? record.header.trim()
        : `question-${index + 1}`
    const options = Array.isArray(record.options)
      ? record.options.flatMap((option, optionIndex) => {
          if (!option || typeof option !== 'object') {
            return []
          }

          const optionRecord = option as Record<string, unknown>
          const label =
            typeof optionRecord.label === 'string'
              ? optionRecord.label.trim()
              : ''

          if (!label) {
            return []
          }

          return [
            {
              description:
                typeof optionRecord.description === 'string'
                  ? optionRecord.description.trim()
                  : undefined,
              id: `option-${optionIndex + 1}`,
              label,
            },
          ]
        })
      : []

    if (!prompt || options.length === 0) {
      return []
    }

    return [
      {
        header,
        id,
        options,
        prompt,
      },
    ]
  })
}

class ClaudeManagedSessionBackend implements ManagedSessionBackend {
  private activeTurnId: string | null = null
  private readonly promptQueue = new AsyncQueue<SDKUserMessage>()
  private queryRuntime: ReturnType<typeof query> | null = null
  private readonly pendingApprovals = new Map<
    string,
    {
      resolve: (result: PermissionResult) => void
      suggestions?: PermissionUpdate[]
    }
  >()
  private readonly pendingUserInputs = new Map<
    string,
    {
      questions: unknown
      resolve: (answers: Record<string, string | string[]>) => void
    }
  >()

  public constructor(
    private readonly config: ManagedSessionConfig,
    private readonly emitRuntimeEvent: (
      event: ManagedProviderRuntimeEvent,
    ) => void,
    private readonly getNow: () => string,
  ) {}

  public async start(): Promise<void> {
    const cliPath = process.env.AIDE_CLAUDE_COMMAND?.trim() || undefined
    const cwd = resolveTerminalWorkingDirectory(
      this.config.cwd,
      process.env.HOME ?? process.cwd(),
    )
    const canUseTool: CanUseTool = async (toolName, input, callbackOptions) => {
      if (toolName === 'AskUserQuestion') {
        const requestId = randomUUID()
        const questions = normalizeClaudeQuestions(input.questions)

        this.emitRuntimeEvent({
          createdAt: this.getNow(),
          detail:
            questions[0]?.prompt ??
            'Claude is waiting for additional user input.',
          provider: 'claude',
          questions,
          requestId,
          type: 'user-input.requested',
        })

        return await new Promise<PermissionResult>((resolve) => {
          const onAbort = () => {
            this.pendingUserInputs.delete(requestId)
            this.emitRuntimeEvent({
              createdAt: this.getNow(),
              provider: 'claude',
              requestId,
              type: 'user-input.resolved',
            })
            resolve({
              behavior: 'deny',
              message: 'User cancelled tool execution.',
            })
          }

          callbackOptions.signal.addEventListener('abort', onAbort, {
            once: true,
          })

          this.pendingUserInputs.set(requestId, {
            questions: input.questions,
            resolve: (answers) => {
              this.pendingUserInputs.delete(requestId)
              this.emitRuntimeEvent({
                createdAt: this.getNow(),
                provider: 'claude',
                requestId,
                type: 'user-input.resolved',
              })
              resolve({
                behavior: 'allow',
                updatedInput: {
                  answers,
                  questions: input.questions,
                },
              })
            },
          })
        })
      }

      const requestId = randomUUID()
      const requestType = classifyToolRequestType(toolName)
      const detail = summarizeToolRequest(toolName, input)

      this.emitRuntimeEvent({
        createdAt: this.getNow(),
        detail,
        provider: 'claude',
        requestId,
        requestType,
        type: 'request.opened',
      })

      return await new Promise<PermissionResult>((resolve) => {
        const onAbort = () => {
          this.pendingApprovals.delete(requestId)
          this.emitRuntimeEvent({
            createdAt: this.getNow(),
            provider: 'claude',
            requestId,
            type: 'request.resolved',
          })
          resolve({
            behavior: 'deny',
            message: 'User cancelled tool execution.',
          })
        }

        callbackOptions.signal.addEventListener('abort', onAbort, {
          once: true,
        })

        this.pendingApprovals.set(requestId, {
          resolve,
          suggestions: callbackOptions.suggestions,
        })
      })
    }

    this.queryRuntime = query({
      options: {
        canUseTool,
        cwd,
        env: process.env,
        includePartialMessages: false,
        pathToClaudeCodeExecutable: cliPath,
        settingSources: ['user', 'project', 'local'],
      },
      prompt: this.promptQueue,
    })

    void this.consumeQuery()
  }

  public async sendInput(text: string): Promise<void> {
    const trimmed = text.trim()

    if (!trimmed) {
      return
    }

    this.activeTurnId = randomUUID()
    this.emitRuntimeEvent({
      createdAt: this.getNow(),
      provider: 'claude',
      turnId: this.activeTurnId,
      type: 'turn.started',
    })
    this.emitRuntimeEvent({
      createdAt: this.getNow(),
      provider: 'claude',
      state: 'running',
      type: 'session.state.changed',
    })

    this.promptQueue.enqueue({
      message: {
        content: [{ text: trimmed, type: 'text' }],
        role: 'user',
      },
      parent_tool_use_id: null,
      session_id: '',
      type: 'user',
    })
  }

  public async resolveRequest(
    requestId: string,
    decision: ManagedSessionDecision,
  ): Promise<void> {
    const pending = this.pendingApprovals.get(requestId)

    if (!pending) {
      return
    }

    this.pendingApprovals.delete(requestId)
    this.emitRuntimeEvent({
      createdAt: this.getNow(),
      provider: 'claude',
      requestId,
      type: 'request.resolved',
    })

    if (decision === 'accept' || decision === 'accept-for-session') {
      pending.resolve({
        behavior: 'allow',
        ...(decision === 'accept-for-session' && pending.suggestions
          ? { updatedPermissions: [...pending.suggestions] }
          : {}),
      })
      return
    }

    pending.resolve({
      behavior: 'deny',
      message: 'User declined tool execution.',
    })
  }

  public async resolveUserInput(
    requestId: string,
    answers: Record<string, string | string[]>,
  ): Promise<void> {
    const pending = this.pendingUserInputs.get(requestId)

    if (!pending) {
      return
    }

    pending.resolve(answers)
  }

  public async interrupt(): Promise<void> {
    await this.queryRuntime?.interrupt()
  }

  public async close(): Promise<void> {
    this.promptQueue.end()
    this.queryRuntime?.close()
  }

  private async consumeQuery(): Promise<void> {
    if (!this.queryRuntime) {
      return
    }

    try {
      for await (const message of this.queryRuntime) {
        this.handleMessage(message)
      }
    } catch (error) {
      this.emitRuntimeEvent({
        createdAt: this.getNow(),
        message:
          error instanceof Error ? error.message : 'Claude session failed',
        provider: 'claude',
        type: 'runtime.error',
      })
    } finally {
      this.emitRuntimeEvent({
        createdAt: this.getNow(),
        exitCode: 0,
        provider: 'claude',
        type: 'session.exited',
      })
    }
  }

  private handleMessage(message: SDKMessage): void {
    if (message.type === 'system' && message.subtype === 'init') {
      this.emitRuntimeEvent({
        createdAt: this.getNow(),
        provider: 'claude',
        state: 'ready',
        type: 'session.state.changed',
      })
      return
    }

    if (
      message.type === 'system' &&
      message.subtype === 'session_state_changed'
    ) {
      this.emitRuntimeEvent({
        createdAt: this.getNow(),
        provider: 'claude',
        state:
          message.state === 'idle'
            ? 'ready'
            : message.state === 'running'
              ? 'running'
              : 'waiting',
        type: 'session.state.changed',
      })
      return
    }

    if (message.type === 'assistant') {
      const content = Array.isArray(message.message.content)
        ? message.message.content
        : []

      for (const block of content) {
        if (
          block &&
          typeof block === 'object' &&
          'type' in block &&
          block.type === 'text' &&
          typeof block.text === 'string' &&
          block.text.length > 0
        ) {
          this.emitRuntimeEvent({
            createdAt: this.getNow(),
            itemId: message.uuid,
            kind: 'assistant-text',
            provider: 'claude',
            text: block.text,
            type: 'content.delta',
          })
        }
      }

      return
    }

    if (message.type === 'tool_use_summary') {
      this.emitRuntimeEvent({
        createdAt: this.getNow(),
        itemId: message.uuid,
        kind: 'system',
        provider: 'claude',
        text: message.summary,
        type: 'content.delta',
      })
      return
    }

    if (message.type === 'system' && message.subtype === 'task_progress') {
      this.emitRuntimeEvent({
        createdAt: this.getNow(),
        itemId: message.task_id,
        kind: 'reasoning-summary-text',
        provider: 'claude',
        text: message.description,
        type: 'content.delta',
      })
      return
    }

    if (message.type === 'result') {
      if (this.activeTurnId) {
        this.emitRuntimeEvent({
          createdAt: this.getNow(),
          provider: 'claude',
          state: message.subtype === 'success' ? 'completed' : 'failed',
          turnId: this.activeTurnId,
          type: 'turn.completed',
          ...(message.subtype === 'success'
            ? {}
            : {
                errorMessage:
                  'errors' in message && message.errors.length > 0
                    ? message.errors.join(' ')
                    : 'Claude execution failed',
              }),
        })
        this.activeTurnId = null
      }

      if (message.subtype === 'success') {
        const usages = Object.values(message.modelUsage ?? {})
        const aggregate = usages.reduce<{
          cacheReadInputTokens: number
          contextWindow: number
          inputTokens: number
          outputTokens: number
        }>(
          (acc, usage) => ({
            cacheReadInputTokens:
              acc.cacheReadInputTokens + (usage.cacheReadInputTokens ?? 0),
            contextWindow: Math.max(
              acc.contextWindow,
              usage.contextWindow ?? 0,
            ),
            inputTokens: acc.inputTokens + (usage.inputTokens ?? 0),
            outputTokens: acc.outputTokens + (usage.outputTokens ?? 0),
          }),
          {
            cacheReadInputTokens: 0,
            contextWindow: 0,
            inputTokens: 0,
            outputTokens: 0,
          },
        )

        if (
          aggregate.inputTokens > 0 ||
          aggregate.outputTokens > 0 ||
          aggregate.contextWindow > 0
        ) {
          this.emitRuntimeEvent({
            cachedInputTokens: aggregate.cacheReadInputTokens,
            createdAt: this.getNow(),
            inputTokens: aggregate.inputTokens,
            ...(aggregate.contextWindow > 0
              ? { maxTokens: aggregate.contextWindow }
              : {}),
            outputTokens: aggregate.outputTokens,
            provider: 'claude',
            type: 'session.usage.updated',
          })
        }
      }

      return
    }
  }
}

function buildCodexInitializeParams() {
  return {
    capabilities: {
      experimentalApi: true,
    },
    clientInfo: {
      name: 'aide',
      title: 'aide',
      version: '0.1.0',
    },
  } as const
}

interface CodexPendingApproval {
  jsonRpcId: string | number
  requestType: ManagedProviderRuntimeRequestType
}

interface CodexPendingUserInput {
  jsonRpcId: string | number
}

class CodexManagedSessionBackend implements ManagedSessionBackend {
  private activeTurnId: string | null = null
  private child: ChildProcessWithoutNullStreams | null = null
  private nextRequestId = 1
  private readonly pendingApprovals = new Map<string, CodexPendingApproval>()
  private readonly pendingRequests = new Map<
    string,
    {
      reject: (error: Error) => void
      resolve: (value: unknown) => void
      timeout: ReturnType<typeof setTimeout>
    }
  >()
  private readonly pendingUserInputs = new Map<string, CodexPendingUserInput>()
  private output: readline.Interface | null = null
  private providerThreadId: string | null = null

  public constructor(
    private readonly config: ManagedSessionConfig,
    private readonly emitRuntimeEvent: (
      event: ManagedProviderRuntimeEvent,
    ) => void,
    private readonly getNow: () => string,
  ) {}

  public async start(): Promise<void> {
    const command = process.env.AIDE_CODEX_COMMAND?.trim() || 'codex'
    const cwd = resolveTerminalWorkingDirectory(
      this.config.cwd,
      process.env.HOME ?? process.cwd(),
    )
    const child = spawn(command, ['app-server'], {
      cwd,
      env: process.env,
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.child = child
    this.output = readline.createInterface({ input: child.stdout })

    this.output.on('line', (line) => {
      this.handleStdoutLine(line)
    })

    child.stderr.on('data', (chunk: Buffer) => {
      const message = chunk.toString().trim()

      if (!message) {
        return
      }

      this.emitRuntimeEvent({
        createdAt: this.getNow(),
        message,
        provider: 'codex',
        type: 'runtime.error',
      })
    })

    child.on('exit', (code) => {
      this.emitRuntimeEvent({
        createdAt: this.getNow(),
        exitCode: code,
        provider: 'codex',
        type: 'session.exited',
      })
    })

    await this.sendRequest('initialize', buildCodexInitializeParams())
    this.writeMessage({ method: 'initialized' })
    const response = (await this.sendRequest('thread/start', {
      approvalPolicy: 'on-request',
      cwd,
      sandbox: 'workspace-write',
    })) as Record<string, unknown>

    const providerThreadId =
      this.readString(this.readObject(response, 'thread'), 'id') ??
      this.readString(response, 'threadId')

    this.providerThreadId = providerThreadId ?? null
    this.emitRuntimeEvent({
      createdAt: this.getNow(),
      provider: 'codex',
      state: 'ready',
      type: 'session.state.changed',
    })
  }

  public async sendInput(text: string): Promise<void> {
    const trimmed = text.trim()

    if (!trimmed || !this.providerThreadId) {
      return
    }

    await this.sendRequest('turn/start', {
      input: [
        {
          text: trimmed,
          type: 'text',
        },
      ],
      threadId: this.providerThreadId,
    })
  }

  public async resolveRequest(
    requestId: string,
    decision: ManagedSessionDecision,
  ): Promise<void> {
    const pending = this.pendingApprovals.get(requestId)

    if (!pending) {
      return
    }

    this.pendingApprovals.delete(requestId)
    this.writeMessage({
      id: pending.jsonRpcId,
      result: {
        decision:
          decision === 'accept-for-session' ? 'acceptForSession' : decision,
      },
    })
    this.emitRuntimeEvent({
      createdAt: this.getNow(),
      provider: 'codex',
      requestId,
      type: 'request.resolved',
    })
  }

  public async resolveUserInput(
    requestId: string,
    answers: Record<string, string | string[]>,
  ): Promise<void> {
    const pending = this.pendingUserInputs.get(requestId)

    if (!pending) {
      return
    }

    this.pendingUserInputs.delete(requestId)
    this.writeMessage({
      id: pending.jsonRpcId,
      result: {
        answers: Object.fromEntries(
          Object.entries(answers).map(([questionId, value]) => [
            questionId,
            {
              answers: Array.isArray(value) ? value : [value],
            },
          ]),
        ),
      },
    })
    this.emitRuntimeEvent({
      createdAt: this.getNow(),
      provider: 'codex',
      requestId,
      type: 'user-input.resolved',
    })
  }

  public async interrupt(): Promise<void> {
    if (!this.providerThreadId || !this.activeTurnId) {
      return
    }

    await this.sendRequest('turn/interrupt', {
      threadId: this.providerThreadId,
      turnId: this.activeTurnId,
    })
  }

  public async close(): Promise<void> {
    this.output?.close()

    if (this.child && !this.child.killed) {
      this.child.kill()
    }
  }

  private handleStdoutLine(line: string): void {
    let parsed: unknown

    try {
      parsed = JSON.parse(line)
    } catch {
      return
    }

    if (this.isResponse(parsed)) {
      this.handleResponse(parsed)
      return
    }

    if (this.isRequest(parsed)) {
      this.handleRequest(parsed)
      return
    }

    if (this.isNotification(parsed)) {
      this.handleNotification(parsed)
    }
  }

  private handleNotification(notification: {
    method: string
    params?: unknown
  }): void {
    const params = this.readObject(notification.params)

    if (notification.method === 'thread/status/changed') {
      const status = this.readObject(params, 'status')
      const type = this.readString(status, 'type')
      const activeFlags = Array.isArray(status?.activeFlags)
        ? status.activeFlags
        : []

      this.emitRuntimeEvent({
        createdAt: this.getNow(),
        detail: activeFlags.includes('waitingOnApproval')
          ? 'Codex is waiting for approval.'
          : activeFlags.includes('waitingOnUserInput')
            ? 'Codex is waiting for input.'
            : undefined,
        provider: 'codex',
        state:
          type === 'systemError'
            ? 'error'
            : type === 'idle'
              ? 'ready'
              : activeFlags.length > 0
                ? 'waiting'
                : 'running',
        type: 'session.state.changed',
      })
      return
    }

    if (notification.method === 'turn/started') {
      const turn = this.readObject(params, 'turn')
      const turnId = this.readString(turn, 'id') ?? randomUUID()
      this.activeTurnId = turnId
      this.emitRuntimeEvent({
        createdAt: this.getNow(),
        provider: 'codex',
        turnId,
        type: 'turn.started',
      })
      return
    }

    if (notification.method === 'turn/completed') {
      const turn = this.readObject(params, 'turn')
      const turnId =
        this.readString(turn, 'id') ?? this.activeTurnId ?? randomUUID()
      const status = this.readString(turn, 'status')
      const errorMessage = this.readString(
        this.readObject(turn, 'error'),
        'message',
      )
      this.activeTurnId = null
      this.emitRuntimeEvent({
        createdAt: this.getNow(),
        provider: 'codex',
        state: status === 'failed' ? 'failed' : 'completed',
        turnId,
        type: 'turn.completed',
        ...(status === 'failed' && errorMessage ? { errorMessage } : {}),
      })
      return
    }

    const contentKind = this.resolveContentKind(notification.method)
    if (contentKind) {
      const delta =
        this.readString(params, 'delta') ??
        this.readString(params, 'text') ??
        this.readString(this.readObject(params, 'content'), 'text')

      if (!delta) {
        return
      }

      this.emitRuntimeEvent({
        createdAt: this.getNow(),
        itemId:
          this.readString(params, 'itemId') ??
          this.readString(this.readObject(params, 'item'), 'id') ??
          randomUUID(),
        kind: contentKind,
        provider: 'codex',
        text: delta,
        type: 'content.delta',
      })
      return
    }

    if (notification.method === 'error') {
      const message =
        this.readString(this.readObject(params, 'error'), 'message') ??
        'Codex session failed.'
      this.emitRuntimeEvent({
        createdAt: this.getNow(),
        message,
        provider: 'codex',
        type: 'runtime.error',
      })
    }
  }

  private handleRequest(request: {
    id: string | number
    method: string
    params?: unknown
  }): void {
    const params = this.readObject(request.params)

    if (
      request.method === 'item/commandExecution/requestApproval' ||
      request.method === 'item/fileChange/requestApproval' ||
      request.method === 'item/fileRead/requestApproval'
    ) {
      const requestId = randomUUID()
      const requestType =
        request.method === 'item/commandExecution/requestApproval'
          ? 'command-execution-approval'
          : request.method === 'item/fileChange/requestApproval'
            ? 'file-change-approval'
            : 'file-read-approval'

      this.pendingApprovals.set(requestId, {
        jsonRpcId: request.id,
        requestType,
      })
      this.emitRuntimeEvent({
        createdAt: this.getNow(),
        detail:
          this.readString(params, 'command') ??
          this.readString(params, 'reason') ??
          this.readString(params, 'prompt'),
        provider: 'codex',
        requestId,
        requestType,
        type: 'request.opened',
      })
      return
    }

    if (request.method === 'item/tool/requestUserInput') {
      const requestId = randomUUID()
      this.pendingUserInputs.set(requestId, {
        jsonRpcId: request.id,
      })
      this.emitRuntimeEvent({
        createdAt: this.getNow(),
        detail: 'Codex is waiting for user input.',
        provider: 'codex',
        questions: this.parseCodexQuestions(params),
        requestId,
        type: 'user-input.requested',
      })
      return
    }

    this.writeMessage({
      error: {
        code: -32601,
        message: `Unsupported request: ${request.method}`,
      },
      id: request.id,
    })
  }

  private handleResponse(response: {
    error?: { message?: string }
    id: string | number
    result?: unknown
  }): void {
    const pending = this.pendingRequests.get(String(response.id))

    if (!pending) {
      return
    }

    clearTimeout(pending.timeout)
    this.pendingRequests.delete(String(response.id))

    if (response.error?.message) {
      pending.reject(new Error(response.error.message))
      return
    }

    pending.resolve(response.result)
  }

  private async sendRequest(
    method: string,
    params: unknown,
    timeoutMs = 20_000,
  ): Promise<unknown> {
    const id = this.nextRequestId++

    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(String(id))
        reject(new Error(`Timed out waiting for ${method}`))
      }, timeoutMs)

      this.pendingRequests.set(String(id), {
        reject,
        resolve,
        timeout,
      })

      this.writeMessage({
        id,
        method,
        params,
      })
    })
  }

  private writeMessage(message: unknown): void {
    if (!this.child?.stdin.writable) {
      throw new Error('Codex app-server stdin is not writable.')
    }

    this.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private parseCodexQuestions(
    params: Record<string, unknown> | undefined,
  ): ManagedProviderRuntimeUserQuestion[] {
    const questions = Array.isArray(params?.questions) ? params.questions : []

    return questions.flatMap((entry, index) => {
      if (!entry || typeof entry !== 'object') {
        return []
      }

      const record = entry as Record<string, unknown>
      const prompt =
        typeof record.question === 'string' ? record.question.trim() : ''
      const header =
        typeof record.header === 'string' ? record.header.trim() : undefined
      const id =
        typeof record.id === 'string' ? record.id : `question-${index + 1}`
      const options = Array.isArray(record.options)
        ? record.options.flatMap((option, optionIndex) => {
            if (!option || typeof option !== 'object') {
              return []
            }

            const optionRecord = option as Record<string, unknown>
            const label =
              typeof optionRecord.label === 'string'
                ? optionRecord.label.trim()
                : ''

            if (!label) {
              return []
            }

            return [
              {
                description:
                  typeof optionRecord.description === 'string'
                    ? optionRecord.description.trim()
                    : undefined,
                id:
                  typeof optionRecord.id === 'string'
                    ? optionRecord.id
                    : `option-${optionIndex + 1}`,
                label,
              },
            ]
          })
        : []

      if (!prompt || options.length === 0) {
        return []
      }

      return [
        {
          header,
          id,
          options,
          prompt,
        },
      ]
    })
  }

  private resolveContentKind(
    method: string,
  ): ManagedProviderRuntimeContentKind | null {
    if (method === 'item/agentMessage/delta') {
      return 'assistant-text'
    }

    if (method === 'item/reasoning/textDelta') {
      return 'reasoning-text'
    }

    if (method === 'item/reasoning/summaryTextDelta') {
      return 'reasoning-summary-text'
    }

    if (
      method === 'item/commandExecution/outputDelta' ||
      method === 'item/commandExec/outputDelta'
    ) {
      return 'command-output'
    }

    if (method === 'item/fileChange/outputDelta') {
      return 'file-change-output'
    }

    return null
  }

  private isNotification(value: unknown): value is {
    method: string
    params?: unknown
  } {
    return (
      Boolean(value) &&
      typeof value === 'object' &&
      typeof (value as { method?: unknown }).method === 'string' &&
      !('id' in (value as Record<string, unknown>))
    )
  }

  private isRequest(value: unknown): value is {
    id: string | number
    method: string
    params?: unknown
  } {
    return (
      Boolean(value) &&
      typeof value === 'object' &&
      typeof (value as { method?: unknown }).method === 'string' &&
      (typeof (value as { id?: unknown }).id === 'string' ||
        typeof (value as { id?: unknown }).id === 'number')
    )
  }

  private isResponse(value: unknown): value is {
    error?: { message?: string }
    id: string | number
    result?: unknown
  } {
    return (
      Boolean(value) &&
      typeof value === 'object' &&
      (typeof (value as { id?: unknown }).id === 'string' ||
        typeof (value as { id?: unknown }).id === 'number') &&
      typeof (value as { method?: unknown }).method !== 'string'
    )
  }

  private readObject(
    value: unknown,
    key?: string,
  ): Record<string, unknown> | undefined {
    const target =
      key === undefined
        ? value
        : value && typeof value === 'object'
          ? (value as Record<string, unknown>)[key]
          : undefined

    return target && typeof target === 'object'
      ? (target as Record<string, unknown>)
      : undefined
  }

  private readString(value: unknown, key: string): string | undefined {
    if (!value || typeof value !== 'object') {
      return undefined
    }

    const candidate = (value as Record<string, unknown>)[key]
    return typeof candidate === 'string' ? candidate : undefined
  }
}

class FakeManagedSessionBackend implements ManagedSessionBackend {
  private activeRequestId: string | null = null

  public constructor(
    private readonly provider: ManagedProviderRuntimeProvider,
    private readonly emitRuntimeEvent: (
      event: ManagedProviderRuntimeEvent,
    ) => void,
    private readonly getNow: () => string,
  ) {}

  public async start(): Promise<void> {
    this.emitRuntimeEvent({
      createdAt: this.getNow(),
      provider: this.provider,
      state: 'ready',
      type: 'session.state.changed',
    })
  }

  public async sendInput(text: string): Promise<void> {
    const trimmed = text.trim()

    if (!trimmed) {
      return
    }

    if (trimmed === 'approval') {
      this.activeRequestId = randomUUID()
      this.emitRuntimeEvent({
        createdAt: this.getNow(),
        detail: `${this.provider} needs approval`,
        provider: this.provider,
        requestId: this.activeRequestId,
        requestType: 'command-execution-approval',
        type: 'request.opened',
      })
      return
    }

    if (trimmed === 'input') {
      this.activeRequestId = randomUUID()
      this.emitRuntimeEvent({
        createdAt: this.getNow(),
        detail: `${this.provider} needs input`,
        provider: this.provider,
        questions: [
          {
            header: 'Prompt',
            id: 'prompt',
            options: [
              {
                description: 'Continue the task.',
                id: 'continue',
                label: 'Continue',
              },
            ],
            prompt: `What should ${this.provider} do next?`,
          },
        ],
        requestId: this.activeRequestId,
        type: 'user-input.requested',
      })
      return
    }

    const turnId = randomUUID()
    this.emitRuntimeEvent({
      createdAt: this.getNow(),
      provider: this.provider,
      turnId,
      type: 'turn.started',
    })
    this.emitRuntimeEvent({
      createdAt: this.getNow(),
      itemId: randomUUID(),
      kind: 'assistant-text',
      provider: this.provider,
      text: `Handled: ${trimmed}`,
      type: 'content.delta',
    })
    this.emitRuntimeEvent({
      createdAt: this.getNow(),
      provider: this.provider,
      state: 'completed',
      turnId,
      type: 'turn.completed',
    })
  }

  public async resolveRequest(): Promise<void> {
    if (!this.activeRequestId) {
      return
    }

    this.emitRuntimeEvent({
      createdAt: this.getNow(),
      provider: this.provider,
      requestId: this.activeRequestId,
      type: 'request.resolved',
    })
    this.activeRequestId = null
  }

  public async resolveUserInput(): Promise<void> {
    if (!this.activeRequestId) {
      return
    }

    this.emitRuntimeEvent({
      createdAt: this.getNow(),
      provider: this.provider,
      requestId: this.activeRequestId,
      type: 'user-input.resolved',
    })
    this.activeRequestId = null
  }

  public async interrupt(): Promise<void> {}

  public async close(): Promise<void> {
    this.emitRuntimeEvent({
      createdAt: this.getNow(),
      exitCode: 0,
      provider: this.provider,
      type: 'session.exited',
    })
  }
}

export class ManagedSessionManager {
  private readonly getNow: () => string
  private readonly sessions = new Map<string, ManagedSessionMutableState>()

  public constructor(private readonly options: ManagedSessionManagerOptions) {
    this.getNow = options.getNow ?? (() => new Date().toISOString())
  }

  public getSnapshots(): Record<string, ManagedSessionSnapshot> {
    return Object.fromEntries(
      [...this.sessions.values()].map((state) => [
        state.config.sessionId,
        state.snapshot,
      ]),
    )
  }

  public async createSession(
    config: ManagedSessionConfig,
  ): Promise<ManagedSessionSnapshot> {
    const existing = this.sessions.get(config.sessionId)

    if (existing) {
      return existing.snapshot
    }

    const updatedAt = this.getNow()
    const state: ManagedSessionMutableState = {
      activeTurnId: null,
      backend: null as never,
      config,
      contentByKey: new Map(),
      orderedContentKeys: [],
      pendingApprovals: new Map(),
      pendingUserInputs: new Map(),
      pendingUserPromptText: null,
      projector: new ManagedTerminalProviderProjector(config.mode),
      snapshot: buildEmptySnapshot(config, updatedAt),
      turns: new Map(),
      usage: null,
    }

    const emitRuntimeEvent = (event: ManagedProviderRuntimeEvent) => {
      this.applyRuntimeEvent(state, event)
      this.options.onRuntimeEvent(
        {
          mode: config.mode,
          paneId: config.paneId,
          sessionId: config.sessionId,
          workspaceId: config.workspaceId,
        },
        event,
      )
    }

    state.backend =
      process.env.AIDE_FAKE_MANAGED_PROVIDERS === '1'
        ? new FakeManagedSessionBackend(
            config.mode,
            emitRuntimeEvent,
            this.getNow,
          )
        : config.mode === 'claude'
          ? new ClaudeManagedSessionBackend(
              config,
              emitRuntimeEvent,
              this.getNow,
            )
          : new CodexManagedSessionBackend(
              config,
              emitRuntimeEvent,
              this.getNow,
            )

    this.sessions.set(config.sessionId, state)
    emitRuntimeEvent({
      createdAt: updatedAt,
      provider: config.mode,
      type: 'session.started',
    })
    emitRuntimeEvent({
      createdAt: updatedAt,
      provider: config.mode,
      state: 'connecting',
      type: 'session.state.changed',
    })

    try {
      await state.backend.start()
    } catch (error) {
      emitRuntimeEvent({
        createdAt: this.getNow(),
        message:
          error instanceof Error
            ? error.message
            : 'Managed session failed to start',
        provider: config.mode,
        type: 'runtime.error',
      })
      emitRuntimeEvent({
        createdAt: this.getNow(),
        detail:
          error instanceof Error
            ? error.message
            : 'Managed session failed to start',
        provider: config.mode,
        state: 'error',
        type: 'session.state.changed',
      })
      throw error
    }

    return state.snapshot
  }

  public async closeSession(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId)

    if (!state) {
      return
    }

    await state.backend.close()
    this.sessions.delete(sessionId)
    this.options.onUpdate({
      sessionId,
      type: 'removed',
    })
  }

  public async interruptSession(sessionId: string): Promise<void> {
    await this.sessions.get(sessionId)?.backend.interrupt()
  }

  public async sendInput(sessionId: string, text: string): Promise<void> {
    const state = this.sessions.get(sessionId)

    if (!state) {
      return
    }

    state.pendingUserPromptText = text
    await state.backend.sendInput(text)
  }

  public async resolveRequest(
    sessionId: string,
    requestId: string,
    decision: ManagedSessionDecision,
  ): Promise<void> {
    await this.sessions
      .get(sessionId)
      ?.backend.resolveRequest(requestId, decision)
  }

  public async resolveUserInput(
    sessionId: string,
    requestId: string,
    answers: Record<string, string | string[]>,
  ): Promise<void> {
    await this.sessions
      .get(sessionId)
      ?.backend.resolveUserInput(requestId, answers)
  }

  public async closeAll(): Promise<void> {
    await Promise.all(
      [...this.sessions.keys()].map((sessionId) =>
        this.closeSession(sessionId),
      ),
    )
  }

  private applyRuntimeEvent(
    state: ManagedSessionMutableState,
    event: ManagedProviderRuntimeEvent,
  ): void {
    state.projector.apply([event])

    if (event.type === 'turn.started') {
      state.activeTurnId = event.turnId
      state.turns.set(event.turnId, {
        completedAt: null,
        id: event.turnId,
        startedAt: event.createdAt,
        state: 'running',
      })

      if (state.pendingUserPromptText !== null) {
        const userItemId = `user-prompt:${event.turnId}`
        const userKey = createContentKey('user-prompt', userItemId)

        state.contentByKey.set(userKey, {
          id: userItemId,
          kind: 'user-prompt',
          text: state.pendingUserPromptText,
          turnId: event.turnId,
          updatedAt: event.createdAt,
        })
        state.orderedContentKeys.push(userKey)
        state.pendingUserPromptText = null
      }
    }

    if (event.type === 'turn.completed') {
      const turn = state.turns.get(event.turnId)

      if (turn) {
        turn.completedAt = event.createdAt
        turn.state = event.state
      }

      state.activeTurnId = null
    }

    if (event.type === 'content.delta') {
      const key = createContentKey(event.kind, event.itemId)
      const existing = state.contentByKey.get(key)

      if (existing) {
        existing.text = `${existing.text}${event.text}`
        existing.updatedAt = event.createdAt
      } else {
        state.contentByKey.set(key, {
          id: event.itemId,
          kind: event.kind,
          text: event.text,
          turnId: state.activeTurnId,
          updatedAt: event.createdAt,
        })
        state.orderedContentKeys.push(key)
      }
    }

    if (event.type === 'request.opened') {
      state.pendingApprovals.set(event.requestId, {
        detail: event.detail ?? null,
        id: event.requestId,
        requestType: event.requestType ?? 'unknown',
      })
    }

    if (event.type === 'request.resolved') {
      state.pendingApprovals.delete(event.requestId)
    }

    if (event.type === 'user-input.requested') {
      state.pendingUserInputs.set(event.requestId, {
        detail: event.detail ?? null,
        id: event.requestId,
        questions: (event.questions ?? []).map((question) => ({
          header: question.header,
          id: question.id,
          options: question.options,
          prompt: question.prompt,
        })) satisfies ManagedSessionUserQuestion[],
      })
    }

    if (event.type === 'user-input.resolved') {
      state.pendingUserInputs.delete(event.requestId)
    }

    if (event.type === 'session.exited') {
      state.snapshot.running = false
      state.pendingUserPromptText = null
    }

    if (event.type === 'session.usage.updated') {
      const nextUsage: ManagedSessionUsage = {
        inputTokens: event.inputTokens,
        outputTokens: event.outputTokens,
      }

      if (event.maxTokens !== undefined) {
        nextUsage.maxTokens = event.maxTokens
      }

      if (event.cachedInputTokens !== undefined) {
        nextUsage.cachedInputTokens = event.cachedInputTokens
      }

      state.usage = nextUsage
    }

    const runtime = state.projector.getSnapshot()

    if (
      (runtime.sessionState === 'stopped' ||
        runtime.sessionState === 'error') &&
      state.pendingUserPromptText !== null
    ) {
      state.pendingUserPromptText = null
    }
    state.snapshot = {
      content: state.orderedContentKeys
        .map((key) => state.contentByKey.get(key) ?? null)
        .filter((item): item is ManagedSessionContentItem => item !== null),
      detail: runtime.detail,
      lastCompletedAt: runtime.lastCompletedAt,
      lastError: runtime.lastError,
      paneId: state.config.paneId,
      pendingApprovals: [...state.pendingApprovals.values()],
      pendingUserInputs: [...state.pendingUserInputs.values()],
      provider: state.config.mode,
      running: runtime.sessionState !== 'stopped',
      sessionId: state.config.sessionId,
      sessionState: runtime.sessionState,
      turns: [...state.turns.values()],
      updatedAt: event.createdAt,
      ...(state.usage !== null ? { usage: state.usage } : {}),
      workspaceId: state.config.workspaceId,
    }

    this.options.onUpdate({
      snapshot: state.snapshot,
      type: 'snapshot',
    })
  }
}

import { type ChildProcessWithoutNullStreams, spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import readline from 'node:readline'

import {
  type CanUseTool,
  type ModelUsage,
  type PermissionResult,
  type PermissionUpdate,
  query,
  type SDKMessage,
  type SDKUserMessage,
} from '@anthropic-ai/claude-agent-sdk'

import type {
  ManagedSessionConfig,
  ManagedSessionContentItem,
  ManagedSessionDecision,
  ManagedSessionEvent,
  ManagedSessionPendingApproval,
  ManagedSessionPendingUserInput,
  ManagedSessionPlanApproval,
  ManagedSessionProviderSelection,
  ManagedSessionSnapshot,
  ManagedSessionThinkingBudget,
  ManagedSessionTurnDiffSummary,
  ManagedSessionTurnPatch,
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

/**
 * Map a Claude `thinkingBudget` tier to the SDK's `ThinkingConfig`. Returns
 * `null` when no override is needed (the SDK uses the base `effort` tier).
 */
function resolveClaudeThinkingOption(
  budget: ManagedSessionThinkingBudget | undefined,
): { type: 'enabled'; budgetTokens: number } | null {
  if (!budget || budget === 'default') {
    return null
  }

  if (budget === 'extra') {
    return { type: 'enabled', budgetTokens: 16_000 }
  }

  return { type: 'enabled', budgetTokens: 32_000 }
}

interface ManagedSessionManagerOptions {
  createBackend?: (
    config: ManagedSessionConfig,
    emitRuntimeEvent: (event: ManagedProviderRuntimeEvent) => void,
  ) => ManagedSessionBackend
  getNow?: () => string
  onRuntimeEvent: (
    meta: {
      mode: ManagedProviderRuntimeProvider
      paneId: string
      runtimeGeneration: number
      sessionId: string
      workspaceId: string
    },
    event: ManagedProviderRuntimeEvent,
  ) => void
  onUpdate: (event: ManagedSessionEvent) => void
  turnPatchRecorder?: ManagedTurnPatchRecorder
}

/**
 * The manager owns patch retention while the Git-aware implementation owns
 * worktree validation and filesystem snapshots. `baseline` is deliberately
 * opaque so it cannot cross the managed-session boundary.
 */
export interface ManagedTurnPatchRecorder {
  captureBaseline(
    config: ManagedSessionConfig,
    signal?: AbortSignal,
  ): Promise<unknown>
  capturePatch(
    config: ManagedSessionConfig,
    baseline: unknown,
    signal?: AbortSignal,
  ): Promise<ManagedTurnPatchCapture>
  disposeBaseline(baseline: unknown): Promise<void>
}

export interface ManagedTurnPatchCapture {
  binaryChanges: 'none' | 'present' | 'unknown'
  changedFileCount: number
  message: string | null
  patch: string | null
  patchByteLength: number
  status: Exclude<ManagedSessionTurnDiffSummary['status'], 'capturing'>
}

interface WorkspaceMutationLease {
  released: boolean
  release: () => void
  tail: Promise<void>
  workspaceId: string
}

interface ManagedTurnPatchBaseline {
  abortController: AbortController
  baseline: unknown | null
  baselineError: string | null
  capture: Promise<void>
  config: ManagedSessionConfig
  disposal: Promise<void> | null
  generation: number
  hasBaseline: boolean
  lease: WorkspaceMutationLease
  patchCapture: Promise<ManagedTurnPatchCapture | null> | null
}

interface ManagedSessionMutableState {
  activeTurnId: string | null
  activeProviderTurnId: string | null
  awaitingProviderTurnStart: boolean
  backend: ManagedSessionBackend
  closing: boolean
  config: ManagedSessionConfig
  contentByKey: Map<string, ManagedSessionContentItem>
  emitRuntimeEvent: (event: ManagedProviderRuntimeEvent) => void
  orderedContentKeys: string[]
  pendingApprovals: Map<string, ManagedSessionPendingApproval>
  pendingUserInputs: Map<string, ManagedSessionPendingUserInput>
  pendingUserPromptText: string | null
  preparedTurnPatch: ManagedTurnPatchBaseline | null
  projector: ManagedTerminalProviderProjector
  revision: number
  runtimeGeneration: number
  snapshot: ManagedSessionSnapshot
  switchInProgress: boolean
  turns: Map<string, ManagedSessionTurnSummary>
  turnPatchBaselines: Map<string, ManagedTurnPatchBaseline>
  turnPatches: Map<string, string>
  turnRecoveryTimer: ReturnType<typeof setTimeout> | null
  turnSequence: number
  usage: ManagedSessionUsage | null
}

const MAX_MANAGED_TURN_HISTORY = 50
const MANAGED_TURN_CAPTURE_TIMEOUT_MS = 15_000
const MANAGED_TURN_RECOVERY_TIMEOUT_MS = 5_000

function createTurnDiffSummary(
  status: ManagedSessionTurnDiffSummary['status'] = 'capturing',
  message: string | null = null,
): ManagedSessionTurnDiffSummary {
  return {
    binaryChanges:
      status === 'capturing' || status === 'error' ? 'unknown' : 'none',
    changedFileCount: 0,
    message,
    patchByteLength: 0,
    status,
  }
}

interface ManagedSessionBackend {
  /** Resolves only once this backend can no longer mutate its working tree. */
  close(): Promise<void>
  /** Escalates shutdown when graceful close misses its bounded recovery window. */
  forceClose?(): Promise<void>
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
    effort: config.effort ?? null,
    interactionMode: config.interactionMode ?? 'build',
    lastCompletedAt: null,
    lastError: null,
    lastErrorAt: null,
    model: config.model ?? null,
    paneId: config.paneId,
    pendingApprovals: [],
    pendingUserInputs: [],
    planApproval: null,
    provider: config.mode,
    revision: 0,
    running: true,
    runtimeGeneration: 1,
    selectionNotice: config.selectionNotice ?? null,
    serviceTier: config.serviceTier ?? null,
    sessionId: config.sessionId,
    sessionState: 'connecting',
    turns: [],
    updatedAt,
    workspaceId: config.workspaceId,
  }
}

function createContentKey(
  kind: ManagedProviderRuntimeContentKind | 'user-prompt' | 'system',
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

  if (normalized === 'exitplanmode') {
    return 'plan-approval'
  }

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
  private consumption: Promise<void> | null = null
  private readonly promptQueue = new AsyncQueue<SDKUserMessage>()
  private queryRuntime: ReturnType<typeof query> | null = null
  private readonly streamedMessageUuids = new Set<string>()
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

    const thinking = resolveClaudeThinkingOption(this.config.thinkingBudget)

    this.queryRuntime = query({
      options: {
        canUseTool,
        cwd,
        effort: this.config.effort as
          | 'high'
          | 'low'
          | 'max'
          | 'medium'
          | undefined,
        env: process.env,
        includePartialMessages: true,
        ...(this.config.model ? { model: this.config.model } : {}),
        pathToClaudeCodeExecutable: cliPath,
        permissionMode: this.config.permissionMode,
        settingSources: ['user', 'project', 'local'],
        ...(thinking ? { thinking } : {}),
      },
      prompt: this.promptQueue,
    })

    this.consumption = this.consumeQuery()
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
    await this.consumption
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

  private handleStreamEvent(message: {
    readonly uuid: string
    readonly event: unknown
  }): void {
    const event = message.event

    if (!event || typeof event !== 'object' || !('type' in event)) {
      return
    }

    const record = event as Record<string, unknown>

    if (record.type === 'content_block_delta') {
      const delta = record.delta
      if (!delta || typeof delta !== 'object') {
        return
      }

      const deltaRecord = delta as Record<string, unknown>

      if (deltaRecord.type === 'text_delta') {
        const text = deltaRecord.text
        if (typeof text !== 'string' || text.length === 0) {
          return
        }

        this.streamedMessageUuids.add(message.uuid)
        this.emitRuntimeEvent({
          createdAt: this.getNow(),
          itemId: message.uuid,
          kind: 'assistant-text',
          provider: 'claude',
          text,
          type: 'content.delta',
        })
        return
      }

      if (deltaRecord.type === 'thinking_delta') {
        const thinking = deltaRecord.thinking
        if (typeof thinking !== 'string' || thinking.length === 0) {
          return
        }

        this.streamedMessageUuids.add(message.uuid)
        this.emitRuntimeEvent({
          createdAt: this.getNow(),
          itemId: `${message.uuid}:thinking`,
          kind: 'reasoning-text',
          provider: 'claude',
          text: thinking,
          type: 'content.delta',
        })
      }
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

    if (message.type === 'stream_event') {
      this.streamedMessageUuids.add(message.uuid)
      this.handleStreamEvent(message)
      return
    }

    if (message.type === 'assistant') {
      if (this.streamedMessageUuids.has(message.uuid)) {
        this.streamedMessageUuids.delete(message.uuid)
        return
      }

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
        const usages: ModelUsage[] = Object.values(message.modelUsage ?? {})
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
  private exitPromise: Promise<void> | null = null
  private resolveExit: (() => void) | null = null
  private nextRequestId = 1
  private nextStderrItemId = 1
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
  private readonly activeContentItemIds = new Map<string, string>()
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
    const args = ['app-server']

    const child = spawn(command, args, {
      cwd,
      env: process.env,
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    this.child = child
    this.exitPromise = new Promise<void>((resolve) => {
      this.resolveExit = resolve
    })
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
        itemId: `codex-stderr:${this.nextStderrItemId++}`,
        kind: 'system',
        provider: 'codex',
        text: `Codex diagnostic: ${message}`,
        type: 'content.delta',
      })
    })

    child.on('error', (error) => {
      this.rejectPendingRequests(error)
      this.resolveExit?.()
      this.resolveExit = null
    })

    child.on('exit', (code) => {
      this.resolveExit?.()
      this.resolveExit = null
      this.rejectPendingRequests(
        new Error(
          code === null
            ? 'Codex app-server exited before responding.'
            : `Codex app-server exited with code ${code} before responding.`,
        ),
      )
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
      ...(this.config.effort ? { reasoningEffort: this.config.effort } : {}),
      ...(this.config.model ? { model: this.config.model } : {}),
      sandbox: 'workspace-write',
      ...(this.config.serviceTier
        ? { serviceTier: this.config.serviceTier }
        : {}),
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
    await this.stopChild('SIGTERM')
  }

  public async forceClose(): Promise<void> {
    await this.stopChild('SIGKILL')
  }

  private async stopChild(signal: NodeJS.Signals): Promise<void> {
    this.output?.close()
    this.rejectPendingRequests(new Error('Codex app-server session closed.'))

    if (this.child && !this.child.killed) {
      this.child.kill(signal)
    }

    await this.exitPromise
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
      this.activeContentItemIds.clear()
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

      const stableItemId =
        this.readString(params, 'itemId') ??
        this.readString(this.readObject(params, 'item'), 'id') ??
        this.activeContentItemIds.get(contentKind) ??
        randomUUID()

      this.activeContentItemIds.set(contentKind, stableItemId)

      this.emitRuntimeEvent({
        createdAt: this.getNow(),
        itemId: stableItemId,
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

      try {
        this.writeMessage({
          id,
          method,
          params,
        })
      } catch (error) {
        clearTimeout(timeout)
        this.pendingRequests.delete(String(id))
        reject(
          error instanceof Error
            ? error
            : new Error(`Unable to send Codex request: ${method}`),
        )
      }
    })
  }

  private rejectPendingRequests(error: Error): void {
    for (const pending of this.pendingRequests.values()) {
      clearTimeout(pending.timeout)
      pending.reject(error)
    }

    this.pendingRequests.clear()
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
  private activeTurnId: string | null = null
  private turnSequence = 0

  public constructor(
    private readonly config: ManagedSessionConfig,
    private readonly emitRuntimeEvent: (
      event: ManagedProviderRuntimeEvent,
    ) => void,
    private readonly getNow: () => string,
  ) {}

  private get provider(): ManagedProviderRuntimeProvider {
    return this.config.mode
  }

  public async start(): Promise<void> {
    if (process.env.AIDE_FAKE_MANAGED_PROVIDERS === 'fail-start') {
      throw new Error('Fake managed provider failed to start')
    }

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
      this.startSyntheticTurn()
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

    if (trimmed === 'plan approval') {
      this.startSyntheticTurn()
      this.activeRequestId = randomUUID()
      this.emitRuntimeEvent({
        createdAt: this.getNow(),
        detail: `${this.provider} is ready to apply its plan`,
        provider: this.provider,
        requestId: this.activeRequestId,
        requestType: 'plan-approval',
        type: 'request.opened',
      })
      return
    }

    if (trimmed === 'input') {
      this.startSyntheticTurn()
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
    if (process.env.AIDE_FAKE_MANAGED_GIT_CHANGES === '1') {
      // `ManagedSessionManager.sendInput` awaits the baseline before this
      // backend is dispatched, so this mutation is deterministic without a
      // scheduling delay.
      this.turnSequence += 1
      await writeFile(
        path.join(this.config.cwd, `aide-fake-turn-${this.turnSequence}.txt`),
        `Managed fake turn: ${trimmed}\n`,
      )
    }
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
    this.completeSyntheticTurn()
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
    this.completeSyntheticTurn()
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

  private startSyntheticTurn(): void {
    this.activeTurnId = randomUUID()
    this.emitRuntimeEvent({
      createdAt: this.getNow(),
      provider: this.provider,
      turnId: this.activeTurnId,
      type: 'turn.started',
    })
  }

  private completeSyntheticTurn(): void {
    if (!this.activeTurnId) {
      return
    }

    this.emitRuntimeEvent({
      createdAt: this.getNow(),
      provider: this.provider,
      state: 'completed',
      turnId: this.activeTurnId,
      type: 'turn.completed',
    })
    this.emitRuntimeEvent({
      createdAt: this.getNow(),
      provider: this.provider,
      state: 'ready',
      type: 'session.state.changed',
    })
    this.activeTurnId = null
  }
}

export class ManagedSessionManager {
  private readonly getNow: () => string
  private readonly sessions = new Map<string, ManagedSessionMutableState>()
  private readonly workspaceLeaseTails = new Map<string, Promise<void>>()

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

  public getTurnPatch(
    sessionId: string,
    turnId: string,
  ): ManagedSessionTurnPatch | null {
    if (
      sessionId.trim().length === 0 ||
      turnId.trim().length === 0 ||
      sessionId.length > 256 ||
      turnId.length > 256
    ) {
      return null
    }

    const state = this.sessions.get(sessionId)
    const turn = state?.turns.get(turnId)

    if (!state || !turn) {
      return null
    }

    return {
      ...turn.diff,
      patch: state.turnPatches.get(turnId) ?? null,
      turnId,
    }
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
      activeProviderTurnId: null,
      awaitingProviderTurnStart: false,
      backend: null as never,
      closing: false,
      config,
      contentByKey: new Map(),
      emitRuntimeEvent: null as never,
      orderedContentKeys: [],
      pendingApprovals: new Map(),
      pendingUserInputs: new Map(),
      pendingUserPromptText: null,
      preparedTurnPatch: null,
      projector: new ManagedTerminalProviderProjector(config.mode),
      revision: 0,
      runtimeGeneration: 1,
      snapshot: buildEmptySnapshot(config, updatedAt),
      switchInProgress: false,
      turns: new Map(),
      turnPatchBaselines: new Map(),
      turnPatches: new Map(),
      turnRecoveryTimer: null,
      turnSequence: 0,
      usage: null,
    }

    state.emitRuntimeEvent = this.createRuntimeEventEmitter(
      state,
      state.runtimeGeneration,
    )

    state.backend = this.createBackend(config, state.emitRuntimeEvent)

    this.sessions.set(config.sessionId, state)
    state.emitRuntimeEvent({
      createdAt: updatedAt,
      provider: config.mode,
      type: 'session.started',
    })
    state.emitRuntimeEvent({
      createdAt: updatedAt,
      provider: config.mode,
      state: 'connecting',
      type: 'session.state.changed',
    })

    try {
      await state.backend.start()
    } catch (error) {
      state.emitRuntimeEvent({
        createdAt: this.getNow(),
        message:
          error instanceof Error
            ? error.message
            : 'Managed session failed to start',
        provider: config.mode,
        type: 'runtime.error',
      })
      state.emitRuntimeEvent({
        createdAt: this.getNow(),
        detail:
          error instanceof Error
            ? error.message
            : 'Managed session failed to start',
        provider: config.mode,
        state: 'error',
        type: 'session.state.changed',
      })

      try {
        await state.backend.close()
      } catch {
        // Preserve the original startup error; the backend may be only
        // partially initialized and unable to perform a clean shutdown.
      }

      if (this.sessions.get(config.sessionId) === state) {
        this.sessions.delete(config.sessionId)
      }

      throw error
    }

    return state.snapshot
  }

  public async closeSession(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId)

    if (!state) {
      return
    }

    state.closing = true

    try {
      await state.backend.close()
    } catch (error) {
      // Before provider work is dispatched there is no mutation to contain, so
      // a failed interrupt/close may safely discard the prepared baseline.
      if (!state.awaitingProviderTurnStart && !state.activeTurnId) {
        this.terminalizeRuntimeState(state, this.getNow(), 'interrupted')
      } else {
        // A rejected graceful close is not evidence that the backend stopped.
        // Retain the lease and enter bounded recovery until a terminal event
        // or confirmed shutdown proves the provider cannot still mutate.
        this.scheduleTurnRecovery(state, 'interrupted')
      }
      throw error
    }

    this.terminalizeRuntimeState(state, this.getNow(), 'interrupted')
    if (this.sessions.get(sessionId) === state) {
      this.sessions.delete(sessionId)
    }
    state.revision += 1
    this.options.onUpdate({
      revision: state.revision,
      sessionId,
      type: 'removed',
    })
    void this.disposeStateTurnPatches(state, true)
  }

  public async interruptSession(sessionId: string): Promise<void> {
    const state = this.sessions.get(sessionId)

    if (!state) {
      return
    }

    try {
      await state.backend.interrupt()
    } catch (error) {
      if (!state.awaitingProviderTurnStart && !state.activeTurnId) {
        this.terminalizeRuntimeState(state, this.getNow(), 'interrupted')
      } else {
        this.scheduleTurnRecovery(state, 'failed')
      }
      throw error
    }

    if (!state.awaitingProviderTurnStart && !state.activeTurnId) {
      this.terminalizeRuntimeState(state, this.getNow(), 'interrupted')
      return
    }

    this.scheduleTurnRecovery(state, 'interrupted')
  }

  public async sendInput(sessionId: string, text: string): Promise<void> {
    const state = this.sessions.get(sessionId)

    if (!state || !text.trim()) {
      return
    }

    if (
      state.closing ||
      state.activeTurnId ||
      state.preparedTurnPatch ||
      state.awaitingProviderTurnStart
    ) {
      throw new Error('Cannot send input while a managed turn is in progress.')
    }

    const prepared = await this.prepareTurnPatch(state)

    if (this.sessions.get(sessionId) !== state || state.closing) {
      if (prepared) {
        await this.disposeTurnPatchBaseline(prepared)
      }
      return
    }

    if (prepared) {
      if (
        this.sessions.get(sessionId) !== state ||
        state.runtimeGeneration !== prepared.generation ||
        state.preparedTurnPatch !== prepared
      ) {
        await this.disposeTurnPatchBaseline(prepared)
        return
      }
    }

    state.pendingUserPromptText = text
    state.awaitingProviderTurnStart = true
    try {
      await state.backend.sendInput(text)
    } catch (error) {
      this.scheduleTurnRecovery(state, 'failed')
      throw error
    }

    if (state.awaitingProviderTurnStart) {
      this.scheduleTurnRecovery(state, 'failed')
    }
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

  public async closeAll(timeoutMs = 2_000): Promise<void> {
    let gracefulCloseFailed = false
    const close = Promise.allSettled(
      [...this.sessions.keys()].map((sessionId) =>
        this.closeSession(sessionId),
      ),
    ).then((results) => {
      gracefulCloseFailed = results.some(
        (result) => result.status === 'rejected',
      )
    })

    let timeout: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    await Promise.race([
      close,
      new Promise<void>((resolve) => {
        timeout = setTimeout(() => {
          timedOut = true
          resolve()
        }, timeoutMs)
      }),
    ])
    if (timeout) {
      clearTimeout(timeout)
    }

    if (timedOut || gracefulCloseFailed) {
      void Promise.allSettled(
        [...this.sessions.values()].map((state) =>
          this.forceCloseSession(state),
        ),
      )
    }

    // A close that exceeded the caller's shutdown budget may still own a
    // workspace lease. Its closeSession continuation removes its own state
    // only after the backend confirms it has stopped, so do not clear the map
    // here and accidentally allow a same-workspace replacement to overlap it.
  }

  public async reapSessions(
    predicate: (snapshot: ManagedSessionSnapshot) => boolean,
  ): Promise<void> {
    await Promise.all(
      [...this.sessions.values()]
        .filter((state) => predicate(state.snapshot))
        .map((state) => this.closeSession(state.config.sessionId)),
    )
  }

  public async switchSessionProvider(
    sessionId: string,
    selection: ManagedSessionProviderSelection & {
      selectionNotice?: string | null
    },
  ): Promise<ManagedSessionSnapshot> {
    const newMode = selection.mode

    const state = this.sessions.get(sessionId)

    if (!state) {
      throw new Error(`Session ${sessionId} not found`)
    }

    if (state.switchInProgress) {
      throw new Error(
        'A provider switch is already in progress for this session',
      )
    }

    if (
      state.activeTurnId !== null ||
      state.preparedTurnPatch !== null ||
      state.pendingApprovals.size > 0 ||
      state.pendingUserInputs.size > 0 ||
      state.pendingUserPromptText !== null
    ) {
      throw new Error(
        'Cannot switch provider while a turn is active or approvals/inputs are pending',
      )
    }

    state.switchInProgress = true

    try {
      if (
        !['ready', 'stopped', 'error'].includes(state.snapshot.sessionState)
      ) {
        throw new Error(
          `Cannot switch provider while session is ${state.snapshot.sessionState}`,
        )
      }

      const now = this.getNow()
      const previousConfig = state.config
      const candidateConfig: ManagedSessionConfig = {
        ...previousConfig,
        effort: selection.effort,
        mode: newMode,
        model: selection.model,
        selectionNotice: selection.selectionNotice ?? null,
        serviceTier: selection.serviceTier,
      }

      void this.disposeStateTurnPatches(state)
      await state.backend.close()

      state.runtimeGeneration += 1

      const createStagedEmitter = () => {
        const bufferedEvents: ManagedProviderRuntimeEvent[] = []
        let discarded = false
        let publishedEmitter:
          | ((event: ManagedProviderRuntimeEvent) => void)
          | null = null

        return {
          discard: () => {
            discarded = true
            bufferedEvents.length = 0
          },
          emit: (event: ManagedProviderRuntimeEvent) => {
            if (publishedEmitter) {
              publishedEmitter(event)
            } else if (!discarded) {
              bufferedEvents.push(event)
            }
          },
          publish: (
            emitRuntimeEvent: (event: ManagedProviderRuntimeEvent) => void,
          ) => {
            if (discarded) {
              return
            }

            publishedEmitter = emitRuntimeEvent
            for (const event of bufferedEvents) {
              emitRuntimeEvent(event)
            }
            bufferedEvents.length = 0
          },
        }
      }

      const activateBackend = (
        config: ManagedSessionConfig,
        backend: ManagedSessionBackend,
        stagedEmitter: ReturnType<typeof createStagedEmitter>,
        includeSwitchNotice: boolean,
      ) => {
        state.activeTurnId = null
        state.activeProviderTurnId = null
        state.backend = backend
        state.config = config
        state.pendingApprovals.clear()
        state.pendingUserInputs.clear()
        state.pendingUserPromptText = null
        state.projector = new ManagedTerminalProviderProjector(config.mode)
        state.usage = null
        const emitRuntimeEvent = this.createRuntimeEventEmitter(
          state,
          state.runtimeGeneration,
        )
        state.emitRuntimeEvent = emitRuntimeEvent

        if (includeSwitchNotice) {
          const switchKey = createContentKey('system', `provider-switch:${now}`)
          state.contentByKey.set(switchKey, {
            id: `provider-switch:${now}`,
            kind: 'system',
            provider: null,
            text: `Switched to ${config.mode === 'claude' ? 'Claude' : 'Codex'}`,
            turnId: null,
            updatedAt: now,
          })
          state.orderedContentKeys.push(switchKey)
        }

        state.emitRuntimeEvent({
          createdAt: now,
          provider: config.mode,
          type: 'session.started',
        })
        state.emitRuntimeEvent({
          createdAt: now,
          provider: config.mode,
          state: 'connecting',
          type: 'session.state.changed',
        })
        stagedEmitter.publish(emitRuntimeEvent)
      }

      const candidateEmitter = createStagedEmitter()
      const candidateBackend = this.createBackend(
        candidateConfig,
        candidateEmitter.emit,
      )

      try {
        await candidateBackend.start()
      } catch (error) {
        const candidateError =
          error instanceof Error
            ? error
            : new Error('Backend failed to start after provider switch')

        candidateEmitter.discard()
        try {
          await candidateBackend.close()
        } catch {
          // The candidate may have only partially initialized. Its staged
          // events are discarded, so a cleanup failure cannot change state.
        }

        // The rollback creates a second replacement backend. Give it its own
        // generation so every backend restart remains distinguishable and
        // late events from the failed candidate can never be current.
        state.runtimeGeneration += 1

        const rollbackEmitter = createStagedEmitter()
        const rollbackBackend = this.createBackend(
          previousConfig,
          rollbackEmitter.emit,
        )

        try {
          await rollbackBackend.start()
        } catch (rollbackError) {
          rollbackEmitter.discard()
          try {
            await rollbackBackend.close()
          } catch {
            // The terminal error snapshot below is the recoverable state.
          }

          activateBackend(
            previousConfig,
            rollbackBackend,
            rollbackEmitter,
            false,
          )
          const rollbackMessage =
            rollbackError instanceof Error
              ? rollbackError.message
              : 'Previous provider failed to restart'
          const message = `Provider switch failed: ${candidateError.message}; rollback failed: ${rollbackMessage}`

          state.emitRuntimeEvent({
            createdAt: this.getNow(),
            message,
            provider: previousConfig.mode,
            type: 'runtime.error',
          })
          state.emitRuntimeEvent({
            createdAt: this.getNow(),
            detail: message,
            provider: previousConfig.mode,
            state: 'error',
            type: 'session.state.changed',
          })

          throw new Error(message)
        }

        activateBackend(previousConfig, rollbackBackend, rollbackEmitter, false)
        throw candidateError
      }

      activateBackend(candidateConfig, candidateBackend, candidateEmitter, true)
      return state.snapshot
    } finally {
      state.switchInProgress = false
    }
  }

  private createBackend(
    config: ManagedSessionConfig,
    emitRuntimeEvent: (event: ManagedProviderRuntimeEvent) => void,
  ): ManagedSessionBackend {
    const injectedBackend = this.options.createBackend?.(
      config,
      emitRuntimeEvent,
    )

    if (injectedBackend) {
      return injectedBackend
    }

    if (
      process.env.AIDE_FAKE_MANAGED_PROVIDERS === '1' ||
      process.env.AIDE_FAKE_MANAGED_PROVIDERS === 'fail-start'
    ) {
      return new FakeManagedSessionBackend(
        config,
        emitRuntimeEvent,
        this.getNow,
      )
    }

    return config.mode === 'claude'
      ? new ClaudeManagedSessionBackend(config, emitRuntimeEvent, this.getNow)
      : new CodexManagedSessionBackend(config, emitRuntimeEvent, this.getNow)
  }

  private createRuntimeEventEmitter(
    state: ManagedSessionMutableState,
    runtimeGeneration: number,
  ): (event: ManagedProviderRuntimeEvent) => void {
    return (event) => {
      if (
        this.sessions.get(state.config.sessionId) !== state ||
        state.runtimeGeneration !== runtimeGeneration
      ) {
        return
      }

      const currentEvent = { ...event, runtimeGeneration }
      this.applyRuntimeEvent(state, currentEvent)
      this.options.onRuntimeEvent(
        {
          mode: state.config.mode,
          paneId: state.config.paneId,
          runtimeGeneration,
          sessionId: state.config.sessionId,
          workspaceId: state.config.workspaceId,
        },
        currentEvent,
      )
    }
  }

  private async acquireWorkspaceLease(
    workspaceId: string,
  ): Promise<WorkspaceMutationLease> {
    const previous =
      this.workspaceLeaseTails.get(workspaceId) ?? Promise.resolve()
    let releaseCurrent: (() => void) | undefined
    const current = new Promise<void>((resolve) => {
      releaseCurrent = resolve
    })
    const tail = previous.then(() => current)
    this.workspaceLeaseTails.set(workspaceId, tail)

    await previous

    const lease: WorkspaceMutationLease = {
      released: false,
      release: () => {
        if (lease.released) {
          return
        }

        lease.released = true
        releaseCurrent?.()
        void tail.then(() => {
          if (this.workspaceLeaseTails.get(workspaceId) === tail) {
            this.workspaceLeaseTails.delete(workspaceId)
          }
        })
      },
      tail,
      workspaceId,
    }
    return lease
  }

  private async prepareTurnPatch(
    state: ManagedSessionMutableState,
  ): Promise<ManagedTurnPatchBaseline | null> {
    const recorder = this.options.turnPatchRecorder

    if (!recorder) {
      return null
    }

    const lease = await this.acquireWorkspaceLease(state.config.workspaceId)
    if (this.sessions.get(state.config.sessionId) !== state) {
      lease.release()
      return null
    }
    const prepared: ManagedTurnPatchBaseline = {
      abortController: new AbortController(),
      baseline: null,
      baselineError: null,
      capture: Promise.resolve(),
      config: state.config,
      disposal: null,
      generation: state.runtimeGeneration,
      hasBaseline: false,
      lease,
      patchCapture: null,
    }
    state.preparedTurnPatch = prepared

    const rawCapture = recorder.captureBaseline(
      prepared.config,
      prepared.abortController.signal,
    )
    void rawCapture.then(
      (baseline) => {
        if (prepared.abortController.signal.aborted) {
          void recorder.disposeBaseline(baseline).catch(() => undefined)
        }
      },
      () => undefined,
    )
    prepared.capture = this
      .awaitBoundedRecorderCapture(prepared, rawCapture)
      .then(
      (baseline) => {
        prepared.baseline = baseline
        prepared.hasBaseline = true
      },
      (error: unknown) => {
        prepared.baselineError =
          error instanceof Error
            ? error.message
            : 'Unable to prepare the Git baseline for this turn.'
      },
    )
    await prepared.capture
    return prepared
  }

  private async awaitBoundedRecorderCapture<T>(
    baseline: ManagedTurnPatchBaseline,
    capture: Promise<T>,
  ): Promise<T> {
    return await new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        baseline.abortController.abort()
        reject(new Error('Managed turn Git capture timed out.'))
      }, MANAGED_TURN_CAPTURE_TIMEOUT_MS)

      void capture.then(
        (value) => {
          clearTimeout(timeout)
          resolve(value)
        },
        (error: unknown) => {
          clearTimeout(timeout)
          reject(error)
        },
      )
    })
  }

  private disposeTurnPatchBaseline(
    baseline: ManagedTurnPatchBaseline,
    cancel = false,
  ): Promise<void> {
    if (baseline.disposal) {
      return baseline.disposal
    }

    const recorder = this.options.turnPatchRecorder
    if (cancel) {
      baseline.abortController.abort()
    }
    baseline.disposal = baseline.capture
      .then(() => baseline.patchCapture)
      .then(async (capture) => {
        await capture
        if (baseline.hasBaseline && recorder) {
          await recorder.disposeBaseline(baseline.baseline)
        }
      })
      .catch(() => undefined)
      .finally(() => {
        baseline.lease.release()
      })

    return baseline.disposal
  }

  private disposePreparedTurnPatch(
    state: ManagedSessionMutableState,
    baseline: ManagedTurnPatchBaseline,
  ): Promise<void> {
    if (state.preparedTurnPatch === baseline) {
      state.preparedTurnPatch = null
    }

    return this.disposeTurnPatchBaseline(baseline)
  }

  private disposeStateTurnPatches(
    state: ManagedSessionMutableState,
    cancel = false,
  ): Promise<void> {
    const baselines = [
      ...(state.preparedTurnPatch ? [state.preparedTurnPatch] : []),
      ...state.turnPatchBaselines.values(),
    ]
    state.preparedTurnPatch = null
    state.turnPatchBaselines.clear()

    return Promise.allSettled(
      baselines.map((baseline) =>
        this.disposeTurnPatchBaseline(baseline, cancel),
      ),
    ).then(() => undefined)
  }

  private clearTurnRecovery(state: ManagedSessionMutableState): void {
    if (state.turnRecoveryTimer) {
      clearTimeout(state.turnRecoveryTimer)
      state.turnRecoveryTimer = null
    }
  }

  private scheduleTurnRecovery(
    state: ManagedSessionMutableState,
    turnState: 'failed' | 'interrupted',
  ): void {
    if (state.turnRecoveryTimer) {
      return
    }

    const generation = state.runtimeGeneration
    state.turnRecoveryTimer = setTimeout(() => {
      state.turnRecoveryTimer = null
      void this.recoverUnresolvedTurn(state, generation, turnState)
    }, MANAGED_TURN_RECOVERY_TIMEOUT_MS)
  }

  private async recoverUnresolvedTurn(
    state: ManagedSessionMutableState,
    generation: number,
    turnState: 'failed' | 'interrupted',
  ): Promise<void> {
    if (
      this.sessions.get(state.config.sessionId) !== state ||
      state.runtimeGeneration !== generation ||
      (!state.awaitingProviderTurnStart && !state.activeTurnId)
    ) {
      return
    }

    try {
      await this.closeBackendWithBoundedRecovery(state.backend)
    } catch {
      // A failed shutdown is not proof that the old provider stopped. Retain
      // its workspace lease and retry bounded recovery instead of allowing a
      // same-workspace peer to overlap potentially late writes.
      this.scheduleTurnRecovery(state, turnState)
      return
    }

    if (
      this.sessions.get(state.config.sessionId) === state &&
      state.runtimeGeneration === generation
    ) {
      this.terminalizeRuntimeState(state, this.getNow(), turnState)
      this.publishSnapshot(state, this.getNow())
    }
  }

  private async closeBackendWithBoundedRecovery(
    backend: ManagedSessionBackend,
  ): Promise<void> {
    let timeout: ReturnType<typeof setTimeout> | undefined
    let timedOut = false
    await Promise.race([
      backend.close(),
      new Promise<void>((resolve) => {
        timeout = setTimeout(() => {
          timedOut = true
          resolve()
        }, MANAGED_TURN_RECOVERY_TIMEOUT_MS)
      }),
    ])
    if (timeout) {
      clearTimeout(timeout)
    }

    if (!timedOut) {
      return
    }
    if (!backend.forceClose) {
      throw new Error('Managed provider did not confirm shutdown.')
    }

    await backend.forceClose()
  }

  private async forceCloseSession(
    state: ManagedSessionMutableState,
  ): Promise<void> {
    if (!state.backend.forceClose) {
      return
    }

    try {
      await state.backend.forceClose()
    } catch {
      return
    }

    if (this.sessions.get(state.config.sessionId) !== state) {
      return
    }

    this.terminalizeRuntimeState(state, this.getNow(), 'interrupted')
    this.sessions.delete(state.config.sessionId)
    state.revision += 1
    this.options.onUpdate({
      revision: state.revision,
      sessionId: state.config.sessionId,
      type: 'removed',
    })
    void this.disposeStateTurnPatches(state, true)
  }

  private completePreparedTurnWithoutStart(
    state: ManagedSessionMutableState,
    completedAt: string,
    turnState: 'failed' | 'interrupted' | 'completed' | 'cancelled',
  ): void {
    if (!state.preparedTurnPatch) {
      return
    }

    const turnId = randomUUID()
    state.turnSequence += 1
    state.turns.set(turnId, {
      completedAt,
      diff: this.beginTurnPatchCapture(state, turnId),
      id: turnId,
      provider: state.config.mode,
      sequence: state.turnSequence,
      startedAt: completedAt,
      state: turnState,
    })
    this.captureCompletedTurnPatch(state, turnId)
    this.trimTurnHistory(state)
  }

  private terminalizeRuntimeState(
    state: ManagedSessionMutableState,
    completedAt: string,
    turnState: 'failed' | 'interrupted',
  ): void {
    this.clearTurnRecovery(state)

    if (state.activeTurnId) {
      const turn = state.turns.get(state.activeTurnId)

      if (turn?.state === 'running') {
        turn.completedAt = completedAt
        turn.state = turnState
        this.captureCompletedTurnPatch(state, turn.id)
      }
    } else if (state.awaitingProviderTurnStart && state.preparedTurnPatch) {
      this.completePreparedTurnWithoutStart(state, completedAt, turnState)
    } else if (state.preparedTurnPatch) {
      void this.disposePreparedTurnPatch(state, state.preparedTurnPatch)
    }

    state.activeTurnId = null
    state.activeProviderTurnId = null
    state.awaitingProviderTurnStart = false
    state.pendingApprovals.clear()
    state.pendingUserInputs.clear()
    state.pendingUserPromptText = null
  }

  private beginTurnPatchCapture(
    state: ManagedSessionMutableState,
    turnId: string,
  ): ManagedSessionTurnDiffSummary {
    const baseline = state.preparedTurnPatch
    state.preparedTurnPatch = null

    if (!baseline) {
      return createTurnDiffSummary(
        'error',
        'Provider turn started without a prepared Git baseline; changes cannot be attributed safely.',
      )
    }

    if (baseline.generation !== state.runtimeGeneration) {
      void this.disposeTurnPatchBaseline(baseline)
      return createTurnDiffSummary(
        'error',
        'Provider turn belongs to a stale runtime generation; changes cannot be attributed safely.',
      )
    }

    state.turnPatchBaselines.set(turnId, baseline)

    if (baseline.baselineError) {
      return createTurnDiffSummary('error', baseline.baselineError)
    }

    return createTurnDiffSummary()
  }

  private captureCompletedTurnPatch(
    state: ManagedSessionMutableState,
    turnId: string,
  ): void {
    const baseline = state.turnPatchBaselines.get(turnId)
    const recorder = this.options.turnPatchRecorder

    if (!baseline) {
      return
    }

    void (async () => {
      let capture: ManagedTurnPatchCapture | null = null
      let captureError: string | null = baseline.baselineError

      try {
        baseline.patchCapture ??= (async () => {
          await baseline.capture
          if (baseline.baselineError !== null) {
            return null
          }
          if (!recorder || !baseline.hasBaseline) {
            throw new Error(
              'Git patch capture is unavailable for this managed session.',
            )
          }
          return await this.awaitBoundedRecorderCapture(
            baseline,
            recorder.capturePatch(
              baseline.config,
              baseline.baseline,
              baseline.abortController.signal,
            ),
          )
        })()
        capture = await baseline.patchCapture
      } catch (error) {
        captureError =
          error instanceof Error
            ? error.message
            : 'Unable to capture the Git patch for this turn.'
      } finally {
        if (state.turnPatchBaselines.get(turnId) === baseline) {
          state.turnPatchBaselines.delete(turnId)
        }
        await this.disposeTurnPatchBaseline(baseline, captureError !== null)
      }

      if (this.sessions.get(state.config.sessionId) !== state) {
        return
      }

      const turn = state.turns.get(turnId)
      if (!turn || turn.state === 'running') {
        return
      }

      if (captureError !== null || capture === null) {
        turn.diff = createTurnDiffSummary('error', captureError)
        state.turnPatches.delete(turnId)
      } else {
        turn.diff = {
          binaryChanges: capture.binaryChanges,
          changedFileCount: capture.changedFileCount,
          message: capture.message,
          patchByteLength: capture.patchByteLength,
          status: capture.status,
        }
        if (capture.patch !== null) {
          state.turnPatches.set(turnId, capture.patch)
        } else {
          state.turnPatches.delete(turnId)
        }
      }
      this.publishSnapshot(state, this.getNow())
    })()
  }

  private trimTurnHistory(state: ManagedSessionMutableState): void {
    while (state.turns.size > MAX_MANAGED_TURN_HISTORY) {
      const oldestTurnId = state.turns.keys().next().value as string | undefined

      if (!oldestTurnId) {
        return
      }

      const baseline = state.turnPatchBaselines.get(oldestTurnId)
      state.turns.delete(oldestTurnId)
      state.turnPatchBaselines.delete(oldestTurnId)
      state.turnPatches.delete(oldestTurnId)
      if (baseline) {
        void this.disposeTurnPatchBaseline(baseline)
      }
    }
  }

  private publishSnapshot(
    state: ManagedSessionMutableState,
    updatedAt: string,
  ): void {
    const runtime = state.projector.getSnapshot()

    state.revision += 1
    const planApproval = [...state.pendingApprovals.values()].find(
      (approval) => approval.requestType === 'plan-approval',
    )
    state.snapshot = {
      content: state.orderedContentKeys
        .map((key) => state.contentByKey.get(key) ?? null)
        .filter((item): item is ManagedSessionContentItem => item !== null),
      detail: runtime.detail,
      effort: state.config.effort ?? null,
      interactionMode:
        state.config.interactionMode ??
        (state.config.permissionMode === 'plan' ? 'plan' : 'build'),
      lastCompletedAt: runtime.lastCompletedAt,
      lastError: runtime.lastError,
      lastErrorAt: runtime.lastErrorAt,
      model: state.config.model ?? null,
      paneId: state.config.paneId,
      pendingApprovals: [...state.pendingApprovals.values()],
      pendingUserInputs: [...state.pendingUserInputs.values()],
      planApproval: planApproval
        ? ({
            detail: planApproval.detail,
            id: planApproval.id,
          } satisfies ManagedSessionPlanApproval)
        : null,
      provider: state.config.mode,
      running:
        runtime.sessionState !== 'stopped' && runtime.sessionState !== 'error',
      sessionId: state.config.sessionId,
      sessionState: runtime.sessionState,
      turns: [...state.turns.values()],
      updatedAt,
      ...(state.usage !== null ? { usage: state.usage } : {}),
      workspaceId: state.config.workspaceId,
      revision: state.revision,
      runtimeGeneration: state.runtimeGeneration,
      selectionNotice: state.config.selectionNotice ?? null,
      serviceTier: state.config.serviceTier ?? null,
    }

    this.options.onUpdate({
      revision: state.snapshot.revision,
      snapshot: state.snapshot,
      type: 'snapshot',
    })
  }

  private applyRuntimeEvent(
    state: ManagedSessionMutableState,
    event: ManagedProviderRuntimeEvent,
  ): void {
    state.projector.apply([event])

    const terminalTurnState =
      event.type === 'session.exited'
        ? event.exitCode !== null && event.exitCode !== 0
          ? 'failed'
          : 'interrupted'
        : event.type === 'session.state.changed' && event.state === 'stopped'
          ? 'interrupted'
          : null

    if (terminalTurnState) {
      this.terminalizeRuntimeState(state, event.createdAt, terminalTurnState)
    } else if (
      event.type === 'runtime.error' ||
      (event.type === 'session.state.changed' && event.state === 'error')
    ) {
      // Diagnostics and error states do not prove a provider process stopped.
      // Keep the turn's lease until a terminal event or confirmed close.
      this.scheduleTurnRecovery(state, 'failed')
    }

    if (event.type === 'turn.started') {
      if (state.activeTurnId) {
        this.scheduleTurnRecovery(state, 'failed')
        this.publishSnapshot(state, event.createdAt)
        return
      }

      state.awaitingProviderTurnStart = false
      this.clearTurnRecovery(state)
      const turnId = randomUUID()
      state.activeTurnId = turnId
      state.activeProviderTurnId = event.turnId
      state.turnSequence += 1
      state.turns.set(turnId, {
        completedAt: null,
        diff: this.beginTurnPatchCapture(state, turnId),
        id: turnId,
        provider: state.config.mode,
        sequence: state.turnSequence,
        startedAt: event.createdAt,
        state: 'running',
      })
      this.trimTurnHistory(state)

      if (state.pendingUserPromptText !== null) {
        const userItemId = `user-prompt:${turnId}`
        const userKey = createContentKey('user-prompt', userItemId)

        state.contentByKey.set(userKey, {
          id: userItemId,
          kind: 'user-prompt',
          provider: null,
          text: state.pendingUserPromptText,
          turnId,
          updatedAt: event.createdAt,
        })
        state.orderedContentKeys.push(userKey)
        state.pendingUserPromptText = null
      }
    }

    if (event.type === 'turn.completed') {
      const turn =
        state.activeProviderTurnId === event.turnId && state.activeTurnId
          ? state.turns.get(state.activeTurnId)
          : undefined

      if (turn) {
        turn.completedAt = event.createdAt
        turn.state = event.state
        this.captureCompletedTurnPatch(state, turn.id)
        state.activeTurnId = null
        state.activeProviderTurnId = null
        state.awaitingProviderTurnStart = false
        this.clearTurnRecovery(state)
      } else if (state.awaitingProviderTurnStart && state.preparedTurnPatch) {
        // The provider's terminal event is sufficient proof that no mutation
        // remains, even if its start notification was lost or reordered.
        this.completePreparedTurnWithoutStart(
          state,
          event.createdAt,
          event.state,
        )
        state.awaitingProviderTurnStart = false
        this.clearTurnRecovery(state)
      }
    }

    if (
      event.type === 'session.state.changed' &&
      event.state === 'ready' &&
      state.awaitingProviderTurnStart &&
      state.preparedTurnPatch
    ) {
      // A ready transition is the provider's assertion that no turn remains.
      // Preserve the snapshot window as a failed synthetic turn instead of
      // retaining a baseline forever when turn.started was dropped.
      this.completePreparedTurnWithoutStart(state, event.createdAt, 'failed')
      state.awaitingProviderTurnStart = false
      this.clearTurnRecovery(state)
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
          provider: state.config.mode,
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

    this.publishSnapshot(state, event.createdAt)
  }
}

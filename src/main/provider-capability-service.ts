import { execFile, spawn } from 'node:child_process'
import readline from 'node:readline'
import { promisify } from 'node:util'

import type {
  ManagedSessionConfig,
  ManagedSessionProviderSelection,
} from '../shared/managed-session'
import {
  buildClaudeProviderCapabilities,
  normalizeCodexModelList,
  type ProviderCapabilitiesSnapshot,
  type ProviderSelectionInput,
  type ProviderSelectionResolution,
  resolveProviderSelection,
  unavailableProviderCapabilities,
} from '../shared/provider-capabilities'
import type { ManagedSessionMode } from '../shared/terminal'

const execFileAsync = promisify(execFile)
const DISCOVERY_TIMEOUT_MS = 15_000
const MAX_IPC_STRING_LENGTH = 4_096

interface ProviderCapabilityServiceOptions {
  readonly listCodexModels?: () => Promise<unknown>
  readonly probeClaudeVersion?: () => Promise<string>
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object'
}

function readJsonRpcId(value: unknown): number | string | null {
  return typeof value === 'number' || typeof value === 'string' ? value : null
}

function readCliVersionOutput(value: string): string | null {
  const match = value.match(/\d+\.\d+(?:\.\d+)?/)
  return match?.[0] ?? null
}

function validateString(
  value: unknown,
  field: string,
  options: { optional?: boolean } = {},
): string | undefined {
  if (value === undefined && options.optional) {
    return undefined
  }

  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.length > MAX_IPC_STRING_LENGTH
  ) {
    throw new Error(`Invalid managed-session ${field}.`)
  }

  return value.trim()
}

function validateOptionalEnum<T extends string>(
  value: unknown,
  field: string,
  values: readonly T[],
): T | undefined {
  if (value === undefined) {
    return undefined
  }

  if (typeof value !== 'string' || !values.includes(value as T)) {
    throw new Error(`Invalid managed-session ${field}.`)
  }

  return value as T
}

function validateMode(value: unknown): ManagedSessionMode {
  if (value !== 'claude' && value !== 'codex') {
    throw new Error('Invalid managed-session mode.')
  }

  return value
}

function validateProviderSelection(
  input: unknown,
): ManagedSessionProviderSelection {
  if (!isRecord(input)) {
    throw new Error('Invalid managed-session provider selection.')
  }

  return {
    effort: validateString(input.effort, 'reasoning effort', {
      optional: true,
    }),
    mode: validateMode(input.mode),
    model: validateString(input.model, 'model', { optional: true }),
    serviceTier: validateString(input.serviceTier, 'service tier', {
      optional: true,
    }),
  }
}

function validateManagedSessionConfig(input: unknown): ManagedSessionConfig {
  if (!isRecord(input)) {
    throw new Error('Invalid managed-session configuration.')
  }

  const selection = validateProviderSelection(input)
  const contextWindow = validateOptionalEnum(
    input.contextWindow,
    'context window',
    ['200k', '1m'] as const,
  )
  const interactionMode = validateOptionalEnum(
    input.interactionMode,
    'interaction mode',
    ['build', 'plan'] as const,
  )
  const permissionMode = validateOptionalEnum(
    input.permissionMode,
    'permission mode',
    ['acceptEdits', 'bypassPermissions', 'default', 'plan'] as const,
  )
  const thinkingBudget = validateOptionalEnum(
    input.thinkingBudget,
    'thinking budget',
    ['default', 'extra', 'ultra'] as const,
  )

  return {
    ...(contextWindow ? { contextWindow } : {}),
    cwd: validateString(input.cwd, 'working directory') ?? '',
    ...(selection.effort ? { effort: selection.effort } : {}),
    ...(interactionMode ? { interactionMode } : {}),
    mode: selection.mode,
    ...(selection.model ? { model: selection.model } : {}),
    paneId: validateString(input.paneId, 'pane id') ?? '',
    ...(permissionMode ? { permissionMode } : {}),
    ...(selection.serviceTier ? { serviceTier: selection.serviceTier } : {}),
    sessionId: validateString(input.sessionId, 'session id') ?? '',
    ...(thinkingBudget ? { thinkingBudget } : {}),
    workspaceId: validateString(input.workspaceId, 'workspace id') ?? '',
  }
}

async function probeClaudeVersionFromCli(): Promise<string> {
  const command = process.env.AIDE_CLAUDE_COMMAND?.trim() || 'claude'
  const { stdout } = await execFileAsync(command, ['--version'], {
    timeout: DISCOVERY_TIMEOUT_MS,
    windowsHide: true,
  })
  const version = readCliVersionOutput(stdout)

  if (!version) {
    throw new Error('Claude Code did not return a semantic version.')
  }

  return version
}

/**
 * Requests the documented app-server protocol directly. No assistant stream,
 * terminal transcript, or display text is consulted for capability discovery.
 */
async function listCodexModelsFromAppServer(): Promise<unknown> {
  const command = process.env.AIDE_CODEX_COMMAND?.trim() || 'codex'

  return await new Promise<unknown>((resolve, reject) => {
    const child = spawn(command, ['app-server'], {
      env: process.env,
      shell: process.platform === 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const output = readline.createInterface({ input: child.stdout })
    const models: unknown[] = []
    let completed = false
    let nextRequestId = 1
    let timeout: ReturnType<typeof setTimeout> | undefined

    const finish = (error: Error | null, result?: unknown) => {
      if (completed) {
        return
      }

      completed = true
      output.close()
      if (timeout) {
        clearTimeout(timeout)
      }
      if (!child.killed) {
        child.kill()
      }

      if (error) {
        reject(error)
      } else {
        resolve(result)
      }
    }

    const write = (message: unknown) => {
      if (!child.stdin.writable) {
        finish(new Error('Codex app-server stdin is not writable.'))
        return
      }

      child.stdin.write(`${JSON.stringify(message)}\n`)
    }

    const requestModels = (cursor: string | null) => {
      const id = nextRequestId++
      write({
        id,
        method: 'model/list',
        params: {
          cursor,
          includeHidden: false,
        },
      })
    }

    timeout = setTimeout(() => {
      finish(new Error('Timed out while discovering Codex models.'))
    }, DISCOVERY_TIMEOUT_MS)

    output.on('line', (line) => {
      let parsed: unknown

      try {
        parsed = JSON.parse(line)
      } catch {
        return
      }

      if (!isRecord(parsed)) {
        return
      }

      const id = readJsonRpcId(parsed.id)

      if (id === null) {
        return
      }

      if (isRecord(parsed.error)) {
        const message =
          typeof parsed.error.message === 'string'
            ? parsed.error.message
            : 'Codex app-server rejected a capability request.'
        finish(new Error(message))
        return
      }

      if (id === 1) {
        write({ method: 'initialized' })
        requestModels(null)
        return
      }

      if (!isRecord(parsed.result) || !Array.isArray(parsed.result.data)) {
        finish(
          new Error('Codex returned an invalid model capability response.'),
        )
        return
      }

      models.push(...parsed.result.data)
      const cursor = parsed.result.nextCursor

      if (typeof cursor === 'string' && cursor.length > 0) {
        requestModels(cursor)
        return
      }

      finish(null, { data: models })
    })

    child.on('error', (error) => finish(error))
    child.on('exit', (code) => {
      if (!completed) {
        finish(
          new Error(
            code === null
              ? 'Codex app-server exited while discovering models.'
              : `Codex app-server exited with code ${code} while discovering models.`,
          ),
        )
      }
    })

    write({
      id: nextRequestId++,
      method: 'initialize',
      params: buildCodexInitializeParams(),
    })
  })
}

function createFakeCodexModelList() {
  return {
    data: [
      {
        defaultReasoningEffort: 'medium',
        defaultServiceTier: 'priority',
        description: 'Fake Codex model for end-to-end tests.',
        displayName: 'GPT-5.6 Terra',
        hidden: false,
        id: 'gpt-5.6-terra',
        isDefault: true,
        model: 'gpt-5.6-terra',
        serviceTiers: [
          {
            description: 'Higher priority processing.',
            id: 'priority',
            name: 'Fast',
          },
        ],
        supportedReasoningEfforts: [
          { description: 'Fast responses.', reasoningEffort: 'low' },
          { description: 'Balanced reasoning.', reasoningEffort: 'medium' },
          { description: 'Thorough reasoning.', reasoningEffort: 'high' },
        ],
      },
    ],
  }
}

export class ProviderCapabilityService {
  private readonly listCodexModels: () => Promise<unknown>
  private readonly probeClaudeVersion: () => Promise<string>
  private snapshotPromise: Promise<ProviderCapabilitiesSnapshot> | null = null

  public constructor(options: ProviderCapabilityServiceOptions = {}) {
    const useFakeProviders =
      process.env.AIDE_FAKE_MANAGED_PROVIDERS === '1' ||
      process.env.AIDE_FAKE_MANAGED_PROVIDERS === 'fail-start'
    this.listCodexModels =
      options.listCodexModels ??
      (useFakeProviders
        ? async () => createFakeCodexModelList()
        : listCodexModelsFromAppServer)
    this.probeClaudeVersion =
      options.probeClaudeVersion ??
      (useFakeProviders ? async () => '2.1.0' : probeClaudeVersionFromCli)
  }

  public async getSnapshot(): Promise<ProviderCapabilitiesSnapshot> {
    this.snapshotPromise ??= this.discover()
    return await this.snapshotPromise
  }

  public async resolveManagedSessionConfig(
    input: unknown,
  ): Promise<ManagedSessionConfig> {
    const config = validateManagedSessionConfig(input)
    const { serviceTier: _serviceTier, ...configWithoutServiceTier } = config
    const resolution = await this.resolveSelection(config.mode, {
      effort: config.effort,
      modelId: config.model,
      serviceTier: config.serviceTier,
    })

    if (!resolution.modelId || !resolution.effort) {
      throw new Error(
        resolution.explanation ?? 'No compatible provider model is available.',
      )
    }

    return {
      ...configWithoutServiceTier,
      effort: resolution.effort,
      model: resolution.modelId,
      selectionNotice: resolution.explanation,
      ...(resolution.serviceTier
        ? { serviceTier: resolution.serviceTier }
        : {}),
    }
  }

  public async resolveManagedSessionProviderSelection(
    input: unknown,
  ): Promise<
    ManagedSessionProviderSelection & { selectionNotice: string | null }
  > {
    const selection = validateProviderSelection(input)
    const resolution = await this.resolveSelection(selection.mode, {
      effort: selection.effort,
      modelId: selection.model,
      serviceTier: selection.serviceTier,
    })

    if (!resolution.modelId || !resolution.effort) {
      throw new Error(
        resolution.explanation ?? 'No compatible provider model is available.',
      )
    }

    return {
      effort: resolution.effort,
      mode: selection.mode,
      model: resolution.modelId,
      selectionNotice: resolution.explanation,
      ...(resolution.serviceTier
        ? { serviceTier: resolution.serviceTier }
        : {}),
    }
  }

  private async discover(): Promise<ProviderCapabilitiesSnapshot> {
    const [claudeResult, codexResult] = await Promise.allSettled([
      this.probeClaudeVersion(),
      this.listCodexModels(),
    ])

    const claude =
      claudeResult.status === 'fulfilled'
        ? buildClaudeProviderCapabilities(claudeResult.value)
        : unavailableProviderCapabilities(
            'claude',
            `Unable to discover Claude capabilities: ${getErrorMessage(claudeResult.reason)}`,
          )
    const codex =
      codexResult.status === 'fulfilled'
        ? normalizeCodexModelList(codexResult.value)
        : unavailableProviderCapabilities(
            'codex',
            `Unable to discover Codex capabilities: ${getErrorMessage(codexResult.reason)}`,
          )

    return { providers: { claude, codex } }
  }

  private async resolveSelection(
    provider: ManagedSessionMode,
    selection: ProviderSelectionInput,
  ): Promise<ProviderSelectionResolution> {
    const snapshot = await this.getSnapshot()
    return resolveProviderSelection(snapshot.providers[provider], selection)
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown provider error'
}

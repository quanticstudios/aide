import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import readline from 'node:readline'
import { query } from '@anthropic-ai/claude-agent-sdk'

import type {
  ManagedSessionConfig,
  ManagedSessionProviderSelection,
} from '../shared/managed-session'
import {
  normalizeClaudeModelList,
  normalizeCodexModelList,
  type ProviderCapabilitiesSnapshot,
  type ProviderSelectionInput,
  type ProviderSelectionResolution,
  resolveProviderSelection,
  unavailableProviderCapabilities,
} from '../shared/provider-capabilities'
import type {
  ProviderSkill,
  ProviderSkillSelection,
  ProviderSkillsSnapshot,
  ResolvedProviderSkill,
} from '../shared/provider-skills'
import type { ManagedSessionMode } from '../shared/terminal'
import {
  getClaudeExecutablePath,
  sanitizeProviderEnvironment,
} from './managed-runtime-policy'

const DISCOVERY_TIMEOUT_MS = 15_000
const MAX_IPC_STRING_LENGTH = 4_096

interface ProviderCapabilityServiceOptions {
  readonly listClaudeModels?: () => Promise<unknown>
  readonly listClaudeSkills?: (cwd: string) => Promise<unknown>
  readonly listCodexModels?: () => Promise<unknown>
  readonly listCodexSkills?: (
    cwd: string,
    forceReload: boolean,
  ) => Promise<unknown>
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
    serviceTier:
      input.serviceTier === null
        ? null
        : validateString(input.serviceTier, 'service tier', {
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
    ...(selection.serviceTier !== undefined
      ? { serviceTier: selection.serviceTier }
      : {}),
    sessionId: validateString(input.sessionId, 'session id') ?? '',
    ...(thinkingBudget ? { thinkingBudget } : {}),
    workspaceId: validateString(input.workspaceId, 'workspace id') ?? '',
  }
}

async function* emptyClaudePrompt(): AsyncGenerator<never, void, unknown> {}

async function withClaudeDiscoveryRuntime<T>(
  cwd: string,
  settingSources: Array<'user' | 'project' | 'local'>,
  discover: (runtime: ReturnType<typeof query>) => Promise<T>,
): Promise<T> {
  const abortController = new AbortController()
  const cliPath = getClaudeExecutablePath(process.env)
  const runtime = query({
    options: {
      abortController,
      cwd,
      env: sanitizeProviderEnvironment(process.env),
      mcpServers: {},
      pathToClaudeCodeExecutable: cliPath,
      permissionMode: 'dontAsk',
      settingSources,
      strictMcpConfig: true,
      tools: [],
    },
    prompt: emptyClaudePrompt(),
  })
  let didTimeOut = false
  const timeout = setTimeout(() => {
    didTimeOut = true
    abortController.abort()
    runtime.close()
  }, DISCOVERY_TIMEOUT_MS)

  try {
    return await discover(runtime)
  } catch (error) {
    if (didTimeOut) {
      throw new Error('Timed out while discovering Claude capabilities.')
    }
    throw error
  } finally {
    clearTimeout(timeout)
    runtime.close()
  }
}

async function listClaudeModelsFromSdk(): Promise<unknown> {
  return await withClaudeDiscoveryRuntime(process.cwd(), [], (runtime) =>
    runtime.supportedModels(),
  )
}

async function listClaudeSkillsFromSdk(cwd: string): Promise<unknown> {
  return await withClaudeDiscoveryRuntime(
    cwd,
    ['user', 'project', 'local'],
    (runtime) => runtime.reloadSkills(),
  )
}

/**
 * Requests the documented app-server protocol directly. No assistant stream,
 * terminal transcript, or display text is consulted for capability discovery.
 */
async function listCodexFromAppServer(
  kind: 'models' | 'skills',
  cwd?: string,
  forceReload = false,
): Promise<unknown> {
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

    const requestCapabilities = (cursor: string | null) => {
      const id = nextRequestId++
      write({
        id,
        method: kind === 'models' ? 'model/list' : 'skills/list',
        params:
          kind === 'models'
            ? { cursor, includeHidden: false }
            : { cwds: cwd ? [cwd] : [], forceReload },
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
        requestCapabilities(null)
        return
      }

      if (!isRecord(parsed.result) || !Array.isArray(parsed.result.data)) {
        finish(new Error('Codex returned an invalid capability response.'))
        return
      }

      if (kind === 'skills') {
        finish(null, parsed.result)
        return
      }

      models.push(...parsed.result.data)
      const cursor = parsed.result.nextCursor

      if (typeof cursor === 'string' && cursor.length > 0) {
        requestCapabilities(cursor)
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

async function listCodexModelsFromAppServer(): Promise<unknown> {
  return await listCodexFromAppServer('models')
}

async function listCodexSkillsFromAppServer(
  cwd: string,
  forceReload: boolean,
): Promise<unknown> {
  return await listCodexFromAppServer('skills', cwd, forceReload)
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

function createFakeClaudeModelList() {
  return [
    {
      description: 'Fake Claude model for end-to-end tests.',
      displayName: 'Claude Sonnet 5',
      supportedEffortLevels: ['low', 'medium', 'high', 'max'],
      supportsEffort: true,
      value: 'claude-sonnet-5',
    },
    {
      description: 'Second fake Claude model for end-to-end tests.',
      displayName: 'Claude Opus 5',
      supportedEffortLevels: ['low', 'medium', 'high', 'max'],
      supportsEffort: true,
      value: 'claude-opus-5',
    },
  ]
}

function createFakeClaudeSkillList() {
  return {
    skills: [
      {
        description: 'Fake Claude skill for end-to-end tests.',
        name: 'claude-test-skill',
      },
    ],
  }
}

function createFakeCodexSkillList(cwd: string) {
  return {
    data: [
      {
        cwd,
        errors: [],
        skills: [
          {
            description: 'Fake Codex skill for end-to-end tests.',
            enabled: true,
            name: 'codex-test-skill',
            path: '/tmp/aide-fake-codex-test-skill/SKILL.md',
          },
        ],
      },
    ],
  }
}

interface ProviderSkillsCatalog {
  resolved: Map<string, ResolvedProviderSkill>
  snapshot: ProviderSkillsSnapshot
}

function catalogKey(selection: ProviderSkillSelection): string {
  return `${selection.provider}:${selection.id}`
}

function providerSkillId(
  provider: ProviderSkillSelection['provider'],
  nativeName: string,
  nativePath?: string,
): string {
  if (provider === 'claude') {
    return `claude:skill:${nativeName}`
  }
  const pathHash = createHash('sha256')
    .update(nativePath ?? nativeName)
    .digest('hex')
    .slice(0, 16)
  return `codex:skill:${pathHash}`
}

function readSkillEntries(value: unknown, property: string): unknown[] {
  return isRecord(value) && Array.isArray(value[property])
    ? value[property]
    : []
}

function normalizeClaudeSkills(value: unknown): ProviderSkill[] {
  const entries = readSkillEntries(value, 'skills')
  return entries.flatMap((entry) => {
    if (!isRecord(entry)) return []
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    if (!name) return []
    const description =
      typeof entry.description === 'string' && entry.description.trim()
        ? entry.description.trim()
        : name
    return [
      {
        description,
        id: providerSkillId('claude', name),
        name,
        owner: 'Claude' as const,
        provider: 'claude' as const,
      },
    ]
  })
}

function normalizeCodexSkills(
  value: unknown,
  cwd: string,
): {
  error?: string
  resolved: ResolvedProviderSkill[]
  skills: ProviderSkill[]
} {
  const directory = readSkillEntries(value, 'data').find(
    (entry) => isRecord(entry) && entry.cwd === cwd,
  )
  if (!directory) {
    return {
      error: 'Codex returned no skill catalog for this workspace.',
      resolved: [],
      skills: [],
    }
  }
  const errors = readSkillEntries(directory, 'errors')
  const error = errors
    .map((entry) =>
      isRecord(entry) && typeof entry.message === 'string'
        ? entry.message.trim()
        : '',
    )
    .find(Boolean)
  const pairs = readSkillEntries(directory, 'skills').flatMap((entry) => {
    if (!isRecord(entry) || entry.enabled !== true) return []
    const name = typeof entry.name === 'string' ? entry.name.trim() : ''
    const nativePath = typeof entry.path === 'string' ? entry.path.trim() : ''
    if (!name || !nativePath) return []
    const description =
      typeof entry.description === 'string' && entry.description.trim()
        ? entry.description.trim()
        : name
    const skill: ProviderSkill = {
      description,
      id: providerSkillId('codex', name, nativePath),
      name,
      owner: 'Codex',
      provider: 'codex',
    }
    return [
      {
        resolved: {
          id: skill.id,
          nativeName: name,
          nativePath,
          provider: 'codex' as const,
        },
        skill,
      },
    ]
  })
  return {
    ...(error ? { error } : {}),
    resolved: pairs.map((pair) => pair.resolved),
    skills: pairs.map((pair) => pair.skill),
  }
}

export class ProviderCapabilityService {
  private readonly listClaudeModels: () => Promise<unknown>
  private readonly listClaudeSkills: (cwd: string) => Promise<unknown>
  private readonly listCodexModels: () => Promise<unknown>
  private readonly listCodexSkills: (
    cwd: string,
    forceReload: boolean,
  ) => Promise<unknown>
  private snapshotPromise: Promise<ProviderCapabilitiesSnapshot> | null = null
  private readonly skillCatalogPromises = new Map<
    string,
    Promise<ProviderSkillsCatalog>
  >()

  public constructor(options: ProviderCapabilityServiceOptions = {}) {
    const useFakeProviders =
      process.env.AIDE_FAKE_MANAGED_PROVIDERS === '1' ||
      process.env.AIDE_FAKE_MANAGED_PROVIDERS === 'fail-start' ||
      process.env.AIDE_FAKE_MANAGED_PROVIDERS === 'missing-cli'
    this.listClaudeModels =
      options.listClaudeModels ??
      (useFakeProviders
        ? async () => createFakeClaudeModelList()
        : listClaudeModelsFromSdk)
    this.listCodexModels =
      options.listCodexModels ??
      (useFakeProviders
        ? async () => createFakeCodexModelList()
        : listCodexModelsFromAppServer)
    this.listClaudeSkills =
      options.listClaudeSkills ??
      (useFakeProviders
        ? async () => createFakeClaudeSkillList()
        : listClaudeSkillsFromSdk)
    this.listCodexSkills =
      options.listCodexSkills ??
      (useFakeProviders
        ? async (cwd) => createFakeCodexSkillList(cwd)
        : listCodexSkillsFromAppServer)
  }

  public async getSnapshot(): Promise<ProviderCapabilitiesSnapshot> {
    this.snapshotPromise ??= this.discover()
    return await this.snapshotPromise
  }

  public async getProviderSkills(
    workspaceId: string,
    cwd: string,
    forceReload = false,
  ): Promise<ProviderSkillsSnapshot> {
    if (forceReload) {
      this.skillCatalogPromises.delete(workspaceId)
    }
    let catalog = this.skillCatalogPromises.get(workspaceId)
    if (!catalog) {
      catalog = this.discoverSkills(cwd, forceReload)
      this.skillCatalogPromises.set(workspaceId, catalog)
    }
    return (await catalog).snapshot
  }

  public async resolveProviderSkill(
    workspaceId: string,
    cwd: string,
    input: unknown,
  ): Promise<ResolvedProviderSkill> {
    if (!isRecord(input)) {
      throw new Error('Invalid managed-session skill.')
    }
    const provider = input.provider
    if (provider !== 'claude' && provider !== 'codex') {
      throw new Error('Invalid managed-session skill provider.')
    }
    const selection: ProviderSkillSelection = {
      id: validateString(input.id, 'skill id') ?? '',
      provider,
    }
    const snapshot = await this.getProviderSkills(workspaceId, cwd)
    if (
      !snapshot.skills.some(
        (skill) => catalogKey(skill) === catalogKey(selection),
      )
    ) {
      throw new Error('Selected provider skill is unavailable.')
    }
    const catalog = await this.skillCatalogPromises.get(workspaceId)
    const resolved = catalog?.resolved.get(catalogKey(selection))
    if (!resolved) {
      throw new Error('Selected provider skill is unavailable.')
    }
    return { ...resolved }
  }

  public async resolveManagedSessionConfig(
    input: unknown,
  ): Promise<ManagedSessionConfig> {
    const config = validateManagedSessionConfig(input)
    const {
      effort: _effort,
      serviceTier: _serviceTier,
      ...resolvedConfig
    } = config
    const resolution = await this.resolveSelection(config.mode, {
      effort: config.effort,
      modelId: config.model,
      serviceTier: config.serviceTier,
    })

    if (!resolution.modelId) {
      throw new Error(
        resolution.explanation ?? 'No compatible provider model is available.',
      )
    }

    return {
      ...resolvedConfig,
      ...(resolution.effort ? { effort: resolution.effort } : {}),
      model: resolution.modelId,
      selectionNotice: resolution.explanation,
      ...(resolution.serviceTier
        ? { serviceTier: resolution.serviceTier }
        : config.serviceTier === null
          ? { serviceTier: null }
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

    if (!resolution.modelId) {
      throw new Error(
        resolution.explanation ?? 'No compatible provider model is available.',
      )
    }

    return {
      ...(resolution.effort ? { effort: resolution.effort } : {}),
      mode: selection.mode,
      model: resolution.modelId,
      selectionNotice: resolution.explanation,
      ...(resolution.serviceTier
        ? { serviceTier: resolution.serviceTier }
        : selection.serviceTier === null
          ? { serviceTier: null }
          : {}),
    }
  }

  private async discover(): Promise<ProviderCapabilitiesSnapshot> {
    const [claudeResult, codexResult] = await Promise.allSettled([
      this.listClaudeModels(),
      this.listCodexModels(),
    ])

    const claude =
      claudeResult.status === 'fulfilled'
        ? normalizeClaudeModelList(claudeResult.value)
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

  private async discoverSkills(
    cwd: string,
    forceReload: boolean,
  ): Promise<ProviderSkillsCatalog> {
    const [claudeResult, codexResult] = await Promise.allSettled([
      this.listClaudeSkills(cwd),
      this.listCodexSkills(cwd, forceReload),
    ])
    const errors: ProviderSkillsSnapshot['errors'] = {}
    const claude =
      claudeResult.status === 'fulfilled'
        ? normalizeClaudeSkills(claudeResult.value)
        : (() => {
            errors.claude = `Unable to discover Claude skills: ${getErrorMessage(claudeResult.reason)}`
            return []
          })()
    const codex =
      codexResult.status === 'fulfilled'
        ? normalizeCodexSkills(codexResult.value, cwd)
        : (() => {
            errors.codex = `Unable to discover Codex skills: ${getErrorMessage(codexResult.reason)}`
            return { error: undefined, resolved: [], skills: [] }
          })()
    if (codex.error) {
      errors.codex = codex.error
    }
    const resolved = new Map<string, ResolvedProviderSkill>()
    for (const skill of claude) {
      resolved.set(catalogKey(skill), {
        id: skill.id,
        nativeName: skill.name,
        provider: 'claude',
      })
    }
    for (const skill of codex.resolved) {
      resolved.set(catalogKey(skill), skill)
    }
    return {
      resolved,
      snapshot: {
        errors,
        skills: [
          ...new Map(
            [...claude, ...codex.skills].map((skill) => [
              catalogKey(skill),
              skill,
            ]),
          ).values(),
        ],
      },
    }
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

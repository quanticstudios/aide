import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdtempSync,
  rmSync,
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Options } from '@anthropic-ai/claude-agent-sdk'

export const READ_ONLY_CODEX_APP_SERVER_ARGUMENTS = [
  'app-server',
  '--strict-config',
  '-c',
  'agents.enabled=false',
  '-c',
  'features.apps=false',
  '-c',
  'features.hooks=false',
  '-c',
  'features.multi_agent=false',
  '-c',
  'features.remote_plugin=false',
  '-c',
  'features.shell_tool=false',
  '-c',
  'features.unified_exec=false',
  '-c',
  'web_search="disabled"',
] as const

export interface ReadOnlyCodexThreadStartPolicy<DynamicTool> {
  approvalPolicy: 'never'
  dynamicTools: DynamicTool[]
  environments: []
  sandbox: 'read-only'
}

export interface ReadOnlyCodexRuntimePolicy<DynamicTool> {
  appServerArguments: readonly string[]
  dispose(): void
  environment: NodeJS.ProcessEnv
  threadStart: ReadOnlyCodexThreadStartPolicy<DynamicTool>
}

export function sanitizeProviderEnvironment(
  environment: NodeJS.ProcessEnv,
): NodeJS.ProcessEnv {
  const { TYPESAFE_API_KEY: _typesafeApiKey, ...sanitized } = environment

  return sanitized
}

export function getClaudeExecutablePath(
  environment: NodeJS.ProcessEnv,
  resourcesPath = process.resourcesPath,
): string | undefined {
  const configured = environment.AIDE_CLAUDE_COMMAND?.trim()
  if (configured) return configured
  if (!resourcesPath) return undefined
  const executable = join(
    resourcesPath,
    'app.asar.unpacked/node_modules/@anthropic-ai',
    `claude-agent-sdk-${process.platform}-${process.arch}`,
    process.platform === 'win32' ? 'claude.exe' : 'claude',
  )
  return existsSync(executable) ? executable : undefined
}

export function createReadOnlyClaudeOptions(
  environment: NodeJS.ProcessEnv,
): Pick<
  Options,
  | 'env'
  | 'mcpServers'
  | 'permissionMode'
  | 'settingSources'
  | 'strictMcpConfig'
  | 'tools'
> {
  return {
    env: sanitizeProviderEnvironment(environment),
    mcpServers: {},
    permissionMode: 'default',
    settingSources: [],
    strictMcpConfig: true,
    tools: [],
  }
}

export function createReadOnlyCodexRuntimePolicy<DynamicTool>(
  dynamicTools: DynamicTool[],
  environment: NodeJS.ProcessEnv,
  authFile = join(
    environment.CODEX_HOME ?? join(homedir(), '.codex'),
    'auth.json',
  ),
): ReadOnlyCodexRuntimePolicy<DynamicTool> {
  if (!existsSync(authFile)) {
    throw new Error(
      'Codex authentication is unavailable for the isolated runtime.',
    )
  }

  const codexHome = mkdtempSync(join(tmpdir(), 'aide-codex-'))
  const isolatedAuthFile = join(codexHome, 'auth.json')

  try {
    chmodSync(codexHome, 0o700)
    copyFileSync(authFile, isolatedAuthFile)
    chmodSync(isolatedAuthFile, 0o600)
  } catch (error) {
    rmSync(codexHome, { force: true, recursive: true })
    throw error
  }

  return {
    appServerArguments: READ_ONLY_CODEX_APP_SERVER_ARGUMENTS,
    dispose: () => rmSync(codexHome, { force: true, recursive: true }),
    environment: {
      ...sanitizeProviderEnvironment(environment),
      CODEX_HOME: codexHome,
    },
    threadStart: {
      approvalPolicy: 'never',
      dynamicTools: [...dynamicTools],
      environments: [],
      sandbox: 'read-only',
    },
  }
}

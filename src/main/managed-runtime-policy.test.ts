import {
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createReadOnlyClaudeOptions,
  createReadOnlyCodexRuntimePolicy,
  sanitizeProviderEnvironment,
} from './managed-runtime-policy'

describe('managed runtime policy', () => {
  const runtimes: Array<{ dispose(): void }> = []

  afterEach(() => {
    for (const runtime of runtimes.splice(0)) {
      runtime.dispose()
    }
  })

  it('removes TYPESAFE_API_KEY without mutating the inherited environment', () => {
    const inherited = { PATH: '/bin', TYPESAFE_API_KEY: 'secret' }

    expect(sanitizeProviderEnvironment(inherited)).toEqual({ PATH: '/bin' })
    expect(inherited).toEqual({ PATH: '/bin', TYPESAFE_API_KEY: 'secret' })
  })

  it('allows Claude only read tools with no loaded settings or MCP servers', () => {
    expect(
      createReadOnlyClaudeOptions({
        PATH: '/bin',
        TYPESAFE_API_KEY: 'secret',
      }),
    ).toEqual({
      env: { PATH: '/bin' },
      mcpServers: {},
      permissionMode: 'default',
      settingSources: [],
      strictMcpConfig: true,
      tools: ['Read', 'Glob', 'Grep'],
    })
  })

  it('isolates Codex configuration and starts read-only without approvals or environments', () => {
    const sourceDirectory = mkdtempSync(join(tmpdir(), 'aide-codex-auth-'))
    const authFile = join(sourceDirectory, 'auth.json')
    writeFileSync(authFile, '{"token":"test"}')

    const runtime = createReadOnlyCodexRuntimePolicy(
      [{ name: 'find_relevant_context' }],
      {
        CODEX_HOME: '/configured/codex',
        PATH: '/bin',
        TYPESAFE_API_KEY: 'secret',
      },
      authFile,
    )
    rmSync(sourceDirectory, { force: true, recursive: true })
    runtimes.push(runtime)

    expect(runtime.appServerArguments).toEqual([
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
    ])
    expect(runtime.environment).toMatchObject({ PATH: '/bin' })
    expect(runtime.environment.TYPESAFE_API_KEY).toBeUndefined()
    expect(runtime.environment.CODEX_HOME).not.toBe('/configured/codex')
    const codexHome = runtime.environment.CODEX_HOME

    if (!codexHome) {
      throw new Error('The isolated Codex home is missing.')
    }

    expect(readdirSync(codexHome)).toEqual(['auth.json'])
    expect(statSync(codexHome).mode & 0o777).toBe(0o700)
    expect(statSync(join(codexHome, 'auth.json')).mode & 0o777).toBe(0o600)
    expect(runtime.threadStart).toEqual({
      approvalPolicy: 'never',
      dynamicTools: [{ name: 'find_relevant_context' }],
      environments: [],
      sandbox: 'read-only',
    })
  })

  it('refuses to start an isolated Codex runtime without copied authentication', () => {
    expect(() =>
      createReadOnlyCodexRuntimePolicy([], {}, '/not/a/real/auth.json'),
    ).toThrow('Codex authentication is unavailable for the isolated runtime.')
  })
})

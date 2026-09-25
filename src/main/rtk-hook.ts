import { execFile } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type {
  HookCallback,
  HookCallbackMatcher,
} from '@anthropic-ai/claude-agent-sdk'
import { resolveExecutablePath } from './executable-resolution'

async function findRtk(env: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    return await resolveExecutablePath('rtk', { env })
  } catch {
    // why: a desktop-launched Electron PATH lacks ~/.local/bin, where rtk's installer puts the binary.
    return resolveExecutablePath(
      join(env.HOME ?? homedir(), '.local', 'bin', 'rtk'),
      { env },
    ).catch(() => null)
  }
}

/** Rewrites Bash tool input through `rtk hook claude`; a no-op when rtk is absent or fails. */
export function createRtkPreToolUseHook(
  env: NodeJS.ProcessEnv = process.env,
): HookCallback {
  return async (input) => {
    if (input.hook_event_name !== 'PreToolUse' || input.tool_name !== 'Bash') {
      return {}
    }

    const rtk = await findRtk(env)
    if (!rtk) {
      return {}
    }

    const stdout = await new Promise<string>((resolve) => {
      const child = execFile(rtk, ['hook', 'claude'], { env }, (error, out) =>
        resolve(error ? '' : out),
      )
      child.stdin?.end(JSON.stringify(input))
    })

    try {
      return stdout.trim() ? JSON.parse(stdout) : {}
    } catch {
      return {}
    }
  }
}

export function createRtkHooks(
  env: NodeJS.ProcessEnv = process.env,
): { PreToolUse: HookCallbackMatcher[] } {
  return {
    PreToolUse: [{ hooks: [createRtkPreToolUseHook(env)], matcher: 'Bash' }],
  }
}

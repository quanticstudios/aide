import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface FocusStartupWorkspaceOptions {
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  runHyprctl?: (
    args: readonly string[],
    env: NodeJS.ProcessEnv,
  ) => Promise<void>
}

async function defaultRunHyprctl(
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<void> {
  await execFileAsync('hyprctl', [...args], { env })
}

export function shouldUseHyprlandStartupWorkspace(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === 'linux' && Boolean(env.HYPRLAND_INSTANCE_SIGNATURE)
}

export function resolveHyprlandStartupWorkspace(
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configuredWorkspace = env.AIDE_HYPRLAND_WORKSPACE?.trim()

  return configuredWorkspace || '1'
}

export async function focusHyprlandStartupWorkspace({
  env = process.env,
  platform = process.platform,
  runHyprctl = defaultRunHyprctl,
}: FocusStartupWorkspaceOptions = {}): Promise<boolean> {
  if (!shouldUseHyprlandStartupWorkspace(env, platform)) {
    return false
  }

  await runHyprctl(
    ['dispatch', 'workspace', resolveHyprlandStartupWorkspace(env)],
    env,
  )

  return true
}

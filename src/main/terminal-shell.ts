export interface TerminalLaunchConfig {
  args: string[]
  command: string
}

export function resolveTerminalLaunchConfig(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
): TerminalLaunchConfig {
  if (platform === 'win32') {
    return {
      args: [],
      command: env.ComSpec ?? 'cmd.exe',
    }
  }

  return {
    args: [],
    command: env.SHELL ?? '/bin/bash',
  }
}

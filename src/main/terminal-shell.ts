import { existsSync } from 'node:fs'

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

export function resolveTerminalWorkingDirectory(
  requestedCwd: string,
  homeDirectory: string,
  pathExists: (pathValue: string) => boolean = existsSync,
): string {
  const trimmedPath = requestedCwd.trim()

  if (trimmedPath && pathExists(trimmedPath)) {
    return trimmedPath
  }

  return homeDirectory
}

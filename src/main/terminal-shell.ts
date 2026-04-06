import { existsSync } from 'node:fs'

import type { TerminalLaunchMode } from '../shared/terminal'

export interface TerminalLaunchConfig {
  args: string[]
  command: string
}

export function resolveTerminalLaunchConfig(
  platform: NodeJS.Platform,
  env: NodeJS.ProcessEnv,
  mode: TerminalLaunchMode,
): TerminalLaunchConfig {
  if (mode === 'claude') {
    return {
      args: [],
      command: env.AIDE_CLAUDE_COMMAND?.trim() || 'claude',
    }
  }

  if (mode === 'codex') {
    return {
      args: [],
      command: env.AIDE_CODEX_COMMAND?.trim() || 'codex',
    }
  }

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

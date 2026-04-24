export type TerminalLaunchMode = 'shell' | 'claude' | 'codex' | 'agent'

export type ManagedSessionMode = 'claude' | 'codex'

export interface TerminalSessionConfig {
  cols: number
  cwd: string
  mode: TerminalLaunchMode
  paneId: string
  rows: number
  sessionId: string
  workspaceId: string
}

export interface TerminalResizeInput {
  cols: number
  rows: number
}

export interface TerminalSessionSnapshot {
  buffer: string
  exitCode: number | null
  running: boolean
}

export type TerminalEvent =
  | {
      data: string
      sessionId: string
      type: 'data'
    }
  | {
      exitCode: number | null
      sessionId: string
      type: 'exit'
    }

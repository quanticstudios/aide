export interface TerminalSessionConfig {
  cols: number
  cwd: string
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

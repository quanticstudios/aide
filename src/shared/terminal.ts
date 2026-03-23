export interface TerminalSessionConfig {
  cols: number
  cwd: string
  rows: number
  sessionId: string
}

export interface TerminalResizeInput {
  cols: number
  rows: number
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

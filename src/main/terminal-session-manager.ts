import { type IPty, spawn } from 'node-pty'

import type {
  TerminalEvent,
  TerminalResizeInput,
  TerminalSessionConfig,
} from '../shared/terminal'
import { resolveTerminalLaunchConfig } from './terminal-shell'

interface TerminalSessionManagerOptions {
  onEvent: (event: TerminalEvent) => void
}

export class TerminalSessionManager {
  private readonly sessions = new Map<string, IPty>()

  public constructor(private readonly options: TerminalSessionManagerOptions) {}

  public createSession(config: TerminalSessionConfig): void {
    this.killSession(config.sessionId)

    const launchConfig = resolveTerminalLaunchConfig(
      process.platform,
      process.env,
    )
    const pty = spawn(launchConfig.command, launchConfig.args, {
      cols: config.cols,
      cwd: config.cwd,
      env: process.env,
      name: 'xterm-color',
      rows: config.rows,
    })

    pty.onData((data) => {
      this.options.onEvent({
        data,
        sessionId: config.sessionId,
        type: 'data',
      })
    })

    pty.onExit(({ exitCode }) => {
      this.sessions.delete(config.sessionId)
      this.options.onEvent({
        exitCode,
        sessionId: config.sessionId,
        type: 'exit',
      })
    })

    this.sessions.set(config.sessionId, pty)
  }

  public killAll(): void {
    for (const sessionId of this.sessions.keys()) {
      this.killSession(sessionId)
    }
  }

  public killSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)

    if (!session) {
      return
    }

    session.kill()
    this.sessions.delete(sessionId)
  }

  public resizeSession(sessionId: string, size: TerminalResizeInput): void {
    this.sessions.get(sessionId)?.resize(size.cols, size.rows)
  }

  public writeToSession(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.write(data)
  }
}

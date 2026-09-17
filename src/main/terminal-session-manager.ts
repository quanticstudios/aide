import os from 'node:os'
import { type IPty, spawn } from 'node-pty'

import type {
  TerminalEvent,
  TerminalResizeInput,
  TerminalSessionConfig,
  TerminalSessionSnapshot,
} from '../shared/terminal'
import {
  resolveTerminalLaunchConfig,
  resolveTerminalWorkingDirectory,
} from './terminal-shell'

interface TerminalSessionManagerOptions {
  onEvent: (event: TerminalEvent) => void
}

interface TerminalSessionState {
  workspaceId: string
  paneId: string
  buffer: string
  exitCode: number | null
  pty: IPty | null
}

const MAX_BUFFER_LENGTH = 120_000

export class TerminalSessionManager {
  private quiescing = false
  private readonly sessions = new Map<string, TerminalSessionState>()

  public constructor(private readonly options: TerminalSessionManagerOptions) {}

  public createSession(config: TerminalSessionConfig): TerminalSessionSnapshot {
    if (this.quiescing) {
      throw new Error('Terminal sessions are unavailable while Aide restarts.')
    }
    const existingSession = this.sessions.get(config.sessionId)

    if (
      existingSession &&
      (existingSession.workspaceId !== config.workspaceId ||
        existingSession.paneId !== config.paneId)
    )
      throw new Error(
        'Terminal session does not belong to this workspace pane.',
      )

    if (existingSession && existingSession.pty !== null) {
      return this.toSnapshot(existingSession)
    }

    if (existingSession) {
      this.sessions.delete(config.sessionId)
    }

    const launchConfig = resolveTerminalLaunchConfig(
      process.platform,
      process.env,
      config.mode,
    )
    const sessionState: TerminalSessionState = {
      workspaceId: config.workspaceId,
      paneId: config.paneId,
      buffer: '',
      exitCode: null,
      pty: null,
    }
    const pty = spawn(launchConfig.command, launchConfig.args, {
      cols: config.cols,
      cwd: resolveTerminalWorkingDirectory(config.cwd, os.homedir()),
      env: process.env,
      name: 'xterm-color',
      rows: config.rows,
    })

    sessionState.pty = pty
    this.sessions.set(config.sessionId, sessionState)

    pty.onData((data) => {
      sessionState.buffer = `${sessionState.buffer}${data}`.slice(
        -MAX_BUFFER_LENGTH,
      )
      this.options.onEvent({
        data,
        sessionId: config.sessionId,
        type: 'data',
      })
    })

    pty.onExit(({ exitCode }) => {
      sessionState.exitCode = exitCode
      sessionState.pty = null
      this.options.onEvent({
        exitCode,
        sessionId: config.sessionId,
        type: 'exit',
      })
    })

    return this.toSnapshot(sessionState)
  }

  public killAll(): void {
    for (const sessionId of this.sessions.keys()) {
      this.killSession(sessionId)
    }
  }

  public getActiveSessionCount(): number {
    return [...this.sessions.values()].filter((session) => session.pty !== null)
      .length
  }

  /** Blocks new PTYs while an explicit update restart is being prepared. */
  public beginQuiescing(): () => void {
    this.quiescing = true
    return () => {
      this.quiescing = false
    }
  }

  public async closeAll(timeoutMs = 1_000): Promise<void> {
    const exits = [...this.sessions.values()].flatMap((session) => {
      const pty = session.pty
      if (!pty) {
        return []
      }

      return [
        new Promise<void>((resolve) => {
          const disposable = pty.onExit(() => {
            disposable.dispose()
            resolve()
          })
          pty.kill()
        }),
      ]
    })

    let timeout: ReturnType<typeof setTimeout> | undefined
    await Promise.race([
      Promise.allSettled(exits).then(() => undefined),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs)
      }),
    ])
    if (timeout) {
      clearTimeout(timeout)
    }
    this.sessions.clear()
  }

  public killSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)

    if (!session?.pty) {
      return
    }

    session.pty.kill()
  }

  public resizeSession(sessionId: string, size: TerminalResizeInput): void {
    this.sessions.get(sessionId)?.pty?.resize(size.cols, size.rows)
  }

  public writeToSession(sessionId: string, data: string): void {
    this.sessions.get(sessionId)?.pty?.write(data)
  }

  private toSnapshot(session: TerminalSessionState): TerminalSessionSnapshot {
    return {
      buffer: session.buffer,
      exitCode: session.exitCode,
      running: session.pty !== null,
    }
  }
}

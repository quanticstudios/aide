import { FitAddon } from '@xterm/addon-fit'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from 'xterm'

import type { AideApi } from '../../../shared/ipc'
import type { WorkspaceRecord } from '../../../shared/persistence'
import type { TerminalEvent } from '../../../shared/terminal'

interface TerminalPaneProps {
  readonly paneId: string
  readonly workspace: WorkspaceRecord
}

function getAideApi(): AideApi | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.aide ?? null
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Unknown terminal error'
}

export default function TerminalPane({ paneId, workspace }: TerminalPaneProps) {
  const sessionId = useMemo(
    () => `${workspace.id}:${paneId}`,
    [paneId, workspace.id],
  )
  const containerRef = useRef<HTMLDivElement | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const [error, setError] = useState<string | null>(null)

  const startSession = useCallback(async () => {
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current
    const aideApi = getAideApi()

    if (!terminal || !fitAddon || !aideApi) {
      setError(
        'Desktop bridge did not load. Open the Electron app window to use the terminal pane.',
      )
      return
    }

    fitAddon.fit()
    setError(null)
    terminal.clear()

    const snapshot = await aideApi.createTerminalSession({
      cols: terminal.cols,
      cwd: workspace.worktreePath || '~',
      rows: terminal.rows,
      sessionId,
    })

    if (snapshot.buffer) {
      terminal.write(snapshot.buffer)
    }

    if (!snapshot.running) {
      terminal.writeln('')
      terminal.writeln(
        `[terminal exited${snapshot.exitCode !== null ? `: ${snapshot.exitCode}` : ''}]`,
      )
    }
  }, [sessionId, workspace.worktreePath])

  useEffect(() => {
    const container = containerRef.current

    if (!container) {
      return
    }

    const terminal = new Terminal({
      allowTransparency: true,
      convertEol: true,
      cursorBlink: true,
      fontFamily:
        'JetBrainsMono Nerd Font, MesloLGS NF, Symbols Nerd Font Mono, IBM Plex Mono, monospace',
      fontSize: 13,
      theme: {
        background: '#0f131b',
        cursor: '#5cb89a',
        foreground: '#f4f4f5',
      },
    })
    const fitAddon = new FitAddon()

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    terminal.attachCustomKeyEventHandler((event) => {
      const normalizedKey = event.key.toLowerCase()
      const normalizedCode = event.code.toLowerCase()
      const isAltOnly = event.altKey && !event.ctrlKey && !event.metaKey
      const isCtrlProjectJump =
        event.ctrlKey &&
        !event.altKey &&
        !event.metaKey &&
        /^[1-9]$/.test(event.key)

      if (isCtrlProjectJump) {
        return false
      }

      if (!isAltOnly) {
        return true
      }

      if (
        event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight' ||
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown' ||
        normalizedKey === 'h' ||
        normalizedKey === 'j' ||
        normalizedKey === 'k' ||
        normalizedKey === 'l' ||
        normalizedCode === 'keyh' ||
        normalizedCode === 'keyj' ||
        normalizedCode === 'keyk' ||
        normalizedCode === 'keyl'
      ) {
        return false
      }

      return true
    })

    terminal.loadAddon(fitAddon)
    terminal.open(container)

    const aideApi = getAideApi()

    if (!aideApi) {
      setError(
        'Desktop bridge did not load. Open the Electron app window to use the terminal pane.',
      )
      terminal.writeln('')
      terminal.writeln('Terminal unavailable outside the desktop shell.')

      return () => {
        terminal.dispose()
        terminalRef.current = null
        fitAddonRef.current = null
      }
    }

    const unsubscribe = aideApi.onTerminalEvent((event: TerminalEvent) => {
      if (event.sessionId !== sessionId) {
        return
      }

      if (event.type === 'data') {
        terminal.write(event.data)
      }

      if (event.type === 'exit') {
        terminal.writeln('')
        terminal.writeln(
          `[terminal exited${event.exitCode !== null ? `: ${event.exitCode}` : ''}]`,
        )
      }
    })

    const inputDisposable = terminal.onData((data) => {
      void aideApi.writeTerminalInput(sessionId, data)
    })

    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      void aideApi.resizeTerminalSession(sessionId, { cols, rows })
    })

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      void aideApi.resizeTerminalSession(sessionId, {
        cols: terminal.cols,
        rows: terminal.rows,
      })
    })

    resizeObserver.observe(container)

    void startSession().catch((startError) => {
      setError(getErrorMessage(startError))
    })

    return () => {
      resizeObserver.disconnect()
      inputDisposable.dispose()
      resizeDisposable.dispose()
      unsubscribe()
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [sessionId, startSession])

  return (
    <div className="terminal-pane relative flex h-full min-h-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-[#0f131b]">
      {error ? (
        <div className="absolute left-3 right-3 top-3 z-10 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="h-full w-full p-3">
        <div className="h-full w-full" ref={containerRef} />
      </div>
    </div>
  )
}

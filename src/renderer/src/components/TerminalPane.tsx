import { FitAddon } from '@xterm/addon-fit'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from 'xterm'

import type { AideApi } from '../../../shared/ipc'
import type { WorkspaceRecord } from '../../../shared/persistence'
import { shouldBlockTerminalShortcutInput } from '../../../shared/shortcuts'
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

function safeFit(fitAddon: FitAddon): void {
  try {
    fitAddon.fit()
  } catch {
    // Ignore xterm fit errors until the terminal has valid render dimensions.
  }
}

function scheduleTerminalFocus(
  terminal: Terminal,
  container: HTMLDivElement,
): void {
  const focusTerminal = () => {
    if (!container.isConnected) {
      return
    }

    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur()
    }

    const textarea = container.querySelector<HTMLTextAreaElement>(
      '.xterm-helper-textarea',
    )

    if (textarea) {
      textarea.focus()
      return
    }

    terminal.focus()
  }

  requestAnimationFrame(() => {
    for (const delay of [0, 50, 150, 300, 600]) {
      window.setTimeout(focusTerminal, delay)
    }
  })
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

    safeFit(fitAddon)
    setError(null)
    terminal.clear()

    const snapshot = await aideApi.createTerminalSession({
      cols: terminal.cols,
      cwd: workspace.worktreePath || '~',
      paneId,
      rows: terminal.rows,
      sessionId,
      workspaceId: workspace.id,
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
  }, [paneId, sessionId, workspace.id, workspace.worktreePath])

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
        background: '#111114',
        black: '#16161a',
        blue: '#7aa2f7',
        brightBlack: '#2a2a31',
        brightBlue: '#7aa2f7',
        brightCyan: '#7dcfff',
        brightGreen: '#5cb89a',
        brightMagenta: '#bb9af7',
        brightRed: '#f87171',
        brightWhite: '#f4f4f5',
        brightYellow: '#e0af68',
        cursor: '#5cb89a',
        cursorAccent: '#111114',
        cyan: '#7dcfff',
        foreground: '#f4f4f5',
        green: '#5cb89a',
        magenta: '#bb9af7',
        red: '#f87171',
        selectionBackground: '#5cb89a33',
        white: '#a1a1aa',
        yellow: '#e0af68',
      },
    })
    const fitAddon = new FitAddon()

    terminalRef.current = terminal
    fitAddonRef.current = fitAddon

    terminal.attachCustomKeyEventHandler((event) => {
      return !shouldBlockTerminalShortcutInput({
        alt: event.altKey,
        code: event.code,
        control: event.ctrlKey,
        key: event.key,
        meta: event.metaKey,
      })
    })

    terminal.loadAddon(fitAddon)
    terminal.open(container)
    scheduleTerminalFocus(terminal, container)

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
      safeFit(fitAddon)
      void aideApi.resizeTerminalSession(sessionId, {
        cols: terminal.cols,
        rows: terminal.rows,
      })
    })

    resizeObserver.observe(container)

    void startSession()
      .then(() => {
        scheduleTerminalFocus(terminal, container)
      })
      .catch((startError) => {
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
    <div className="terminal-pane relative flex h-full min-h-0 flex-1 overflow-hidden rounded-xl border border-border/60 bg-background">
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

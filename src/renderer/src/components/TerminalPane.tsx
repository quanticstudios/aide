import { FitAddon } from '@xterm/addon-fit'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from 'xterm'

import type { AideApi } from '../../../shared/ipc'
import type { WorkspaceRecord } from '../../../shared/persistence'
import { shouldBlockTerminalShortcutInput } from '../../../shared/shortcuts'
import type { TerminalEvent } from '../../../shared/terminal'
import { resolveTerminalLaunchModeForPaneId } from '../lib/pane-catalog'

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
  const terminalMode = useMemo(
    () => resolveTerminalLaunchModeForPaneId(paneId),
    [paneId],
  )
  const containerRef = useRef<HTMLDivElement | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [exitCode, setExitCode] = useState<number | null>(null)

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

    setError(null)
    setExitCode(null)
    terminal.clear()

    const snapshot = await aideApi.createTerminalSession({
      cols: terminal.cols,
      cwd: workspace.worktreePath || '~',
      mode: terminalMode,
      paneId,
      rows: terminal.rows,
      sessionId,
      workspaceId: workspace.id,
    })

    if (snapshot.buffer) {
      terminal.write(snapshot.buffer)
    }

    if (!snapshot.running) {
      setExitCode(snapshot.exitCode)
    }
  }, [paneId, sessionId, terminalMode, workspace.id, workspace.worktreePath])

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
        'JetBrains Mono, JetBrainsMono Nerd Font, MesloLGS NF, Symbols Nerd Font Mono, monospace',
      fontSize: 13,
      theme: {
        background: '#07080a',
        black: '#0d0d0d',
        blue: '#57c1ff',
        brightBlack: '#242728',
        brightBlue: '#57c1ff',
        brightCyan: '#7dcfff',
        brightGreen: '#59d499',
        brightMagenta: '#bb9af7',
        brightRed: '#ff6161',
        brightWhite: '#ffffff',
        brightYellow: '#ffc533',
        cursor: '#ffffff',
        cursorAccent: '#07080a',
        cyan: '#7dcfff',
        foreground: '#f4f4f6',
        green: '#59d499',
        magenta: '#bb9af7',
        red: '#ff6161',
        selectionBackground: 'rgba(255,255,255,0.16)',
        white: '#cdcdcd',
        yellow: '#ffc533',
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
        setExitCode(event.exitCode)
      }
    })

    const inputDisposable = terminal.onData((data) => {
      void aideApi.writeTerminalInput(sessionId, data)
    })

    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      void aideApi.resizeTerminalSession(sessionId, { cols, rows })
    })

    const resizeObserver = new ResizeObserver(() => {
      if (container.clientHeight <= 0 || container.clientWidth <= 0) {
        return
      }

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
    <div className="terminal-pane relative flex h-full min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-background">
      {error ? (
        <div className="absolute left-3 right-3 top-3 z-10 rounded-md border border-accent-red bg-accent-red-soft px-3 py-2 text-sm text-accent-red">
          {error}
        </div>
      ) : null}

      {exitCode !== null ? (
        <div
          aria-live="polite"
          className="absolute bottom-3 left-3 right-3 z-10 flex items-center justify-between gap-3 rounded-md border border-border bg-surface/95 px-3 py-2 text-sm text-muted-foreground shadow-lg backdrop-blur"
        >
          <span>Shell exited with code {exitCode}.</span>
          <button
            className="rounded-md border border-border bg-[var(--surface-2)] px-2.5 py-1 text-xs font-semibold text-foreground transition-colors hover:border-primary/60"
            onClick={() => {
              void startSession().catch((startError) => {
                setError(getErrorMessage(startError))
              })
            }}
            type="button"
          >
            Restart terminal
          </button>
        </div>
      ) : null}

      <div className="h-full w-full p-3">
        <div className="h-full w-full" ref={containerRef} />
      </div>
    </div>
  )
}

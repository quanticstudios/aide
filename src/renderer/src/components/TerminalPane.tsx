import { Button, Chip, Kbd } from '@heroui/react'
import { FitAddon } from '@xterm/addon-fit'
import { RotateCcw, Square, TerminalSquare } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Terminal } from 'xterm'

import type { WorkspaceRecord } from '../../../shared/persistence'
import type { TerminalEvent } from '../../../shared/terminal'

interface TerminalPaneProps {
  readonly paneId: string
  readonly workspace: WorkspaceRecord
}

type TerminalStatus = 'connecting' | 'live' | 'exited'

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
  const [status, setStatus] = useState<TerminalStatus>('connecting')
  const [exitCode, setExitCode] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)

  const killSession = useCallback(async () => {
    await window.aide.killTerminalSession(sessionId)
  }, [sessionId])

  const startSession = useCallback(async () => {
    const terminal = terminalRef.current
    const fitAddon = fitAddonRef.current

    if (!terminal || !fitAddon) {
      return
    }

    fitAddon.fit()
    setStatus('connecting')
    setExitCode(null)
    setError(null)
    terminal.clear()

    await window.aide.createTerminalSession({
      cols: terminal.cols,
      cwd: workspace.worktreePath,
      rows: terminal.rows,
      sessionId,
    })

    setStatus('live')
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
      fontFamily: 'IBM Plex Mono, monospace',
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

    terminal.loadAddon(fitAddon)
    terminal.open(container)

    const unsubscribe = window.aide.onTerminalEvent((event: TerminalEvent) => {
      if (event.sessionId !== sessionId) {
        return
      }

      if (event.type === 'data') {
        terminal.write(event.data)
        setStatus('live')
      }

      if (event.type === 'exit') {
        setStatus('exited')
        setExitCode(event.exitCode)
      }
    })

    const inputDisposable = terminal.onData((data) => {
      void window.aide.writeTerminalInput(sessionId, data)
    })

    const resizeDisposable = terminal.onResize(({ cols, rows }) => {
      void window.aide.resizeTerminalSession(sessionId, { cols, rows })
    })

    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit()
      void window.aide.resizeTerminalSession(sessionId, {
        cols: terminal.cols,
        rows: terminal.rows,
      })
    })

    resizeObserver.observe(container)

    void startSession().catch((startError) => {
      setStatus('exited')
      setError(getErrorMessage(startError))
    })

    return () => {
      resizeObserver.disconnect()
      inputDisposable.dispose()
      resizeDisposable.dispose()
      unsubscribe()
      void window.aide.killTerminalSession(sessionId)
      terminal.dispose()
      terminalRef.current = null
      fitAddonRef.current = null
    }
  }, [sessionId, startSession])

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border/60 bg-[#0f131b] p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            Live terminal spike
          </p>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {workspace.worktreePath}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Chip size="sm" variant="secondary">
            {status === 'live'
              ? 'Live'
              : status === 'connecting'
                ? 'Connecting'
                : `Exit ${exitCode ?? '-'}`}
          </Chip>
          <div className="hidden items-center gap-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground lg:flex">
            <Kbd className="border-border/80 bg-surface-secondary text-[10px]">
              Ctrl
            </Kbd>
            <Kbd className="border-border/80 bg-surface-secondary text-[10px]">
              C
            </Kbd>
          </div>
          <Button
            isIconOnly
            onPress={() => void startSession()}
            size="sm"
            variant="ghost"
          >
            <RotateCcw className="size-4" />
          </Button>
          <Button
            isIconOnly
            onPress={() => void killSession()}
            size="sm"
            variant="ghost"
          >
            <Square className="size-4" />
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mb-3 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-lg border border-border/50 bg-black/20">
        <div className="h-full w-full" ref={containerRef} />
      </div>

      <div className="mt-3 flex items-center justify-between gap-3 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
        <span className="flex items-center gap-2">
          <TerminalSquare className="size-3.5" />
          PTY attached
        </span>
        <span>Resize-aware</span>
      </div>
    </div>
  )
}

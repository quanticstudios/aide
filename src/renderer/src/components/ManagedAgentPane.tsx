import { EmptyState } from '@heroui-pro/react'
import { Button, Chip, Surface, TextArea } from '@heroui/react'
import {
  ArrowDown,
  Bot,
  Brain,
  ChevronDown,
  CirclePause,
  Clipboard,
  ClipboardCheck,
  FileCode,
  LoaderCircle,
  Plug,
  RefreshCw,
  Send,
  Sparkles,
  Terminal,
  User,
} from 'lucide-react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ChangeEvent } from 'react'

import type { AideApi } from '../../../shared/ipc'
import type {
  ManagedSessionContentItem,
  ManagedSessionSnapshot,
} from '../../../shared/managed-session'
import type { WorkspaceRecord } from '../../../shared/persistence'
import {
  SLASH_COMMANDS,
  type SlashCommand,
  type SlashCommandContext,
  extractSlashQuery,
  filterSlashCommands,
} from '../lib/managed-slash-commands'
import { resolveTerminalLaunchModeForPaneId } from '../lib/pane-catalog'
import ContextWindowMeter from './ContextWindowMeter'
import ManagedPendingApprovalPanel from './ManagedPendingApprovalPanel'
import ManagedPendingUserInputPanel from './ManagedPendingUserInputPanel'

interface ManagedAgentPaneProps {
  readonly paneId: string
  readonly workspace: WorkspaceRecord
}

function getAideApi(): AideApi | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.aide ?? null
}

const isMac =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message
  }

  return 'Managed session failed.'
}

function formatSessionState(snapshot: ManagedSessionSnapshot | null): string {
  if (!snapshot) {
    return 'Connecting'
  }

  switch (snapshot.sessionState) {
    case 'connecting':
      return 'Connecting'
    case 'running':
      return 'Working'
    case 'waiting':
      return snapshot.pendingApprovals.length > 0
        ? 'Pending Approval'
        : 'Awaiting Input'
    case 'ready':
      return 'Ready'
    case 'error':
      return 'Error'
    case 'stopped':
      return 'Stopped'
  }
}

function getSessionStateClassName(
  snapshot: ManagedSessionSnapshot | null,
): string {
  if (!snapshot) {
    return 'border-primary/40 bg-primary/10 text-primary'
  }

  switch (snapshot.sessionState) {
    case 'waiting':
      return snapshot.pendingApprovals.length > 0
        ? 'border-warning/40 bg-warning/10 text-warning'
        : 'border-secondary/40 bg-secondary/10 text-secondary'
    case 'running':
    case 'connecting':
      return 'border-primary/40 bg-primary/10 text-primary'
    case 'error':
      return 'border-danger/40 bg-danger/10 text-danger'
    default:
      return 'border-success/40 bg-success/10 text-success'
  }
}

interface TurnGroup {
  items: ManagedSessionContentItem[]
  turnId: string | null
}

function groupContentByTurn(
  content: readonly ManagedSessionContentItem[],
): TurnGroup[] {
  const groups: TurnGroup[] = []
  let currentGroup: TurnGroup | null = null

  for (const item of content) {
    if (currentGroup && currentGroup.turnId === item.turnId) {
      currentGroup.items.push(item)
    } else {
      currentGroup = { items: [item], turnId: item.turnId }
      groups.push(currentGroup)
    }
  }

  return groups
}

function ContentItemBlock({
  item,
}: {
  readonly item: ManagedSessionContentItem
}) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (item.kind === 'user-prompt') {
    return (
      <div className="flex justify-end">
        <Surface
          className="max-w-[85%] rounded-2xl rounded-br-md border border-primary/20 bg-primary/5 px-4 py-3"
          data-testid={`managed-content-${item.kind}`}
        >
          <div className="flex items-center gap-2 pb-2">
            <User className="size-3 text-primary/60" />
            <p className="text-[10px] uppercase tracking-[0.18em] text-primary/60">
              You
            </p>
          </div>
          <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
            {item.text}
          </pre>
        </Surface>
      </div>
    )
  }

  if (item.kind === 'command-output') {
    const lines = item.text.split('\n')
    const isLong = lines.length > 20
    const displayText =
      isLong && !isExpanded ? lines.slice(0, 5).join('\n') : item.text

    return (
      <Surface
        className="rounded-xl border border-border/40 bg-[#0d0d10] px-4 py-3"
        data-testid={`managed-content-${item.kind}`}
      >
        <div className="flex items-center gap-2 pb-2">
          <Terminal className="size-3 text-emerald-500/70" />
          <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-500/70">
            Command output
          </p>
        </div>
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-emerald-100/80">
          {displayText}
        </pre>
        {isLong ? (
          <button
            className="mt-2 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setIsExpanded((prev) => !prev)}
            type="button"
          >
            {isExpanded ? 'Show less' : `Show ${lines.length - 5} more lines`}
          </button>
        ) : null}
      </Surface>
    )
  }

  if (item.kind === 'file-change-output') {
    return (
      <Surface
        className="rounded-xl border border-border/40 bg-[#0d0d10] px-4 py-3"
        data-testid={`managed-content-${item.kind}`}
      >
        <div className="flex items-center gap-2 pb-2">
          <FileCode className="size-3 text-amber-500/70" />
          <p className="text-[10px] uppercase tracking-[0.18em] text-amber-500/70">
            File changes
          </p>
        </div>
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground/80">
          {item.text}
        </pre>
      </Surface>
    )
  }

  if (
    item.kind === 'reasoning-text' ||
    item.kind === 'reasoning-summary-text'
  ) {
    return (
      <Surface
        className="rounded-xl border border-border/30 px-3 py-2"
        data-testid={`managed-content-${item.kind}`}
        variant="tertiary"
      >
        <button
          className="flex w-full items-center gap-2 text-left"
          onClick={() => setIsExpanded((prev) => !prev)}
          type="button"
        >
          <Brain className="size-3 text-violet-400/60" />
          <p className="text-[10px] uppercase tracking-[0.18em] text-violet-400/60">
            {item.kind === 'reasoning-text' ? 'Reasoning' : 'Reasoning summary'}
          </p>
          <ChevronDown
            className={`ml-auto size-3 text-muted-foreground transition-transform ${isExpanded ? 'rotate-180' : ''}`}
          />
        </button>
        {isExpanded ? (
          <pre className="mt-2 whitespace-pre-wrap break-words text-xs italic leading-relaxed text-muted-foreground">
            {item.text}
          </pre>
        ) : null}
      </Surface>
    )
  }

  if (item.kind === 'system') {
    return (
      <p
        className="px-1 text-xs text-muted-foreground/60"
        data-testid={`managed-content-${item.kind}`}
      >
        {item.text}
      </p>
    )
  }

  return (
    <Surface
      className="rounded-xl border border-border/40 px-4 py-3"
      data-testid={`managed-content-${item.kind}`}
      variant="secondary"
    >
      <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
        {item.text}
      </pre>
    </Surface>
  )
}

function TurnGroupBlock({
  group,
  isRetryReady,
  isRunning,
  onRetry,
  providerLabel,
}: {
  readonly group: TurnGroup
  readonly isRetryReady: boolean
  readonly isRunning: boolean
  readonly onRetry: (text: string) => void
  readonly providerLabel: string
}) {
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<number | null>(null)
  const userPromptItem = group.items.find((item) => item.kind === 'user-prompt')
  const canRetry = isRetryReady && Boolean(userPromptItem) && !isRunning

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current)
      }
    }
  }, [])

  const handleCopy = useCallback(async () => {
    const text = group.items
      .map((item) => {
        if (item.kind === 'user-prompt') {
          return `> ${item.text}`
        }

        return item.text
      })
      .join('\n\n')

    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)

      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current)
      }

      copyTimerRef.current = window.setTimeout(() => {
        setCopied(false)
      }, 1500)
    } catch {
      // ignore copy failure; clipboard may be unavailable in the shell
    }
  }, [group.items])

  return (
    <div className="group/turn relative space-y-2">
      {group.items.map((item) => (
        <ContentItemBlock item={item} key={`${item.kind}:${item.id}`} />
      ))}
      {isRunning ? (
        <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
          <LoaderCircle className="size-3 animate-spin text-primary" />
          {providerLabel} is working...
        </div>
      ) : null}
      {group.items.length > 0 ? (
        <div className="pointer-events-none absolute right-0 top-0 flex gap-1 opacity-0 transition-opacity group-hover/turn:pointer-events-auto group-hover/turn:opacity-100">
          {canRetry && userPromptItem ? (
            <button
              aria-label="Retry turn"
              className="flex items-center gap-1 rounded-lg border border-border/60 bg-surface-secondary px-2 py-1 text-[10px] text-muted-foreground shadow-sm transition-colors hover:text-foreground"
              onClick={() => onRetry(userPromptItem.text)}
              type="button"
            >
              <RefreshCw className="size-3" />
              Retry
            </button>
          ) : null}
          <button
            aria-label={copied ? 'Copied turn' : 'Copy turn'}
            className="flex items-center gap-1 rounded-lg border border-border/60 bg-surface-secondary px-2 py-1 text-[10px] text-muted-foreground shadow-sm transition-colors hover:text-foreground"
            onClick={() => void handleCopy()}
            type="button"
          >
            {copied ? (
              <ClipboardCheck className="size-3" />
            ) : (
              <Clipboard className="size-3" />
            )}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

type DraftAnswersState = Record<string, Record<string, string>>

export default function ManagedAgentPane({
  paneId,
  workspace,
}: ManagedAgentPaneProps) {
  const sessionId = useMemo(
    () => `${workspace.id}:${paneId}`,
    [paneId, workspace.id],
  )
  const terminalMode = useMemo(
    () => resolveTerminalLaunchModeForPaneId(paneId),
    [paneId],
  )
  const [snapshot, setSnapshot] = useState<ManagedSessionSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draftInput, setDraftInput] = useState('')
  const [draftAnswers, setDraftAnswers] = useState<DraftAnswersState>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [slashActiveIndex, setSlashActiveIndex] = useState(0)
  const startedSessionRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)

  const providerLabel =
    terminalMode === 'claude'
      ? 'Claude'
      : terminalMode === 'codex'
        ? 'Codex'
        : 'Managed'

  const loadOrCreateSession = useCallback(async () => {
    const api = getAideApi()

    if (!api || terminalMode === 'shell') {
      setError('Managed provider bridge did not load.')
      return
    }

    try {
      const snapshots = await api.getManagedSessionSnapshots()
      const existing = snapshots[sessionId] ?? null

      if (existing) {
        setSnapshot(existing)
        startedSessionRef.current = true
        return
      }

      const created = await api.createManagedSession({
        cwd: workspace.worktreePath || '~',
        mode: terminalMode,
        paneId,
        sessionId,
        workspaceId: workspace.id,
      })
      setSnapshot(created)
      startedSessionRef.current = true
      setError(null)
    } catch (sessionError) {
      setError(getErrorMessage(sessionError))
    }
  }, [paneId, sessionId, terminalMode, workspace.id, workspace.worktreePath])

  useEffect(() => {
    void loadOrCreateSession()
  }, [loadOrCreateSession])

  useEffect(() => {
    const api = getAideApi()

    if (!api) {
      return
    }

    return api.onManagedSessionEvent((event) => {
      if (event.type === 'removed') {
        if (event.sessionId === sessionId) {
          setSnapshot(null)
        }
        return
      }

      if (event.snapshot.sessionId !== sessionId) {
        return
      }

      setSnapshot(event.snapshot)
    })
  }, [sessionId])

  useEffect(() => {
    return () => {
      const api = getAideApi()

      if (!api || !startedSessionRef.current) {
        return
      }

      void api.closeManagedSession(sessionId).catch(() => undefined)
    }
  }, [sessionId])

  const contentLength = snapshot?.content.length ?? 0
  const pendingApprovalCount = snapshot?.pendingApprovals.length ?? 0
  const pendingUserInputCount = snapshot?.pendingUserInputs.length ?? 0
  // biome-ignore lint/correctness/useExhaustiveDependencies: counts are scroll triggers; effect intentionally re-runs when any of them change even though the body doesn't read them
  useLayoutEffect(() => {
    const el = scrollRef.current

    if (el && isAtBottom) {
      el.scrollTop = el.scrollHeight
    }
  }, [contentLength, pendingApprovalCount, pendingUserInputCount, isAtBottom])

  const handleScroll = useCallback(() => {
    const el = scrollRef.current

    if (!el) {
      return
    }

    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 50)
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current

    if (el) {
      el.scrollTop = el.scrollHeight
      setIsAtBottom(true)
    }
  }, [])

  const sendPromptText = useCallback(
    async (text: string) => {
      const api = getAideApi()
      const trimmed = text.trim()

      if (!api || !trimmed) {
        return
      }

      setIsSubmitting(true)

      try {
        await api.sendManagedSessionInput(sessionId, trimmed)
        setError(null)
      } catch (sendError) {
        setError(getErrorMessage(sendError))
      } finally {
        setIsSubmitting(false)
      }
    },
    [sessionId],
  )

  const handleSendInput = useCallback(async () => {
    await sendPromptText(draftInput)
    setDraftInput('')
  }, [draftInput, sendPromptText])

  const handleRetryTurn = useCallback(
    async (text: string) => {
      await sendPromptText(text)
    },
    [sendPromptText],
  )

  const handleResolveApproval = useCallback(
    async (
      requestId: string,
      decision: 'accept' | 'accept-for-session' | 'deny',
    ) => {
      const api = getAideApi()

      if (!api) {
        return
      }

      try {
        await api.resolveManagedSessionRequest(sessionId, requestId, decision)
      } catch (resolveError) {
        setError(getErrorMessage(resolveError))
      }
    },
    [sessionId],
  )

  const handleDraftAnswerChange = useCallback(
    (requestId: string, questionId: string, value: string) => {
      setDraftAnswers((current) => ({
        ...current,
        [requestId]: {
          ...(current[requestId] ?? {}),
          [questionId]: value,
        },
      }))
    },
    [],
  )

  const handleResolveUserInput = useCallback(
    async (requestId: string) => {
      const api = getAideApi()
      const request = snapshot?.pendingUserInputs.find(
        (entry) => entry.id === requestId,
      )

      if (!api || !request) {
        return
      }

      const answers = Object.fromEntries(
        request.questions
          .map((question) => {
            const answer = draftAnswers[requestId]?.[question.id]?.trim()
            return answer ? [question.id, answer] : null
          })
          .filter((entry): entry is [string, string] => entry !== null),
      )

      if (Object.keys(answers).length !== request.questions.length) {
        return
      }

      try {
        await api.resolveManagedSessionUserInput(sessionId, requestId, answers)
        setDraftAnswers((current) => {
          const next = { ...current }
          delete next[requestId]
          return next
        })
      } catch (resolveError) {
        setError(getErrorMessage(resolveError))
      }
    },
    [draftAnswers, sessionId, snapshot?.pendingUserInputs],
  )

  const turnGroups = useMemo(
    () => groupContentByTurn(snapshot?.content ?? []),
    [snapshot?.content],
  )

  const slashContext = useMemo<SlashCommandContext>(
    () => ({
      clearDraft: () => setDraftInput(''),
      copyTranscript: async () => {
        const text = (snapshot?.content ?? [])
          .map((item) => {
            if (item.kind === 'user-prompt') {
              return `> ${item.text}`
            }

            return item.text
          })
          .join('\n\n')

        if (text.length === 0) {
          return
        }

        try {
          await navigator.clipboard.writeText(text)
        } catch {
          // clipboard unavailable in some shells
        }
      },
      interrupt: () => {
        const api = getAideApi()
        if (api) {
          void api.interruptManagedSession(sessionId)
        }
      },
      sessionState: snapshot?.sessionState,
      setDraft: (text: string) => setDraftInput(text),
    }),
    [sessionId, snapshot?.content, snapshot?.sessionState],
  )

  const slashQuery = extractSlashQuery(draftInput)
  const filteredSlashCommands = useMemo<SlashCommand[]>(
    () =>
      slashQuery === null
        ? []
        : filterSlashCommands(SLASH_COMMANDS, slashQuery, slashContext),
    [slashContext, slashQuery],
  )
  const slashMenuOpen = filteredSlashCommands.length > 0 && slashQuery !== null

  // biome-ignore lint/correctness/useExhaustiveDependencies: slashQuery is an intentional trigger even though it's not read in the effect body
  useEffect(() => {
    setSlashActiveIndex(0)
  }, [slashQuery])

  const runSlashCommand = useCallback(
    async (command: SlashCommand) => {
      await command.run(slashContext)
    },
    [slashContext],
  )

  const runningTurnId = useMemo(
    () => snapshot?.turns.find((turn) => turn.state === 'running')?.id ?? null,
    [snapshot?.turns],
  )

  return (
    <section
      className="managed-agent-pane flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-background"
      data-testid="managed-agent-pane"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            {providerLabel}
          </h2>
          <Chip
            className={getSessionStateClassName(snapshot)}
            size="sm"
            variant="secondary"
          >
            {formatSessionState(snapshot)}
          </Chip>
          {snapshot?.detail ? (
            <span className="text-xs text-muted-foreground">
              {snapshot.detail}
            </span>
          ) : null}
        </div>

        <div className="flex items-center gap-2">
          {snapshot?.usage ? (
            <ContextWindowMeter usage={snapshot.usage} />
          ) : null}
          <Button
            isDisabled={!snapshot || snapshot.sessionState !== 'running'}
            onPress={() => {
              const api = getAideApi()
              if (api) {
                void api.interruptManagedSession(sessionId)
              }
            }}
            size="sm"
            variant="ghost"
          >
            <CirclePause className="size-3.5" />
            Interrupt
          </Button>
        </div>
      </div>

      {error ? (
        <div className="border-b border-danger/30 bg-danger/10 px-4 py-2.5 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div
        className="relative min-h-0 flex-1 overflow-y-auto px-4 py-4"
        data-testid="managed-session-content"
        onScroll={handleScroll}
        ref={scrollRef}
      >
        {turnGroups.length > 0 ? (
          <div className="mx-auto max-w-3xl space-y-4">
            {turnGroups.map((group) => (
              <TurnGroupBlock
                group={group}
                isRetryReady={
                  snapshot?.sessionState === 'ready' ||
                  snapshot?.sessionState === 'stopped'
                }
                isRunning={
                  group.turnId !== null && group.turnId === runningTurnId
                }
                key={group.turnId ?? `system-${group.items[0]?.id}`}
                onRetry={(text) => void handleRetryTurn(text)}
                providerLabel={providerLabel}
              />
            ))}

            {snapshot?.pendingApprovals.map((approval) => (
              <ManagedPendingApprovalPanel
                approval={approval}
                key={approval.id}
                onResolve={(requestId, decision) =>
                  void handleResolveApproval(requestId, decision)
                }
              />
            ))}

            {snapshot?.pendingUserInputs.map((request) => (
              <ManagedPendingUserInputPanel
                answers={draftAnswers[request.id] ?? {}}
                key={request.id}
                onAnswerChange={(questionId, value) =>
                  handleDraftAnswerChange(request.id, questionId, value)
                }
                onSubmit={(requestId) => void handleResolveUserInput(requestId)}
                request={request}
              />
            ))}

            {snapshot?.sessionState === 'running' && runningTurnId === null ? (
              <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                <LoaderCircle className="size-3 animate-spin text-primary" />
                {providerLabel} is working...
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <EmptyState size="sm">
              <EmptyState.Header>
                <EmptyState.Media variant="icon">
                  {snapshot?.sessionState === 'connecting' ? (
                    <Plug />
                  ) : snapshot?.sessionState === 'ready' ? (
                    <Sparkles />
                  ) : (
                    <Bot />
                  )}
                </EmptyState.Media>
                <EmptyState.Title>
                  {snapshot?.sessionState === 'connecting'
                    ? `Connecting to ${providerLabel}`
                    : snapshot?.sessionState === 'ready'
                      ? `${providerLabel} is ready`
                      : `Waiting for ${providerLabel}`}
                </EmptyState.Title>
                <EmptyState.Description>
                  {snapshot?.sessionState === 'ready'
                    ? 'Send a prompt below to start a turn.'
                    : snapshot?.sessionState === 'connecting'
                      ? 'Spinning up the managed session…'
                      : 'The provider is warming up.'}
                </EmptyState.Description>
              </EmptyState.Header>
            </EmptyState>
          </div>
        )}

        {!isAtBottom ? (
          <button
            className="sticky bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border/60 bg-surface-secondary px-3 py-1.5 text-xs text-muted-foreground shadow-md transition-colors hover:bg-surface-tertiary hover:text-foreground"
            onClick={scrollToBottom}
            type="button"
          >
            <ArrowDown className="mr-1 inline size-3" />
            Jump to latest
          </button>
        ) : null}
      </div>

      <div className="border-t border-border/60 px-4 py-3">
        <div className="mx-auto flex max-w-3xl flex-col gap-2">
          <div className="relative flex gap-2">
            {slashMenuOpen ? (
              <div
                className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-sm rounded-xl border border-border/70 bg-surface shadow-[0_18px_50px_rgba(0,0,0,0.35)]"
                data-testid="managed-slash-menu"
              >
                <div className="px-3 py-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Slash commands
                </div>
                <ul className="max-h-60 overflow-y-auto p-1">
                  {filteredSlashCommands.map((command, index) => {
                    const isActive = index === slashActiveIndex

                    return (
                      <li key={command.id}>
                        <button
                          className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                            isActive
                              ? 'bg-primary/12 text-foreground'
                              : 'text-foreground/80 hover:bg-surface-secondary'
                          }`}
                          onClick={() => {
                            void runSlashCommand(command)
                          }}
                          onMouseEnter={() => setSlashActiveIndex(index)}
                          type="button"
                        >
                          <span className="flex min-w-0 flex-col">
                            <span className="truncate font-medium">
                              {command.label}
                            </span>
                            <span className="truncate text-xs text-muted-foreground">
                              {command.description}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
              </div>
            ) : null}
            <TextArea
              aria-label={`${providerLabel} prompt`}
              className="flex-1"
              onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                setDraftInput(event.target.value)
              }
              onKeyDown={(event) => {
                if (slashMenuOpen) {
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    setSlashActiveIndex(
                      (index) => (index + 1) % filteredSlashCommands.length,
                    )
                    return
                  }

                  if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    setSlashActiveIndex(
                      (index) =>
                        (index - 1 + filteredSlashCommands.length) %
                        filteredSlashCommands.length,
                    )
                    return
                  }

                  if (
                    event.key === 'Enter' &&
                    !event.metaKey &&
                    !event.ctrlKey
                  ) {
                    event.preventDefault()
                    const command = filteredSlashCommands[slashActiveIndex]
                    if (command) {
                      void runSlashCommand(command)
                    }
                    return
                  }

                  if (event.key === 'Escape') {
                    event.preventDefault()
                    setDraftInput('')
                    return
                  }
                }

                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault()
                  if (isSubmitting || draftInput.trim().length === 0) {
                    return
                  }
                  void handleSendInput()
                }
              }}
              placeholder={`Send a prompt to ${providerLabel}... (type / for commands)`}
              value={draftInput}
              variant="secondary"
            />
            <Button
              isDisabled={isSubmitting || draftInput.trim().length === 0}
              onPress={() => void handleSendInput()}
              variant="primary"
            >
              {isSubmitting ? (
                <LoaderCircle className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          </div>
          <div className="flex items-center justify-between px-1 text-[10px] text-muted-foreground">
            <span>
              {draftInput.length > 0
                ? `${draftInput.length.toLocaleString()} chars`
                : ''}
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded border border-border/60 bg-surface-secondary px-1.5 py-0.5 font-mono text-[10px]">
                {isMac ? '⌘' : 'Ctrl'}
              </kbd>
              <kbd className="rounded border border-border/60 bg-surface-secondary px-1.5 py-0.5 font-mono text-[10px]">
                ↵
              </kbd>
              <span>to send</span>
            </span>
          </div>
        </div>
      </div>
    </section>
  )
}

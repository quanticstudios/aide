import { Button, Chip, Input, Surface, TextArea } from '@heroui/react'
import {
  AlertTriangle,
  ArrowDown,
  Brain,
  Check,
  ChevronDown,
  CirclePause,
  FileCode,
  LoaderCircle,
  Send,
  Terminal,
  User,
  X,
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
import { resolveTerminalLaunchModeForPaneId } from '../lib/pane-catalog'

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

  const handleSendInput = useCallback(async () => {
    const api = getAideApi()
    const trimmed = draftInput.trim()

    if (!api || !trimmed) {
      return
    }

    setIsSubmitting(true)

    try {
      await api.sendManagedSessionInput(sessionId, trimmed)
      setDraftInput('')
      setError(null)
    } catch (sendError) {
      setError(getErrorMessage(sendError))
    } finally {
      setIsSubmitting(false)
    }
  }, [draftInput, sessionId])

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
              <div
                className="space-y-2"
                key={group.turnId ?? `system-${group.items[0]?.id}`}
              >
                {group.items.map((item) => (
                  <ContentItemBlock
                    item={item}
                    key={`${item.kind}:${item.id}`}
                  />
                ))}
                {group.turnId !== null && group.turnId === runningTurnId ? (
                  <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                    <LoaderCircle className="size-3 animate-spin text-primary" />
                    {providerLabel} is working...
                  </div>
                ) : null}
              </div>
            ))}

            {snapshot?.pendingApprovals.map((approval) => (
              <Surface
                className="mx-auto max-w-3xl rounded-xl border border-warning/30 bg-warning/5 px-4 py-3"
                data-testid={`managed-approval-${approval.id}`}
                key={approval.id}
              >
                <div className="flex items-start gap-3">
                  <AlertTriangle className="mt-0.5 size-4 text-warning" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-foreground">
                      Approval required
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {approval.detail ?? approval.requestType}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button
                        onPress={() =>
                          void handleResolveApproval(approval.id, 'accept')
                        }
                        size="sm"
                        variant="primary"
                      >
                        <Check className="size-3.5" />
                        Allow once
                      </Button>
                      <Button
                        onPress={() =>
                          void handleResolveApproval(
                            approval.id,
                            'accept-for-session',
                          )
                        }
                        size="sm"
                        variant="secondary"
                      >
                        <Check className="size-3.5" />
                        Allow for session
                      </Button>
                      <Button
                        onPress={() =>
                          void handleResolveApproval(approval.id, 'deny')
                        }
                        size="sm"
                        variant="ghost"
                      >
                        <X className="size-3.5" />
                        Deny
                      </Button>
                    </div>
                  </div>
                </div>
              </Surface>
            ))}

            {snapshot?.pendingUserInputs.map((request) => (
              <Surface
                className="mx-auto max-w-3xl rounded-xl border border-secondary/30 bg-secondary/5 px-4 py-3"
                data-testid={`managed-input-${request.id}`}
                key={request.id}
              >
                <p className="text-sm font-medium text-foreground">
                  User input requested
                </p>
                <div className="mt-3 space-y-4">
                  {request.questions.map((question) => (
                    <div className="space-y-2" key={question.id}>
                      {question.header ? (
                        <p className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                          {question.header}
                        </p>
                      ) : null}
                      <p className="text-sm text-foreground">
                        {question.prompt}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {question.options.map((option) => {
                          const selected =
                            draftAnswers[request.id]?.[question.id] ===
                            option.label

                          return (
                            <Button
                              key={option.id}
                              onPress={() =>
                                handleDraftAnswerChange(
                                  request.id,
                                  question.id,
                                  option.label,
                                )
                              }
                              size="sm"
                              variant={selected ? 'secondary' : 'ghost'}
                            >
                              {option.label}
                            </Button>
                          )
                        })}
                      </div>
                      <Input
                        aria-label={`${question.prompt} answer`}
                        onChange={(event: ChangeEvent<HTMLInputElement>) =>
                          handleDraftAnswerChange(
                            request.id,
                            question.id,
                            event.target.value,
                          )
                        }
                        placeholder="Type a custom answer"
                        value={draftAnswers[request.id]?.[question.id] ?? ''}
                        variant="secondary"
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-4">
                  <Button
                    isDisabled={request.questions.some(
                      (question) =>
                        (draftAnswers[request.id]?.[question.id] ?? '').trim()
                          .length === 0,
                    )}
                    onPress={() => void handleResolveUserInput(request.id)}
                    size="sm"
                    variant="primary"
                  >
                    Submit answers
                  </Button>
                </div>
              </Surface>
            ))}

            {snapshot?.sessionState === 'running' && runningTurnId === null ? (
              <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                <LoaderCircle className="size-3 animate-spin text-primary" />
                {providerLabel} is working...
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            {snapshot?.sessionState === 'connecting'
              ? `Connecting to ${providerLabel}...`
              : snapshot?.sessionState === 'ready'
                ? `${providerLabel} is ready. Send a prompt to start.`
                : `Waiting for ${providerLabel}...`}
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
        <div className="mx-auto flex max-w-3xl gap-2">
          <TextArea
            aria-label={`${providerLabel} prompt`}
            className="flex-1"
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
              setDraftInput(event.target.value)
            }
            onKeyDown={(event) => {
              if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                event.preventDefault()
                if (isSubmitting || draftInput.trim().length === 0) {
                  return
                }
                void handleSendInput()
              }
            }}
            placeholder={`Send a prompt to ${providerLabel}...`}
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
      </div>
    </section>
  )
}

import { Button, Chip, Input, Surface, TextArea } from '@heroui/react'
import {
  AlertTriangle,
  Check,
  CirclePause,
  LoaderCircle,
  Send,
  Square,
  X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent } from 'react'

import type { AideApi } from '../../../shared/ipc'
import type { ManagedSessionSnapshot } from '../../../shared/managed-session'
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

  return (
    <section
      className="managed-agent-pane flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-background"
      data-testid="managed-agent-pane"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/70 px-5 py-4">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
            <Square className="size-3.5" />
            Managed {providerLabel} session
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              {providerLabel}
            </h2>
            <Chip
              className={getSessionStateClassName(snapshot)}
              size="sm"
              variant="secondary"
            >
              {formatSessionState(snapshot)}
            </Chip>
          </div>
          <p className="text-xs text-muted-foreground">
            {workspace.worktreePath}
          </p>
        </div>

        <div className="flex items-center gap-2">
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
            <CirclePause className="size-4" />
            Interrupt
          </Button>
        </div>
      </div>

      {error ? (
        <div className="border-b border-danger/30 bg-danger/10 px-5 py-3 text-sm text-danger">
          {error}
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-[minmax(0,1fr)_20rem]">
        <Surface
          className="flex min-h-0 flex-col overflow-hidden rounded-2xl border border-border/70"
          variant="secondary"
        >
          <div className="border-b border-border/60 px-4 py-3">
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Session stream
            </p>
          </div>

          <div
            className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-4"
            data-testid="managed-session-content"
          >
            {snapshot?.content.length ? (
              snapshot.content.map((item) => (
                <Surface
                  className="rounded-2xl border border-border/60 px-4 py-3"
                  data-testid={`managed-content-${item.kind}`}
                  key={`${item.kind}:${item.id}`}
                  variant="secondary"
                >
                  <p className="mb-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                    {item.kind.replaceAll('-', ' ')}
                  </p>
                  <pre className="whitespace-pre-wrap break-words font-mono text-sm text-foreground">
                    {item.text}
                  </pre>
                </Surface>
              ))
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Waiting for the first provider event…
              </div>
            )}
          </div>

          <div className="border-t border-border/60 px-4 py-4">
            <div className="flex gap-2">
              <TextArea
                aria-label={`${providerLabel} prompt`}
                className="flex-1"
                onChange={(event: ChangeEvent<HTMLTextAreaElement>) =>
                  setDraftInput(event.target.value)
                }
                onKeyDown={(event) => {
                  if (
                    (event.metaKey || event.ctrlKey) &&
                    event.key === 'Enter'
                  ) {
                    event.preventDefault()
                    void handleSendInput()
                  }
                }}
                placeholder={`Send a prompt to ${providerLabel}`}
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
                Send
              </Button>
            </div>
          </div>
        </Surface>

        <div className="flex min-h-0 flex-col gap-4 overflow-y-auto">
          <Surface
            className="rounded-2xl border border-border/70 px-4 py-4"
            variant="secondary"
          >
            <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
              Runtime
            </p>
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              <p data-testid="managed-session-state">
                {formatSessionState(snapshot)}
              </p>
              {snapshot?.detail ? (
                <p data-testid="managed-session-detail">{snapshot.detail}</p>
              ) : null}
              {snapshot?.lastError ? (
                <p className="text-danger">{snapshot.lastError}</p>
              ) : null}
            </div>
          </Surface>

          {snapshot?.pendingApprovals.map((approval) => (
            <Surface
              className="rounded-2xl border border-warning/30 bg-warning/5 px-4 py-4"
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
                      <Check className="size-4" />
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
                      <Check className="size-4" />
                      Allow for session
                    </Button>
                    <Button
                      onPress={() =>
                        void handleResolveApproval(approval.id, 'deny')
                      }
                      size="sm"
                      variant="ghost"
                    >
                      <X className="size-4" />
                      Deny
                    </Button>
                  </div>
                </div>
              </div>
            </Surface>
          ))}

          {snapshot?.pendingUserInputs.map((request) => (
            <Surface
              className="rounded-2xl border border-secondary/30 bg-secondary/5 px-4 py-4"
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
                      <p className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                        {question.header}
                      </p>
                    ) : null}
                    <p className="text-sm text-foreground">{question.prompt}</p>
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
        </div>
      </div>
    </section>
  )
}

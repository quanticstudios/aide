import { Button, Surface } from '@heroui/react'
import {
  ArrowDown,
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  CirclePause,
  Clipboard,
  ClipboardCheck,
  ClipboardList,
  FileCode,
  FolderOpen,
  GitBranch,
  LoaderCircle,
  Lock,
  PenLine,
  RefreshCw,
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
import MarkdownContent from './MarkdownContent'

import type { AideApi } from '../../../shared/ipc'
import type {
  ManagedSessionContentItem,
  ManagedSessionEffort,
  ManagedSessionPermissionMode,
  ManagedSessionSnapshot,
} from '../../../shared/managed-session'
import type { WorkspaceRecord } from '../../../shared/persistence'
import type { ManagedSessionMode } from '../../../shared/terminal'
import { useWorkspaceGitStatus } from '../hooks/useWorkspaceGitStatus'
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
import ModelSelector from './ModelSelector'
import OpenInEditorButton from './OpenInEditorButton'

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

const EFFORT_OPTIONS: ReadonlyArray<{
  label: string
  value: ManagedSessionEffort
}> = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
  { label: 'Extra High (default)', value: 'max' },
]

const PERMISSION_OPTIONS: ReadonlyArray<{
  description: string
  icon: typeof Lock
  label: string
  value: ManagedSessionPermissionMode
}> = [
  {
    description: 'Ask before commands and file changes.',
    icon: Lock,
    label: 'Supervised',
    value: 'default',
  },
  {
    description: 'Auto-approve edits, ask before other actions.',
    icon: PenLine,
    label: 'Auto-accept edits',
    value: 'acceptEdits',
  },
  {
    description: 'Allow commands and edits without prompts.',
    icon: Lock,
    label: 'Full access',
    value: 'bypassPermissions',
  },
]

function formatEffortTrigger(effort: ManagedSessionEffort): string {
  switch (effort) {
    case 'low':
      return 'Low'
    case 'medium':
      return 'Medium'
    case 'high':
      return 'High'
    case 'max':
      return 'Extra High'
  }
}

function formatPermissionTrigger(mode: ManagedSessionPermissionMode): string {
  const opt = PERMISSION_OPTIONS.find((o) => o.value === mode)
  return opt?.label ?? 'Supervised'
}

function useClickOutside(
  ref: React.RefObject<HTMLElement | null>,
  onClose: () => void,
  active: boolean,
) {
  useEffect(() => {
    if (!active) return

    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        onClose()
      }
    }

    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [active, onClose, ref])
}

function ReasoningDropdown({
  effort,
  onEffortChange,
}: {
  readonly effort: ManagedSessionEffort
  readonly onEffortChange: (effort: ManagedSessionEffort) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  useClickOutside(containerRef, () => setIsOpen(false), isOpen)

  return (
    <div ref={containerRef} className="relative">
      <button
        className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        {formatEffortTrigger(effort)}
        <ChevronDown className="size-3 opacity-50" />
      </button>
      {isOpen && (
        <div className="absolute bottom-full left-0 z-50 mb-1 min-w-[200px] rounded-xl border border-border bg-popover py-2 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
          <div className="px-4 pb-1 text-xs font-medium text-muted-foreground">
            Reasoning
          </div>
          {EFFORT_OPTIONS.map((opt) => (
            <button
              className={`flex w-full items-center gap-2 px-4 py-1.5 text-sm transition-colors ${
                opt.value === effort
                  ? 'text-foreground'
                  : 'text-foreground/80 hover:bg-secondary/60'
              }`}
              key={opt.value}
              onClick={() => {
                onEffortChange(opt.value)
                setIsOpen(false)
              }}
              type="button"
            >
              {opt.value === effort ? (
                <Check className="size-3.5" />
              ) : (
                <span className="size-3.5" />
              )}
              {opt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

function PermissionDropdown({
  onPermissionModeChange,
  permissionMode,
}: {
  readonly onPermissionModeChange: (mode: ManagedSessionPermissionMode) => void
  readonly permissionMode: ManagedSessionPermissionMode
}) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  useClickOutside(containerRef, () => setIsOpen(false), isOpen)

  return (
    <div ref={containerRef} className="relative">
      <button
        className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <Lock className="size-3" />
        {formatPermissionTrigger(permissionMode)}
        <ChevronDown className="size-3 opacity-50" />
      </button>
      {isOpen && (
        <div className="absolute bottom-full right-0 z-50 mb-1 min-w-[280px] rounded-xl border border-border bg-popover py-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.35)]">
          {PERMISSION_OPTIONS.map((opt) => {
            const Icon = opt.icon
            const isSelected = opt.value === permissionMode

            return (
              <button
                className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                  isSelected
                    ? 'text-foreground'
                    : 'text-foreground/80 hover:bg-secondary/60'
                }`}
                key={opt.value}
                onClick={() => {
                  onPermissionModeChange(opt.value)
                  setIsOpen(false)
                }}
                type="button"
              >
                {isSelected ? (
                  <Check className="size-4 shrink-0" />
                ) : (
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                )}
                <div className="flex flex-col">
                  <span className="text-sm font-medium">{opt.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {opt.description}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
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
        className="py-2 text-center text-xs italic text-muted-foreground/60"
        data-testid={`managed-content-${item.kind}`}
      >
        {item.text}
      </p>
    )
  }

  return (
    <div className="px-1" data-testid={`managed-content-${item.kind}`}>
      <MarkdownContent text={item.text} />
    </div>
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
  const isUnifiedPane = terminalMode === 'agent'
  const [selectedProvider, setSelectedProvider] = useState<ManagedSessionMode>(
    () => {
      if (terminalMode === 'claude' || terminalMode === 'codex') {
        return terminalMode
      }
      const stored = localStorage.getItem(
        `aide:workspace:${workspace.id}:provider`,
      )
      if (stored === 'claude' || stored === 'codex') return stored
      return 'claude'
    },
  )
  const [selectedModel, setSelectedModel] = useState<string | undefined>(
    undefined,
  )
  const [snapshot, setSnapshot] = useState<ManagedSessionSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draftInput, setDraftInput] = useState('')
  const [draftAnswers, setDraftAnswers] = useState<DraftAnswersState>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [agentMode, setAgentMode] = useState<'build' | 'plan'>('build')
  const [effort, setEffort] = useState<ManagedSessionEffort>('high')
  const [permissionMode, setPermissionMode] =
    useState<ManagedSessionPermissionMode>('default')
  const [slashActiveIndex, setSlashActiveIndex] = useState(0)
  const startedSessionRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const gitInfo = useWorkspaceGitStatus(workspace.id)

  const providerLabel = selectedProvider === 'claude' ? 'Claude' : 'Codex'

  useEffect(() => {
    if (draftInput === '' && textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [draftInput])

  const ensureSession = useCallback(async () => {
    if (startedSessionRef.current) return

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
        if (isUnifiedPane) {
          setSelectedProvider(existing.provider as ManagedSessionMode)
        }
        startedSessionRef.current = true
        return
      }

      const created = await api.createManagedSession({
        cwd: workspace.worktreePath || '~',
        effort,
        mode: selectedProvider,
        model: selectedModel,
        paneId,
        permissionMode: agentMode === 'plan' ? 'plan' : permissionMode,
        sessionId,
        workspaceId: workspace.id,
      })
      setSnapshot(created)
      startedSessionRef.current = true
      setError(null)
    } catch (sessionError) {
      setError(getErrorMessage(sessionError))
    }
  }, [
    agentMode,
    effort,
    isUnifiedPane,
    paneId,
    permissionMode,
    selectedModel,
    selectedProvider,
    sessionId,
    terminalMode,
    workspace.id,
    workspace.worktreePath,
  ])

  useEffect(() => {
    const api = getAideApi()
    if (!api || terminalMode === 'shell' || startedSessionRef.current) return

    void (async () => {
      try {
        const snapshots = await api.getManagedSessionSnapshots()
        const existing = snapshots[sessionId] ?? null
        if (existing) {
          setSnapshot(existing)
          if (isUnifiedPane) {
            setSelectedProvider(existing.provider as ManagedSessionMode)
          }
          startedSessionRef.current = true
        }
      } catch {
        /* no existing session — will create on first send */
      }
    })()
  }, [isUnifiedPane, sessionId, terminalMode])

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
        if (!startedSessionRef.current) {
          await ensureSession()
        }
        await api.sendManagedSessionInput(sessionId, trimmed)
        setError(null)
      } catch (sendError) {
        setError(getErrorMessage(sendError))
      } finally {
        setIsSubmitting(false)
      }
    },
    [ensureSession, sessionId],
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

  const handleModelSwitch = useCallback(
    async (newMode: ManagedSessionMode, newModelId: string) => {
      setSelectedModel(newModelId)
      if (newMode !== selectedProvider) {
        setSelectedProvider(newMode)
        localStorage.setItem(`aide:workspace:${workspace.id}:provider`, newMode)
      }

      const api = getAideApi()
      if (!api || !startedSessionRef.current) return

      try {
        const updated = await api.switchManagedSessionProvider(
          sessionId,
          newMode,
          newModelId,
        )
        setSnapshot(updated)
      } catch (switchError) {
        setError(getErrorMessage(switchError))
      }
    },
    [selectedProvider, sessionId, workspace.id],
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
      className="managed-agent-pane flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-border/60 bg-background"
      data-testid="managed-agent-pane"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-2.5">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          {isUnifiedPane ? 'Agent' : providerLabel}
        </h2>

        <div className="flex items-center gap-2">
          <OpenInEditorButton cwd={workspace.worktreePath} />
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

            {snapshot?.sessionState === 'running' && runningTurnId === null ? (
              <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
                <LoaderCircle className="size-3 animate-spin text-primary" />
                {providerLabel} is working...
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground/60">
              Send a prompt to start.
            </p>
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

      <div className="flex flex-col gap-2 px-4 pb-3 pt-2">
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

        <div className="relative mx-auto w-full max-w-3xl rounded-2xl border border-border/60 bg-surface">
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

          <textarea
            ref={textareaRef}
            aria-label={`${providerLabel} prompt`}
            className="max-h-[200px] w-full resize-none overflow-y-auto border-none bg-transparent px-4 pt-3 pb-2 text-sm focus:outline-none"
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
              setDraftInput(event.target.value)
              const el = event.target
              el.style.height = 'auto'
              el.style.height = `${el.scrollHeight}px`
            }}
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

                if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
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

              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                if (isSubmitting || draftInput.trim().length === 0) {
                  return
                }
                void handleSendInput()
              }
            }}
            placeholder="Ask anything, type / for commands"
            rows={3}
            value={draftInput}
          />

          <div className="flex items-center gap-1.5 border-t border-border/40 px-3 py-2">
            {isUnifiedPane ? (
              <ModelSelector
                isDisabled={snapshot?.sessionState === 'running'}
                model={selectedModel}
                onChange={(mode, modelId) =>
                  void handleModelSwitch(mode, modelId)
                }
                provider={selectedProvider}
              />
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                {providerLabel}
              </span>
            )}
            <ReasoningDropdown effort={effort} onEffortChange={setEffort} />
            <button
              className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium transition-colors ${
                agentMode === 'plan'
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
              onClick={() =>
                setAgentMode((m) => (m === 'plan' ? 'build' : 'plan'))
              }
              type="button"
            >
              <ClipboardList className="size-3" />
              {agentMode === 'plan' ? 'Plan' : 'Build'}
            </button>
            <PermissionDropdown
              onPermissionModeChange={setPermissionMode}
              permissionMode={permissionMode}
            />
            <span className="flex-1" />
            {snapshot?.usage ? (
              <ContextWindowMeter usage={snapshot.usage} />
            ) : null}
            <button
              className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-30"
              disabled={isSubmitting || draftInput.trim().length === 0}
              onClick={() => void handleSendInput()}
              type="button"
            >
              {isSubmitting ? (
                <LoaderCircle className="size-3.5 animate-spin" />
              ) : (
                <ArrowUp className="size-4" />
              )}
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between px-3 py-1.5 text-[11px] text-muted-foreground/70">
          <span className="flex items-center gap-1.5">
            <FolderOpen className="size-3" />
            {workspace.name}
          </span>
          {gitInfo.branchName ? (
            <span className="flex items-center gap-1 font-mono">
              <GitBranch className="size-3" />
              <span className="max-w-[10rem] truncate">
                {gitInfo.branchName}
              </span>
              <ChevronDown className="size-2.5 opacity-50" />
            </span>
          ) : null}
        </div>
      </div>
    </section>
  )
}

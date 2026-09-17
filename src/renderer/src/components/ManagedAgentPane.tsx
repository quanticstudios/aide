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
} from 'lucide-react'
import type { ChangeEvent } from 'react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ManagedSessionAgentConfig } from '../../../shared/conversation-routing'
import {
  extractExplicitRecipientAliases,
  getNextRecipientSuggestionIndex,
  getRecipientMentionQuery,
  getRecipientSuggestions,
  removeRecipientMention,
} from '../../../shared/conversation-routing'
import type { AideApi } from '../../../shared/ipc'
import type {
  ManagedSessionContentItem,
  ManagedSessionContextWindow,
  ManagedSessionEffort,
  ManagedSessionPermissionMode,
  ManagedSessionSnapshot,
  ManagedSessionThinkingBudget,
} from '../../../shared/managed-session'
import type { WorkspaceRecord } from '../../../shared/persistence'
import {
  type ProviderCapabilitiesSnapshot,
  type ProviderSelectionInput,
  resolveProviderSelection,
} from '../../../shared/provider-capabilities'
import type { ManagedSessionMode } from '../../../shared/terminal'
import { useWorkspaceGitStatus } from '../hooks/useWorkspaceGitStatus'
import {
  canChangeManagedSessionSelection,
  isProviderSelectionHydrated,
  planManagedSessionSelectionChange,
  providerSelectionHydrationKey,
} from '../lib/managed-session-selection'
import {
  extractSlashQuery,
  filterSlashCommands,
  SLASH_COMMANDS,
  type SlashCommand,
  type SlashCommandContext,
} from '../lib/managed-slash-commands'
import { resolveTerminalLaunchModeForPaneId } from '../lib/pane-catalog'
import { cn } from '../lib/utils'
import ConfiguredAgentSettings from './ConfiguredAgentSettings'
import ContextWindowMeter from './ContextWindowMeter'
import ManagedPendingApprovalPanel from './ManagedPendingApprovalPanel'
import MarkdownContent from './MarkdownContent'
import ModelSelector from './ModelSelector'
import OpenInEditorButton from './OpenInEditorButton'
import ReasoningExtrasDropdown from './ReasoningExtrasDropdown'
import RecipientMentionMenu from './RecipientMentionMenu'

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

interface PersistedProviderSelection {
  readonly effort?: string
  readonly modelId?: string
  readonly serviceTier?: string | null
}

function providerSelectionStorageKey(
  workspaceId: string,
  provider: ManagedSessionMode,
): string {
  return `aide:workspace:${workspaceId}:provider-selection:${provider}`
}

function loadPersistedProviderSelection(
  workspaceId: string,
  provider: ManagedSessionMode,
): PersistedProviderSelection {
  const legacyModel = localStorage.getItem(
    `aide:workspace:${workspaceId}:model:${provider}`,
  )

  try {
    const raw = localStorage.getItem(
      providerSelectionStorageKey(workspaceId, provider),
    )

    if (!raw) {
      return legacyModel ? { modelId: legacyModel } : {}
    }

    const parsed = JSON.parse(raw) as unknown

    if (!parsed || typeof parsed !== 'object') {
      return legacyModel ? { modelId: legacyModel } : {}
    }

    const record = parsed as Record<string, unknown>
    return {
      ...(typeof record.effort === 'string' ? { effort: record.effort } : {}),
      ...(typeof record.modelId === 'string'
        ? { modelId: record.modelId }
        : legacyModel
          ? { modelId: legacyModel }
          : {}),
      ...(typeof record.serviceTier === 'string' || record.serviceTier === null
        ? { serviceTier: record.serviceTier }
        : {}),
    }
  } catch {
    return legacyModel ? { modelId: legacyModel } : {}
  }
}

function persistProviderSelection(
  workspaceId: string,
  provider: ManagedSessionMode,
  selection: PersistedProviderSelection,
): void {
  try {
    localStorage.setItem(
      providerSelectionStorageKey(workspaceId, provider),
      JSON.stringify(selection),
    )
  } catch {
    // Storage failures should not prevent an available provider from running.
  }
}

function getDefaultConfiguredAgents(
  capabilities: ProviderCapabilitiesSnapshot,
): readonly ManagedSessionAgentConfig[] {
  return (['claude', 'codex'] as const).flatMap((mode) => {
    const resolution = resolveProviderSelection(
      capabilities.providers[mode],
      {},
    )

    if (!resolution.effort || !resolution.modelId) {
      return []
    }

    return [
      {
        alias: mode === 'claude' ? 'Claude' : 'Codex',
        selection: {
          effort: resolution.effort,
          mode,
          model: resolution.modelId,
          ...(resolution.serviceTier
            ? { serviceTier: resolution.serviceTier }
            : {}),
        },
      },
    ]
  })
}

function formatMessageTime(iso: string): string {
  const date = new Date(iso)

  if (Number.isNaN(date.getTime())) {
    return ''
  }

  return date.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
  })
}

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
        className="flex items-center gap-1.5 rounded-md px-1.5 py-0.5 text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
        onClick={() => setIsOpen(!isOpen)}
        type="button"
      >
        <Lock className="size-3" />
        {formatPermissionTrigger(permissionMode)}
        <ChevronDown className="size-3 opacity-50" />
      </button>
      {isOpen && (
        <div className="absolute bottom-full right-0 z-50 mb-1 min-w-[280px] rounded-md border border-border bg-surface py-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
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
                  <span className="text-sm font-semibold">{opt.label}</span>
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
          className="max-w-[85%] rounded-lg rounded-br-sm border border-border bg-surface-elevated px-4 py-3"
          data-testid={`managed-content-${item.kind}`}
        >
          <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
            {item.text}
          </pre>
          <p className="mt-1 text-right text-[10px] tabular-nums text-muted-foreground/70">
            {formatMessageTime(item.updatedAt)}
          </p>
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
        className="rounded-md border border-border bg-surface px-4 py-3"
        data-testid={`managed-content-${item.kind}`}
      >
        <div className="flex items-center gap-2 pb-2">
          <Terminal className="size-3 text-accent-green" />
          <p className="text-[10px] uppercase tracking-[0.18em] text-accent-green">
            Command output
          </p>
        </div>
        <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-foreground">
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
        className="rounded-md border border-border bg-surface px-4 py-3"
        data-testid={`managed-content-${item.kind}`}
      >
        <div className="flex items-center gap-2 pb-2">
          <FileCode className="size-3 text-accent-yellow" />
          <p className="text-[10px] uppercase tracking-[0.18em] text-accent-yellow">
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
        className="rounded-md border border-border px-3 py-2"
        data-testid={`managed-content-${item.kind}`}
        variant="tertiary"
      >
        <button
          className="flex w-full items-center gap-2 text-left"
          onClick={() => setIsExpanded((prev) => !prev)}
          type="button"
        >
          <Brain className="size-3 text-accent-blue" />
          <p className="text-[10px] uppercase tracking-[0.18em] text-accent-blue">
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
      {item.kind === 'assistant-text' && item.provider ? (
        <p className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          {item.provider === 'claude' ? 'Claude' : 'Codex'}
          {item.model ? ` · ${item.model}` : ''}
        </p>
      ) : null}
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
  const [capabilities, setCapabilities] =
    useState<ProviderCapabilitiesSnapshot | null>(null)
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<ManagedSessionSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [draftInput, setDraftInput] = useState('')
  const [configuredAgents, setConfiguredAgents] = useState<
    readonly ManagedSessionAgentConfig[]
  >([])
  const [selectedRecipientAliases, setSelectedRecipientAliases] = useState<
    readonly string[]
  >([])
  const [recipientActiveIndex, setRecipientActiveIndex] = useState(0)
  const [isRecipientMenuDismissed, setIsRecipientMenuDismissed] =
    useState(false)
  const [draftAnswers, setDraftAnswers] = useState<DraftAnswersState>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [agentMode, setAgentMode] = useState<'build' | 'plan'>('build')
  const [effort, setEffort] = useState<ManagedSessionEffort | undefined>(
    undefined,
  )
  const [thinkingBudget, setThinkingBudget] =
    useState<ManagedSessionThinkingBudget>('default')
  const [contextWindow, setContextWindow] =
    useState<ManagedSessionContextWindow>('200k')
  const [serviceTier, setServiceTier] = useState<string | null>(null)
  const [permissionMode, setPermissionMode] =
    useState<ManagedSessionPermissionMode>('default')
  const [slashActiveIndex, setSlashActiveIndex] = useState(0)
  const startedSessionRef = useRef(false)
  const configuredAgentsInitializedRef = useRef(false)
  const hydratedProviderSelectionKeyRef = useRef<string | null>(null)
  const snapshotRevisionRef = useRef({ revision: -1, runtimeGeneration: -1 })
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const gitInfo = useWorkspaceGitStatus(workspace.id)

  const providerLabel = selectedProvider === 'claude' ? 'Claude' : 'Codex'
  const selectionHydrationKey = providerSelectionHydrationKey(
    workspace.id,
    selectedProvider,
  )
  const isSelectionHydrated = isProviderSelectionHydrated(
    hydratedProviderSelectionKeyRef.current,
    workspace.id,
    selectedProvider,
  )

  useEffect(() => {
    const api = getAideApi()

    if (!api || terminalMode === 'shell') {
      return
    }

    void api
      .getProviderCapabilities()
      .then((nextCapabilities) => {
        setCapabilities(nextCapabilities)
      })
      .catch((capabilityError) => {
        setError(getErrorMessage(capabilityError))
      })
  }, [terminalMode])

  useEffect(() => {
    const providerCapabilities = capabilities?.providers[selectedProvider]

    hydratedProviderSelectionKeyRef.current = null

    if (!providerCapabilities) {
      return
    }

    const persisted = loadPersistedProviderSelection(
      workspace.id,
      selectedProvider,
    )
    const resolution = resolveProviderSelection(providerCapabilities, persisted)

    if (!resolution.modelId || !resolution.effort) {
      setError(resolution.explanation)
      setSelectionNotice(resolution.explanation)
      return
    }

    setSelectedModel(resolution.modelId)
    setEffort(resolution.effort)
    setServiceTier(resolution.serviceTier)
    setSelectionNotice(resolution.explanation)
    persistProviderSelection(workspace.id, selectedProvider, {
      effort: resolution.effort,
      modelId: resolution.modelId,
      serviceTier: resolution.serviceTier,
    })
    hydratedProviderSelectionKeyRef.current = selectionHydrationKey
  }, [capabilities, selectedProvider, selectionHydrationKey, workspace.id])

  useEffect(() => {
    if (!selectedModel) {
      return
    }

    persistProviderSelection(workspace.id, selectedProvider, {
      effort,
      modelId: selectedModel,
      serviceTier,
    })
  }, [effort, selectedModel, selectedProvider, serviceTier, workspace.id])

  useEffect(() => {
    if (!capabilities || configuredAgentsInitializedRef.current) {
      return
    }

    configuredAgentsInitializedRef.current = true
    setConfiguredAgents(getDefaultConfiguredAgents(capabilities))
  }, [capabilities])

  useEffect(() => {
    if (draftInput === '' && textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [draftInput])

  const ensureSession = useCallback(async () => {
    if (startedSessionRef.current) return true

    const api = getAideApi()

    if (!api || terminalMode === 'shell') {
      setError('Managed provider bridge did not load.')
      return false
    }

    try {
      const snapshots = await api.getManagedSessionSnapshots()
      const existing = snapshots[sessionId] ?? null

      if (existing) {
        setSnapshot(existing)
        if (existing.agents) {
          setConfiguredAgents(existing.agents)
          configuredAgentsInitializedRef.current = true
        }
        setSelectedModel(existing.model ?? undefined)
        setEffort(existing.effort ?? effort)
        setServiceTier(existing.serviceTier)
        setSelectionNotice(existing.selectionNotice)
        if (isUnifiedPane) {
          setSelectedProvider(existing.provider as ManagedSessionMode)
        }
        startedSessionRef.current = true
        return true
      }

      if (!isSelectionHydrated) {
        throw new Error(
          selectionNotice ??
            error ??
            'Provider capabilities are still loading. Please try again.',
        )
      }

      const created = await api.createManagedSession({
        agents: configuredAgents,
        contextWindow,
        cwd: workspace.worktreePath || '~',
        effort,
        interactionMode: agentMode,
        mode: selectedProvider,
        model: selectedModel,
        orchestratorSelection: {
          effort,
          mode: selectedProvider,
          model: selectedModel,
          ...(serviceTier ? { serviceTier } : {}),
        },
        paneId,
        permissionMode: agentMode === 'plan' ? 'plan' : permissionMode,
        sessionId,
        ...(serviceTier ? { serviceTier } : {}),
        thinkingBudget,
        workspaceId: workspace.id,
      })
      setSnapshot(created)
      setSelectedModel(created.model ?? undefined)
      setEffort(created.effort ?? effort)
      setServiceTier(created.serviceTier)
      setSelectionNotice(created.selectionNotice)
      startedSessionRef.current = true
      setError(null)
      return true
    } catch (sessionError) {
      setError(getErrorMessage(sessionError))
      return false
    }
  }, [
    agentMode,
    contextWindow,
    configuredAgents,
    error,
    effort,
    isSelectionHydrated,
    isUnifiedPane,
    paneId,
    permissionMode,
    selectedModel,
    selectedProvider,
    selectionNotice,
    sessionId,
    serviceTier,
    terminalMode,
    thinkingBudget,
    workspace.id,
    workspace.worktreePath,
  ])

  useEffect(() => {
    const api = getAideApi()

    if (!api || terminalMode === 'shell') {
      return
    }

    const applySnapshot = (nextSnapshot: ManagedSessionSnapshot) => {
      const current = snapshotRevisionRef.current
      if (
        nextSnapshot.runtimeGeneration < current.runtimeGeneration ||
        (nextSnapshot.runtimeGeneration === current.runtimeGeneration &&
          nextSnapshot.revision <= current.revision)
      ) {
        return
      }
      snapshotRevisionRef.current = {
        revision: nextSnapshot.revision,
        runtimeGeneration: nextSnapshot.runtimeGeneration,
      }
      setSnapshot(nextSnapshot)
      if (nextSnapshot.agents) {
        setConfiguredAgents(nextSnapshot.agents)
        configuredAgentsInitializedRef.current = true
      }
      setSelectedModel(nextSnapshot.model ?? undefined)
      setEffort(nextSnapshot.effort ?? effort)
      setServiceTier(nextSnapshot.serviceTier)
      setSelectionNotice(nextSnapshot.selectionNotice)
      if (isUnifiedPane) {
        setSelectedProvider(nextSnapshot.provider as ManagedSessionMode)
      }
      startedSessionRef.current = true
    }

    const unsubscribe = api.onManagedSessionEvent((event) => {
      if (event.type === 'removed') {
        if (event.sessionId === sessionId) {
          snapshotRevisionRef.current = { revision: -1, runtimeGeneration: -1 }
          startedSessionRef.current = false
          setSnapshot(null)
        }
        return
      }

      if (event.snapshot.sessionId !== sessionId) {
        return
      }

      applySnapshot(event.snapshot)
    })

    void api.getManagedSessionSnapshots().then((snapshots) => {
      const existing = snapshots[sessionId]
      if (existing) {
        applySnapshot(existing)
      }
    })

    return unsubscribe
  }, [effort, isUnifiedPane, sessionId, terminalMode])

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
    async (text: string, recipients: readonly string[] = []) => {
      const api = getAideApi()
      const trimmed = text.trim()

      if (!api || !trimmed) {
        return false
      }

      setIsSubmitting(true)

      try {
        if (!startedSessionRef.current) {
          if (!(await ensureSession())) {
            return false
          }
        }
        await api.sendManagedSessionInput(sessionId, trimmed, recipients)
        setError(null)
        return true
      } catch (sendError) {
        setError(getErrorMessage(sendError))
        return false
      } finally {
        setIsSubmitting(false)
      }
    },
    [ensureSession, sessionId],
  )

  const handleSendInput = useCallback(async () => {
    const submittedDraft = draftInput
    const submittedRecipientAliases = selectedRecipientAliases
    const parsed = extractExplicitRecipientAliases(
      submittedDraft,
      configuredAgents.map((agent) => agent.alias),
    )

    if (parsed.error) {
      setError(parsed.error)
      return
    }

    const recipients = Array.from(
      new Set([...submittedRecipientAliases, ...parsed.aliases]),
    )

    if (agentMode === 'build' && recipients.length > 1) {
      setError('Build mode accepts one recipient. Use Plan for a comparison.')
      return
    }

    if (await sendPromptText(parsed.text, recipients)) {
      setDraftInput((currentDraft) =>
        currentDraft === submittedDraft ? '' : currentDraft,
      )
      setSelectedRecipientAliases((currentAliases) =>
        currentAliases === submittedRecipientAliases ? [] : currentAliases,
      )
    }
  }, [
    agentMode,
    configuredAgents,
    draftInput,
    selectedRecipientAliases,
    sendPromptText,
  ])

  const handleRetryTurn = useCallback(
    async (text: string) => {
      await sendPromptText(text)
    },
    [sendPromptText],
  )

  const handleConfiguredAgentsChange = useCallback(
    async (agents: readonly ManagedSessionAgentConfig[]) => {
      setConfiguredAgents(agents)
      setSelectedRecipientAliases((aliases) =>
        aliases.filter((alias) =>
          agents.some(
            (agent) => agent.alias.toLowerCase() === alias.toLowerCase(),
          ),
        ),
      )

      if (!startedSessionRef.current) {
        return
      }

      const api = getAideApi()

      if (!api) {
        setError('Managed provider bridge did not load.')
        return
      }

      try {
        const updated = await api.configureManagedSessionAgents(
          sessionId,
          agents,
        )
        setSnapshot(updated)
        setError(null)
      } catch (configurationError) {
        setError(getErrorMessage(configurationError))
      }
    },
    [sessionId],
  )

  const handleProviderSelectionChange = useCallback(
    async (
      newMode: ManagedSessionMode,
      requestedSelection: ProviderSelectionInput,
    ) => {
      const providerCapabilities = capabilities?.providers[newMode]

      if (!providerCapabilities) {
        setError('Provider capabilities have not loaded yet.')
        return
      }

      const resolution = resolveProviderSelection(
        providerCapabilities,
        requestedSelection,
      )
      const change = planManagedSessionSelectionChange(
        startedSessionRef.current,
        newMode,
        resolution,
      )

      if (change.kind === 'unavailable') {
        setError(resolution.explanation ?? 'No compatible model is available.')
        return
      }

      if (change.kind === 'local') {
        hydratedProviderSelectionKeyRef.current = providerSelectionHydrationKey(
          workspace.id,
          newMode,
        )
        setSelectedModel(change.selection.model)
        setEffort(change.selection.effort)
        setServiceTier(change.selection.serviceTier ?? null)
        setSelectionNotice(resolution.explanation)
        persistProviderSelection(workspace.id, newMode, {
          effort: change.selection.effort,
          modelId: change.selection.model,
          serviceTier: change.selection.serviceTier ?? null,
        })
        if (newMode !== selectedProvider) {
          setSelectedProvider(newMode)
          localStorage.setItem(
            `aide:workspace:${workspace.id}:provider`,
            newMode,
          )
        }
        return
      }

      const api = getAideApi()
      if (!api) {
        setError('Managed provider bridge did not load.')
        return
      }

      try {
        const updated = await api.switchManagedSessionProvider(
          sessionId,
          change.selection,
        )
        setSnapshot(updated)
        setSelectedModel(updated.model ?? undefined)
        setEffort(updated.effort ?? undefined)
        setServiceTier(updated.serviceTier)
        setSelectionNotice(updated.selectionNotice)
        persistProviderSelection(workspace.id, updated.provider, {
          effort: updated.effort ?? undefined,
          modelId: updated.model ?? undefined,
          serviceTier: updated.serviceTier,
        })
        if (isUnifiedPane) {
          setSelectedProvider(updated.provider)
          localStorage.setItem(
            `aide:workspace:${workspace.id}:provider`,
            updated.provider,
          )
        }
        setError(null)
      } catch (switchError) {
        setError(getErrorMessage(switchError))
      }
    },
    [capabilities, isUnifiedPane, selectedProvider, sessionId, workspace.id],
  )

  const handleModelSwitch = useCallback(
    (newMode: ManagedSessionMode, newModelId: string) =>
      handleProviderSelectionChange(newMode, {
        effort: newMode === selectedProvider ? effort : undefined,
        modelId: newModelId,
        serviceTier: newMode === selectedProvider ? serviceTier : undefined,
      }),
    [effort, handleProviderSelectionChange, selectedProvider, serviceTier],
  )

  const handleEffortChange = useCallback(
    (nextEffort: ManagedSessionEffort) =>
      handleProviderSelectionChange(selectedProvider, {
        effort: nextEffort,
        modelId: selectedModel,
        serviceTier,
      }),
    [
      handleProviderSelectionChange,
      selectedModel,
      selectedProvider,
      serviceTier,
    ],
  )

  const handleServiceTierChange = useCallback(
    (nextServiceTier: string | null) =>
      handleProviderSelectionChange(selectedProvider, {
        effort,
        modelId: selectedModel,
        serviceTier: nextServiceTier,
      }),
    [effort, handleProviderSelectionChange, selectedModel, selectedProvider],
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

  const selectRecipient = useCallback(
    (agent: ManagedSessionAgentConfig) => {
      const mention = removeRecipientMention(draftInput)

      if (!mention) {
        return
      }

      const alias = agent.alias.toLowerCase()
      setDraftInput(mention.draft)
      setSelectedRecipientAliases((aliases) =>
        aliases.includes(alias) ? aliases : [...aliases, alias],
      )
      setIsRecipientMenuDismissed(true)
      setError(null)
    },
    [draftInput],
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

  const recipientMentionQuery = getRecipientMentionQuery(draftInput)
  const recipientSuggestions = useMemo(
    () =>
      getRecipientSuggestions(recipientMentionQuery, configuredAgents).filter(
        (agent) =>
          !selectedRecipientAliases.some(
            (alias) => alias.toLowerCase() === agent.alias.toLowerCase(),
          ),
      ),
    [configuredAgents, recipientMentionQuery, selectedRecipientAliases],
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
  const recipientMenuOpen =
    !isRecipientMenuDismissed &&
    !slashMenuOpen &&
    recipientSuggestions.length > 0

  const activeQuestion = snapshot?.pendingUserInputs[0] ?? null
  const primaryQuestionId = activeQuestion?.questions[0]?.id ?? null
  const activeAnswers = activeQuestion
    ? (draftAnswers[activeQuestion.id] ?? {})
    : null
  const primaryAnswer = primaryQuestionId
    ? (activeAnswers?.[primaryQuestionId] ?? '')
    : ''
  const allQuestionsAnswered = activeQuestion
    ? activeQuestion.questions.every(
        (question) => (activeAnswers?.[question.id] ?? '').trim().length > 0,
      )
    : false

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
  const canChangeProviderSelection = canChangeManagedSessionSelection(snapshot)

  return (
    <section
      className="managed-agent-pane flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface"
      data-testid="managed-agent-pane"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-2.5">
        <h2 className="text-sm font-semibold tracking-[-0.374px] text-foreground">
          {isUnifiedPane ? 'Agent' : providerLabel}
        </h2>

        <div className="flex items-center gap-2">
          <OpenInEditorButton cwd={workspace.worktreePath} />
          <Button
            isDisabled={snapshot?.sessionState !== 'running'}
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
        <div className="border-b border-accent-red bg-accent-red-soft px-4 py-2.5 text-sm text-accent-red">
          {error}
        </div>
      ) : null}

      {selectionNotice ? (
        <div
          className="border-b border-border bg-surface-secondary px-4 py-2 text-sm text-muted-foreground"
          role="status"
        >
          {selectionNotice}
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

        <div
          className={cn(
            'relative mx-auto w-full max-w-3xl rounded-lg border bg-surface transition-colors',
            agentMode === 'plan' ? 'border-primary/60' : 'border-border',
          )}
        >
          {recipientMenuOpen ? (
            <RecipientMentionMenu
              activeIndex={recipientActiveIndex}
              agents={recipientSuggestions}
              onSelect={selectRecipient}
            />
          ) : null}

          {slashMenuOpen ? (
            <div
              className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-sm rounded-md border border-border bg-surface shadow-[0_20px_60px_rgba(0,0,0,0.4)]"
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
                            ? 'bg-surface-tertiary text-foreground'
                            : 'text-foreground/80 hover:bg-surface-secondary'
                        }`}
                        onClick={() => {
                          void runSlashCommand(command)
                        }}
                        onMouseEnter={() => setSlashActiveIndex(index)}
                        type="button"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate font-semibold">
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

          {activeQuestion ? (
            <div
              className="border-b border-border/40 px-4 pb-3 pt-3"
              data-testid={`managed-input-${activeQuestion.id}`}
            >
              {activeQuestion.questions.map((question) => {
                const currentAnswer = activeAnswers?.[question.id] ?? ''
                return (
                  <div className="mb-2 last:mb-0" key={question.id}>
                    <p className="eyebrow">
                      {question.header ?? 'Input required'}
                    </p>
                    <p className="mt-1 text-sm font-semibold text-foreground">
                      {question.prompt}
                    </p>
                    {question.options.length > 0 ? (
                      <div className="mt-3 flex flex-col gap-1">
                        {question.options.map((option, optionIndex) => {
                          const selected = currentAnswer === option.label
                          return (
                            <button
                              className={cn(
                                'row-hover flex w-full items-start gap-3 rounded-md px-3 py-2 text-left text-sm',
                                selected && 'is-active',
                              )}
                              key={option.id}
                              onClick={() =>
                                handleDraftAnswerChange(
                                  activeQuestion.id,
                                  question.id,
                                  option.label,
                                )
                              }
                              type="button"
                            >
                              <span
                                className={cn(
                                  'mt-0.5 inline-flex size-5 shrink-0 items-center justify-center rounded text-[10px] font-semibold tabular-nums',
                                  selected
                                    ? 'bg-primary text-primary-foreground'
                                    : 'bg-surface-tertiary text-muted-foreground',
                                )}
                              >
                                {optionIndex + 1}
                              </span>
                              <span className="min-w-0 flex-1">
                                <span className="font-semibold text-foreground">
                                  {option.label}
                                </span>
                                {option.description ? (
                                  <span className="ml-2 text-muted-foreground">
                                    {option.description}
                                  </span>
                                ) : null}
                              </span>
                            </button>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : null}

          {selectedRecipientAliases.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 px-4 pt-3">
              {selectedRecipientAliases.map((alias) => (
                <button
                  aria-label={`Remove @${alias}`}
                  className="rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary hover:bg-primary/20"
                  key={alias}
                  onClick={() =>
                    setSelectedRecipientAliases((aliases) =>
                      aliases.filter((value) => value !== alias),
                    )
                  }
                  type="button"
                >
                  @{alias} ×
                </button>
              ))}
            </div>
          ) : null}

          <p aria-live="polite" className="sr-only">
            {selectedRecipientAliases.length > 0
              ? `Recipients: ${selectedRecipientAliases.map((alias) => `@${alias}`).join(', ')}`
              : 'Conversation default recipient'}
          </p>

          <textarea
            ref={textareaRef}
            aria-label={
              activeQuestion ? 'Free-form answer' : `${providerLabel} prompt`
            }
            className="max-h-[200px] w-full resize-none overflow-y-auto border-none bg-transparent px-4 pt-3 pb-2 text-sm focus:outline-none"
            onChange={(event: ChangeEvent<HTMLTextAreaElement>) => {
              const value = event.target.value
              if (activeQuestion && primaryQuestionId) {
                handleDraftAnswerChange(
                  activeQuestion.id,
                  primaryQuestionId,
                  value,
                )
              } else {
                setDraftInput(value)
                setRecipientActiveIndex(0)
                setIsRecipientMenuDismissed(false)
              }
              const el = event.target
              el.style.height = 'auto'
              el.style.height = `${el.scrollHeight}px`
            }}
            onKeyDown={(event) => {
              if (
                activeQuestion &&
                /^[1-9]$/.test(event.key) &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.shiftKey &&
                !event.altKey
              ) {
                const target = event.target as HTMLTextAreaElement
                if (target.value === '') {
                  const question = activeQuestion.questions[0]
                  const optionIndex = Number.parseInt(event.key, 10) - 1
                  const option = question?.options[optionIndex]
                  if (option) {
                    event.preventDefault()
                    handleDraftAnswerChange(
                      activeQuestion.id,
                      question.id,
                      option.label,
                    )
                    return
                  }
                }
              }

              if (recipientMenuOpen) {
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                  event.preventDefault()
                  const nextIndex = getNextRecipientSuggestionIndex(
                    recipientActiveIndex,
                    recipientSuggestions.length,
                    event.key,
                  )
                  if (nextIndex !== null) {
                    setRecipientActiveIndex(nextIndex)
                  }
                  return
                }

                if (
                  (event.key === 'Enter' || event.key === 'Tab') &&
                  !event.metaKey &&
                  !event.ctrlKey
                ) {
                  event.preventDefault()
                  const agent = recipientSuggestions[recipientActiveIndex]
                  if (agent) {
                    selectRecipient(agent)
                  }
                  return
                }

                if (event.key === 'Escape') {
                  event.preventDefault()
                  setIsRecipientMenuDismissed(true)
                  return
                }
              }

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
                if (isSubmitting) {
                  return
                }
                if (activeQuestion) {
                  if (allQuestionsAnswered) {
                    void handleResolveUserInput(activeQuestion.id)
                  }
                  return
                }
                if (draftInput.trim().length === 0) {
                  return
                }
                void handleSendInput()
              }
            }}
            placeholder={
              activeQuestion
                ? 'Type your own answer, or leave this blank to use the selected option'
                : 'Ask anything, type / for commands'
            }
            rows={3}
            value={activeQuestion ? primaryAnswer : draftInput}
          />

          <div className="flex items-center gap-1.5 border-t border-border/40 px-3 py-2">
            {isUnifiedPane ? (
              <ModelSelector
                capabilities={capabilities}
                isDisabled={!canChangeProviderSelection}
                model={selectedModel}
                onChange={(mode, modelId) =>
                  void handleModelSwitch(mode, modelId)
                }
                provider={selectedProvider}
              />
            ) : (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                {providerLabel}
              </span>
            )}
            <ConfiguredAgentSettings
              agents={configuredAgents}
              capabilities={capabilities}
              isDisabled={!canChangeProviderSelection || isSubmitting}
              onChange={(agents) => void handleConfiguredAgentsChange(agents)}
            />
            <ReasoningExtrasDropdown
              capabilities={capabilities}
              contextWindow={contextWindow}
              effort={effort}
              isDisabled={!canChangeProviderSelection}
              model={selectedModel}
              onContextWindowChange={setContextWindow}
              onEffortChange={(nextEffort) =>
                void handleEffortChange(nextEffort)
              }
              onServiceTierChange={(nextServiceTier) =>
                void handleServiceTierChange(nextServiceTier)
              }
              onThinkingBudgetChange={setThinkingBudget}
              provider={selectedProvider}
              serviceTier={serviceTier}
              thinkingBudget={thinkingBudget}
            />
            <button
              className={`flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold transition-colors ${
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
            {snapshot?.usage || snapshot?.usageSummary ? (
              <ContextWindowMeter
                usage={snapshot.usage}
                summary={snapshot.usageSummary}
              />
            ) : null}
            {activeQuestion ? (
              <button
                className="flex items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
                disabled={isSubmitting || !allQuestionsAnswered}
                onClick={() => void handleResolveUserInput(activeQuestion.id)}
                type="button"
              >
                {isSubmitting ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : null}
                Submit answer
              </button>
            ) : (
              <button
                aria-label="Send prompt"
                className="flex size-7 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity disabled:opacity-30"
                disabled={
                  isSubmitting ||
                  draftInput.trim().length === 0 ||
                  (!startedSessionRef.current && !isSelectionHydrated)
                }
                onClick={() => void handleSendInput()}
                title="Send prompt"
                type="button"
              >
                {isSubmitting ? (
                  <LoaderCircle className="size-3.5 animate-spin" />
                ) : (
                  <ArrowUp className="size-4" />
                )}
              </button>
            )}
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

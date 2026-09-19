import { Button } from '@heroui/react'
import { ConversationMinimap } from './ConversationMinimap'
import {
  ArrowDown,
  ArrowUp,
  Brain,
  Check,
  ChevronDown,
  ChevronRight,
  CirclePause,
  Clipboard,
  ClipboardCheck,
  FileCode,
  FileText,
  GitBranch,
  History,
  LoaderCircle,
  Lock,
  LockOpen,
  PenLine,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Wrench,
} from 'lucide-react'
import type { ChangeEvent, ClipboardEvent, DragEvent } from 'react'
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type {
  TurnCheckpointDiff,
  TurnCheckpointRestoreResult,
} from '../../../shared/checkpoints'
import type { ManagedSessionAgentConfig } from '../../../shared/conversation-routing'
import {
  extractExplicitRecipientAliases,
  getNextRecipientSuggestionIndex,
  getRecipientSuggestions,
} from '../../../shared/conversation-routing'
import type { AideApi } from '../../../shared/ipc'
import type {
  ManagedSessionAttachment,
  ManagedSessionContentItem,
  ManagedSessionContextWindow,
  ManagedSessionEffort,
  ManagedSessionInteractionMode,
  ManagedSessionPermissionMode,
  ManagedSessionSnapshot,
  ManagedSessionToolCall,
  ManagedSessionTurnSummary,
} from '../../../shared/managed-session'
import { MANAGED_SESSION_MAX_ATTACHMENTS } from '../../../shared/managed-session'
import type { WorkspaceRecord } from '../../../shared/persistence'
import {
  type ProviderCapabilitiesSnapshot,
  type ProviderSelectionInput,
  resolveProviderSelection,
} from '../../../shared/provider-capabilities'
import type {
  ProviderSkill,
  ProviderSkillsSnapshot,
} from '../../../shared/provider-skills'
import type { ManagedSessionMode } from '../../../shared/terminal'
import { resolveAgentHotkey } from '../lib/agent-hotkeys'
import { createImageAttachments } from '../lib/managed-composer'
import {
  loadManagedDraft,
  removeManagedDraft,
  saveManagedDraft,
} from '../lib/managed-draft-storage'
import {
  groupContentByTurn,
  type TurnGroup,
} from '../lib/managed-session-grouping'
import {
  canChangeManagedSessionSelection,
  getComposerProviderSelection,
  isProviderSelectionHydrated,
  planManagedSessionSelectionChange,
  providerSelectionHydrationKey,
} from '../lib/managed-session-selection'
import {
  extractSlashQuery,
  filterProviderSkills,
  filterSlashCommands,
  SLASH_COMMANDS,
  type SlashCommand,
  type SlashCommandContext,
} from '../lib/managed-slash-commands'
import { resolveTerminalLaunchModeForPaneId } from '../lib/pane-catalog'
import { isMac } from '../lib/platform'
import { useClickOutside } from '../lib/use-click-outside'
import { cn } from '../lib/utils'
import {
  appendWorkspaceFileAttachment,
  getWorkspaceFileMention,
  removeWorkspaceFileMention,
  resolveMentionMenuSelection,
  WorkspaceFileMentionSearch,
} from '../lib/workspace-file-mentions'
import ConfiguredAgentSettings from './ConfiguredAgentSettings'
import ContextWindowMeter from './ContextWindowMeter'
import JevSetup from './JevSetup'
import ManagedComposerAttachments, {
  ManagedComposerAttachmentButton,
} from './ManagedComposerAttachments'
import ManagedInputQueue from './ManagedInputQueue'
import ManagedPendingApprovalPanel from './ManagedPendingApprovalPanel'
import ManagedRewindDialog from './ManagedRewindDialog'
import MarkdownContent from './MarkdownContent'
import ModelSelector from './ModelSelector'
import OpenInEditorButton from './OpenInEditorButton'
import ReasoningExtrasDropdown from './ReasoningExtrasDropdown'
import RecipientMentionMenu from './RecipientMentionMenu'
import IconTooltip from './ui/icon-tooltip'
import { AnthropicIcon, OpenAIIcon } from './ui/provider-icons'

interface ManagedAgentPaneProps {
  readonly isActive: boolean
  readonly paneId: string
  readonly workspace: WorkspaceRecord
}

type ManagedSlashMenuItem =
  | { readonly command: SlashCommand; readonly kind: 'command' }
  | { readonly kind: 'skill'; readonly skill: ProviderSkill }

const COMPOSER_MENU_BY_HOTKEY = {
  'open-effort-menu': 'effort',
  'open-model-menu': 'model',
  'open-permission-menu': 'permission',
} as const

function getAideApi(): AideApi | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.aide ?? null
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.replace(
      /^Error invoking remote method '[^']+': Error: /,
      '',
    )
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

    if (!resolution.modelId) {
      return []
    }

    return [
      {
        alias: mode === 'claude' ? 'Claude' : 'Codex',
        selection: {
          ...(resolution.effort ? { effort: resolution.effort } : {}),
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
  })
}

type PermissionOption = {
  description: string
  icon: typeof Lock
  label: string
  tone: string
  value: ManagedSessionPermissionMode
}

const PERMISSION_OPTIONS: readonly [PermissionOption, ...PermissionOption[]] = [
  {
    description: 'Ask before commands and file changes.',
    icon: Lock,
    label: 'Supervised',
    tone: 'text-muted-foreground',
    value: 'default',
  },
  {
    description: 'Auto-approve edits, ask before other actions.',
    icon: PenLine,
    label: 'Auto-accept edits',
    tone: 'text-accent-yellow',
    value: 'acceptEdits',
  },
  {
    description: 'Allow commands and edits without prompts.',
    icon: LockOpen,
    label: 'Full access',
    tone: 'text-accent-peach',
    value: 'bypassPermissions',
  },
]

function resolvePermissionOption(mode: ManagedSessionPermissionMode) {
  return (
    PERMISSION_OPTIONS.find((o) => o.value === mode) ?? PERMISSION_OPTIONS[0]
  )
}

function PermissionDropdown({
  isOpen,
  onOpenChange,
  onPermissionModeChange,
  permissionMode,
}: {
  readonly isOpen: boolean
  readonly onOpenChange: (isOpen: boolean) => void
  readonly onPermissionModeChange: (mode: ManagedSessionPermissionMode) => void
  readonly permissionMode: ManagedSessionPermissionMode
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  useClickOutside(containerRef, () => onOpenChange(false), isOpen)
  const active = resolvePermissionOption(permissionMode)
  const ActiveIcon = active.icon

  return (
    <div ref={containerRef} className="relative">
      <button
        className="composer-tool"
        onClick={() => onOpenChange(!isOpen)}
        type="button"
      >
        <ActiveIcon className={cn('size-4', active.tone)} />
        {active.label}
        <ChevronDown className="size-3.5 opacity-50" />
      </button>
      {isOpen && (
        <div
          className="absolute bottom-full right-0 z-50 mb-1 min-w-[280px] rounded-md border border-border bg-surface py-1.5 shadow-[0_20px_60px_rgba(0,0,0,0.4)]"
          data-testid="permission-menu"
        >
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
                  onOpenChange(false)
                }}
                type="button"
              >
                <Icon className={cn('size-4 shrink-0', opt.tone)} />
                <div className="flex min-w-0 flex-1 flex-col">
                  <span className="text-sm font-semibold">{opt.label}</span>
                  <span className="text-xs text-muted-foreground">
                    {opt.description}
                  </span>
                </div>
                {isSelected ? (
                  <Check className="size-4 shrink-0 text-muted-foreground" />
                ) : null}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

interface RecipientTurnSummary extends ManagedSessionTurnSummary {
  readonly recipientAlias?: string
  readonly requestText?: string
}

function MessageCopyButton({
  text,
  kind,
}: {
  readonly text: string
  readonly kind: 'message' | 'response'
}) {
  const [copied, setCopied] = useState(false)
  const copyTimerRef = useRef<number | null>(null)
  useEffect(
    () => () => {
      if (copyTimerRef.current !== null)
        window.clearTimeout(copyTimerRef.current)
    },
    [],
  )
  const label = `${copied ? 'Copied' : 'Copy'} ${kind}`
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      if (copyTimerRef.current !== null)
        window.clearTimeout(copyTimerRef.current)
      copyTimerRef.current = window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard access can be unavailable in the shell.
    }
  }
  return (
    <IconTooltip label={label}>
      <Button
        aria-label={label}
        className="size-7 rounded-md text-muted-foreground"
        isIconOnly
        onPress={() => void copy()}
        size="sm"
        variant="ghost"
      >
        {copied ? (
          <ClipboardCheck className="size-3.5" />
        ) : (
          <Clipboard className="size-3.5" />
        )}
      </Button>
    </IconTooltip>
  )
}

const LazyGitDiffView = lazy(async () => ({
  default: (await import('./GitDiffView')).GitDiffView,
}))

function toolCallIcon(tool: ManagedSessionToolCall) {
  if (tool.command) {
    return Terminal
  }

  if (tool.diff) {
    return FileCode
  }

  if (tool.files?.some((file) => file.status === 'read')) {
    return FileText
  }

  return Wrench
}

function toolCallSummary(tool: ManagedSessionToolCall): string {
  return (
    tool.command ??
    tool.files?.[0]?.path ??
    JSON.stringify(tool.input ?? {}).slice(0, 80)
  )
}

function toolCallStatusLabel(tool: ManagedSessionToolCall): string {
  if (tool.status === 'failed') {
    return 'failed'
  }

  return tool.exitCode === undefined ? 'done' : `exit ${tool.exitCode}`
}

function ToolCallBlock({ tool }: { readonly tool: ManagedSessionToolCall }) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [isOutputExpanded, setIsOutputExpanded] = useState(false)
  const Icon = toolCallIcon(tool)
  const output = tool.output ?? ''
  const lines = output.split('\n')
  const isLongOutput = lines.length > 20

  return (
    <div
      className="overflow-hidden rounded-lg border border-[var(--border-soft)] bg-surface-1"
      data-testid="managed-content-tool-call"
    >
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-surface-2"
        data-testid={`tool-call-${tool.toolName}`}
        onClick={() => setIsExpanded((prev) => !prev)}
        type="button"
      >
        <Icon className="size-3.5 shrink-0 text-accent-blue" />
        <span className="shrink-0 text-xs font-semibold text-foreground">
          {tool.toolName}
        </span>
        <span className="truncate font-mono text-[12px] text-muted-foreground">
          {toolCallSummary(tool)}
        </span>
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted-foreground">
          {tool.status === 'running' ? (
            <LoaderCircle className="size-3.5 animate-spin text-primary-on-dark" />
          ) : (
            toolCallStatusLabel(tool)
          )}
        </span>
        <ChevronDown
          className={`size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
        />
      </button>
      {isExpanded ? (
        <div className="space-y-2 border-t border-[var(--border-soft)] px-3 py-2">
          {tool.command ? (
            <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.6] text-foreground">
              {tool.command}
            </pre>
          ) : null}
          {tool.files && tool.files.length > 0 ? (
            <ul className="space-y-0.5 font-mono text-[12px] text-muted-foreground">
              {tool.files.map((file) => (
                <li key={`${file.status}:${file.path}`}>
                  {file.status} {file.path}
                </li>
              ))}
            </ul>
          ) : null}
          {tool.diff ? (
            <div
              className="overflow-auto rounded-md border border-border"
              data-testid="tool-call-diff"
            >
              <Suspense fallback={null}>
                <LazyGitDiffView
                  filePath={tool.files?.[0]?.path ?? 'file'}
                  outputFormat="line-by-line"
                  patch={tool.diff}
                />
              </Suspense>
            </div>
          ) : null}
          {output ? (
            <pre
              className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.6] text-body"
              data-testid="tool-call-output"
            >
              {isLongOutput && !isOutputExpanded
                ? lines.slice(0, 20).join('\n')
                : output}
            </pre>
          ) : null}
          {isLongOutput ? (
            <button
              className="text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => setIsOutputExpanded((prev) => !prev)}
              type="button"
            >
              {isOutputExpanded
                ? 'Show less'
                : `Show ${lines.length - 20} more lines`}
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

function ContentItemBlock({
  editFromHereDisabledReason = null,
  item,
  onEditFromHere,
  showProvider = true,
}: {
  readonly editFromHereDisabledReason?: string | null
  readonly item: ManagedSessionContentItem
  readonly onEditFromHere?: (() => void) | undefined
  readonly showProvider?: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (item.kind === 'user-prompt') {
    return (
      <div className="flex justify-end">
        <div
          className="group/user-message flex max-w-[85%] flex-col items-end"
          data-minimap-message="Your message"
          data-testid={`managed-content-${item.kind}`}
        >
          <div
            className="rounded-2xl rounded-br-md bg-surface-3 px-4 py-2.5"
            data-testid="user-message-bubble"
          >
            <pre className="whitespace-pre-wrap break-words font-sans text-[15px] leading-[1.55] text-foreground">
              {item.text}
            </pre>
            <ManagedComposerAttachments attachments={item.attachments ?? []} />
          </div>
          <div
            className="mt-1 flex items-center justify-end gap-2 opacity-0 transition-opacity group-hover/user-message:opacity-100 group-focus-within/user-message:opacity-100"
            data-testid="user-message-actions"
          >
            <time
              dateTime={item.updatedAt}
              className="text-[11px] tabular-nums text-muted-foreground/70"
            >
              {formatMessageTime(item.updatedAt)}
            </time>
            <MessageCopyButton text={item.text} kind="message" />
            {onEditFromHere ? (
              <IconTooltip
                label={editFromHereDisabledReason ?? 'Rewind to this message'}
              >
                <Button
                  aria-label="Edit from here"
                  className="h-7 gap-1.5 rounded-md px-2 text-[11px] font-medium text-muted-foreground"
                  isDisabled={Boolean(editFromHereDisabledReason)}
                  onPress={onEditFromHere}
                  size="sm"
                  variant="ghost"
                >
                  <History className="size-3.5" />
                  Edit from here
                </Button>
              </IconTooltip>
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  if (item.kind === 'tool-call' && item.tool) {
    return <ToolCallBlock tool={item.tool} />
  }

  if (item.kind === 'command-output') {
    const lines = item.text.split('\n')
    const isLong = lines.length > 20
    const displayText =
      isLong && !isExpanded ? lines.slice(0, 5).join('\n') : item.text

    return (
      <div
        className="rounded-lg border border-[var(--border-soft)] bg-surface-1 px-4 py-3"
        data-testid={`managed-content-${item.kind}`}
      >
        <div className="flex items-center gap-2 pb-2 text-xs font-semibold text-foreground">
          <Terminal className="size-3.5 text-accent-green" />
          Command output
        </div>
        <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.6] text-body">
          {displayText}
        </pre>
        {isLong ? (
          <button
            className="mt-2 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setIsExpanded((prev) => !prev)}
            type="button"
          >
            {isExpanded ? 'Show less' : `Show ${lines.length - 5} more lines`}
          </button>
        ) : null}
      </div>
    )
  }

  if (item.kind === 'file-change-output') {
    return (
      <div
        className="rounded-lg border border-[var(--border-soft)] bg-surface-1 px-4 py-3"
        data-testid={`managed-content-${item.kind}`}
      >
        <div className="flex items-center gap-2 pb-2 text-xs font-semibold text-foreground">
          <FileCode className="size-3.5 text-accent-yellow" />
          File changes
        </div>
        <pre className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.6] text-body">
          {item.text}
        </pre>
      </div>
    )
  }

  if (
    item.kind === 'reasoning-text' ||
    item.kind === 'reasoning-summary-text'
  ) {
    return (
      <div
        className="rounded-lg border border-[var(--border-soft)] px-3 py-2"
        data-testid={`managed-content-${item.kind}`}
      >
        <button
          className="flex w-full items-center gap-2 text-left text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground"
          onClick={() => setIsExpanded((prev) => !prev)}
          type="button"
        >
          <Brain className="size-3.5 text-accent-blue" />
          {item.kind === 'reasoning-text' ? 'Reasoning' : 'Reasoning summary'}
          <ChevronDown
            className={`ml-auto size-3.5 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
          />
        </button>
        {isExpanded ? (
          <pre className="mt-2 whitespace-pre-wrap break-words font-sans text-[13px] leading-[1.6] text-muted-foreground">
            {item.text}
          </pre>
        ) : null}
      </div>
    )
  }

  if (item.kind === 'system') {
    return (
      <p className="system-notice" data-testid={`managed-content-${item.kind}`}>
        {item.text}
      </p>
    )
  }

  return (
    <div
      className={cn(
        'px-1',
        item.kind === 'assistant-text' && 'assistant-message',
      )}
      data-minimap-message={
        item.kind === 'assistant-text' ? 'Agent response' : undefined
      }
      data-testid={`managed-content-${item.kind}`}
    >
      {item.kind === 'assistant-text' && item.provider && showProvider ? (
        <p className="mb-2 flex items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-surface-2 ring-1 ring-[var(--border-soft)]">
            {item.provider === 'claude' ? (
              <AnthropicIcon className="size-3.5" />
            ) : (
              <OpenAIIcon className="size-3.5" />
            )}
          </span>
          <span className="text-[13px] font-semibold text-foreground">
            {item.provider === 'claude' ? 'Claude' : 'Codex'}
          </span>
          {item.model ? (
            <span className="font-mono text-[11px] text-muted-foreground">
              {` · ${item.model}`}
            </span>
          ) : null}
        </p>
      ) : null}
      {item.phase === 'commentary' ? (
        <details
          className="group/activity text-muted-foreground"
          data-testid="assistant-activity"
        >
          <summary className="flex cursor-pointer list-none items-center gap-2 py-1 text-xs font-medium">
            <ChevronRight className="size-3.5 transition-transform group-open/activity:rotate-90" />
            Activity
          </summary>
          <div className="mt-2 border-l border-border pl-4 text-[13px]">
            <MarkdownContent text={item.text} formatSessionLabels />
          </div>
        </details>
      ) : (
        <MarkdownContent
          text={item.text}
          formatSessionLabels={item.kind === 'assistant-text'}
        />
      )}
    </div>
  )
}

function TurnGroupBlock({
  group,
  canBranch,
  checkpointId,
  isFailed,
  isRunning,
  onBranch,
  onEditFromHere,
  onInterrupt,
  onRetry,
  providerLabel,
  recipientAlias,
  requestText,
  rewindDisabledReason,
  sessionId,
}: {
  readonly group: TurnGroup
  readonly canBranch: boolean
  readonly checkpointId: string | null
  readonly isFailed: boolean
  readonly isRunning: boolean
  readonly onBranch: (responseContentItemId: string) => void
  readonly onEditFromHere: (
    checkpointId: string,
    item: ManagedSessionContentItem,
  ) => void
  readonly onInterrupt: (recipientAlias: string) => void
  readonly onRetry: (text: string, recipientAlias: string) => void
  readonly providerLabel: string
  readonly recipientAlias: string | null
  readonly requestText: string | null
  readonly rewindDisabledReason: string | null
  readonly sessionId: string
}) {
  const [turnDiff, setTurnDiff] = useState<TurnCheckpointDiff | null>(null)
  const [isTurnDiffOpen, setIsTurnDiffOpen] = useState(false)
  const canRetry = isFailed && Boolean(requestText) && Boolean(recipientAlias)
  const responseItem = group.items
    .filter(
      (item) => item.kind === 'assistant-text' && item.phase !== 'commentary',
    )
    .at(-1)
  const responseContentItemId = responseItem?.id

  useEffect(() => {
    if (!checkpointId || isRunning) return
    let cancelled = false
    void getAideApi()
      ?.getTurnCheckpointDiff(sessionId, checkpointId)
      .then(
        (diff) => {
          if (!cancelled) setTurnDiff(diff)
        },
        () => undefined,
      )
    return () => {
      cancelled = true
    }
  }, [checkpointId, isRunning, sessionId])

  return (
    <div className={cn('chat-turn relative space-y-3', isRunning && 'turn')}>
      {group.items.map((item, index) => {
        const previous = group.items[index - 1]
        return (
          <ContentItemBlock
            editFromHereDisabledReason={rewindDisabledReason}
            item={item}
            key={`${item.kind}:${item.id}`}
            onEditFromHere={
              checkpointId && item.kind === 'user-prompt'
                ? () => onEditFromHere(checkpointId, item)
                : undefined
            }
            showProvider={
              previous?.kind !== 'assistant-text' ||
              previous.provider !== item.provider ||
              previous.model !== item.model
            }
          />
        )
      })}
      {isRunning ? (
        <div className="flex items-center gap-2 px-1 text-[13px] text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin text-primary-on-dark" />
          {providerLabel} is working...
          {recipientAlias ? (
            <button
              className="ml-auto text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
              onClick={() => onInterrupt(recipientAlias)}
              type="button"
            >
              Interrupt @{recipientAlias}
            </button>
          ) : null}
        </div>
      ) : null}
      {!isRunning && (canRetry || responseItem) ? (
        <div
          className="response-actions flex items-center gap-1 px-1 opacity-0 transition-opacity hover:opacity-100 focus-within:opacity-100"
          data-testid="response-actions"
        >
          <MessageCopyButton
            kind="response"
            text={group.items
              .filter(
                (item) =>
                  item.kind === 'assistant-text' && item.phase !== 'commentary',
              )
              .map((item) => item.text)
              .join('\n\n')}
          />
          {turnDiff && turnDiff.files.length > 0 ? (
            <button
              aria-expanded={isTurnDiffOpen}
              className="flex items-center gap-1 rounded-md border border-[var(--border-soft)] bg-surface-2 px-2 py-1 text-[11px] font-medium tabular-nums text-muted-foreground shadow-sm transition-colors hover:text-foreground"
              data-testid="turn-diff-chip"
              onClick={() => setIsTurnDiffOpen((open) => !open)}
              type="button"
            >
              <span className="text-accent-green">+{turnDiff.additions}</span>{' '}
              <span className="text-accent-red">-{turnDiff.deletions}</span>{' '}
              <span>
                · {turnDiff.files.length}{' '}
                {turnDiff.files.length === 1 ? 'file' : 'files'}
              </span>
            </button>
          ) : null}
          {canRetry && requestText && recipientAlias ? (
            <button
              aria-label="Retry turn"
              className="flex items-center gap-1 rounded-md border border-[var(--border-soft)] bg-surface-2 px-2 py-1 text-[11px] font-medium text-muted-foreground shadow-sm transition-colors hover:text-foreground"
              onClick={() => onRetry(requestText, recipientAlias)}
              type="button"
            >
              <RefreshCw className="size-3" />
              Retry
            </button>
          ) : null}
          {canBranch && responseContentItemId ? (
            <IconTooltip label="Branch conversation">
              <Button
                aria-label="Branch conversation"
                className="size-7 rounded-md text-muted-foreground"
                isIconOnly
                onPress={() => onBranch(responseContentItemId)}
                size="sm"
                variant="ghost"
              >
                <GitBranch className="size-3.5" />
              </Button>
            </IconTooltip>
          ) : null}
          {responseItem ? (
            <time
              dateTime={responseItem.updatedAt}
              className="ml-1 text-[11px] tabular-nums text-muted-foreground/70"
            >
              {formatMessageTime(responseItem.updatedAt)}
            </time>
          ) : null}
        </div>
      ) : null}
      {isTurnDiffOpen && turnDiff ? (
        <div className="space-y-2" data-testid="turn-diff-files">
          {turnDiff.files.map((file) => (
            <details
              className="group/turn-diff rounded-md border border-border bg-surface"
              key={file.path}
              open
            >
              <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1 text-[11px] font-medium text-muted-foreground">
                <ChevronRight className="size-3 transition-transform group-open/turn-diff:rotate-90" />
                {file.path}
                <span className="ml-auto tabular-nums text-accent-green">
                  +{file.additions}
                </span>
                <span className="tabular-nums text-accent-red">
                  -{file.deletions}
                </span>
              </summary>
              <div className="max-h-96 overflow-auto border-t border-border">
                <Suspense fallback={null}>
                  <LazyGitDiffView
                    filePath={file.path}
                    outputFormat="line-by-line"
                    patch={file.patch}
                  />
                </Suspense>
              </div>
            </details>
          ))}
        </div>
      ) : null}
    </div>
  )
}

type DraftAnswersState = Record<string, Record<string, string>>

export default function ManagedAgentPane({
  isActive,
  paneId,
  workspace,
}: ManagedAgentPaneProps) {
  const sessionId = useMemo(
    () => `${workspace.id}:${paneId}`,
    [paneId, workspace.id],
  )
  const composerStorageKey = `aide:managed-composer:${sessionId}`
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
  const draftInputRef = useRef('')
  const [attachments, setAttachments] = useState<
    readonly ManagedSessionAttachment[]
  >([])

  useEffect(() => {
    draftInputRef.current = draftInput
  }, [draftInput])
  const [configuredAgents, setConfiguredAgents] = useState<
    readonly ManagedSessionAgentConfig[]
  >([])
  const [selectedRecipientAliases, setSelectedRecipientAliases] = useState<
    readonly string[]
  >([])
  const [selectedSkill, setSelectedSkill] = useState<ProviderSkill | null>(null)
  const composerMetadataRef = useRef({
    attachments: [] as readonly ManagedSessionAttachment[],
    recipients: [] as readonly string[],
    skill: null as ProviderSkill | null,
  })

  useEffect(() => {
    composerMetadataRef.current = {
      attachments,
      recipients: selectedRecipientAliases,
      skill: selectedSkill,
    }
  }, [attachments, selectedRecipientAliases, selectedSkill])

  const [providerSkills, setProviderSkills] =
    useState<ProviderSkillsSnapshot | null>(null)
  const [isProviderSkillsLoading, setIsProviderSkillsLoading] = useState(false)
  const [isDraftHydrated, setIsDraftHydrated] = useState(false)
  const [draftLoadError, setDraftLoadError] = useState<string | null>(null)
  const draftLoadGenerationRef = useRef(0)
  const draftSaveChainRef = useRef<Promise<void> | null>(null)
  const [recipientActiveIndex, setRecipientActiveIndex] = useState(0)
  const [composerCursorIndex, setComposerCursorIndex] = useState(0)
  const [workspaceFileSearchResult, setWorkspaceFileSearchResult] = useState<{
    readonly filePaths: readonly string[]
    readonly query: string
  } | null>(null)
  const workspaceFileSearchRef = useRef(new WorkspaceFileMentionSearch())
  const [isRecipientMenuDismissed, setIsRecipientMenuDismissed] =
    useState(false)
  const [draftAnswers, setDraftAnswers] = useState<DraftAnswersState>({})
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [agentMode, setAgentMode] = useState<'build' | 'plan'>('build')
  const [effort, setEffort] = useState<ManagedSessionEffort | undefined>(
    undefined,
  )
  const [contextWindow] = useState<ManagedSessionContextWindow>('200k')
  const [serviceTier, setServiceTier] = useState<string | null>(null)
  const [permissionMode, setPermissionMode] =
    useState<ManagedSessionPermissionMode>('default')
  const [slashActiveIndex, setSlashActiveIndex] = useState(0)
  const [isSlashMenuDismissed, setIsSlashMenuDismissed] = useState(false)
  const [openComposerMenu, setOpenComposerMenu] = useState<
    'effort' | 'model' | 'permission' | null
  >(null)
  const slashMenuRef = useRef<HTMLDivElement | null>(null)
  const jevSettingsButtonRef = useRef<HTMLButtonElement | null>(null)
  const [isJevSetupOpen, setIsJevSetupOpen] = useState(false)
  const [rewindTarget, setRewindTarget] = useState<{
    readonly attachments: readonly ManagedSessionAttachment[]
    readonly checkpointId: string
  } | null>(null)
  const startedSessionRef = useRef(false)
  const configuredAgentsInitializedRef = useRef(false)
  const hydratedProviderSelectionKeyRef = useRef<string | null>(null)
  const snapshotRevisionRef = useRef({ revision: -1, runtimeGeneration: -1 })
  const paneRef = useRef<HTMLElement>(null)
  const shouldFocusComposerRef = useRef(false)
  const wasActiveRef = useRef(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [isAtBottom, setIsAtBottom] = useState(true)

  const providerLabel = selectedProvider === 'claude' ? 'Claude' : 'Codex'
  const workingProviderLabel =
    snapshot?.provider === 'claude'
      ? 'Claude'
      : snapshot?.provider === 'codex'
        ? 'Codex'
        : providerLabel
  const selectionHydrationKey = providerSelectionHydrationKey(
    workspace.id,
    selectedProvider,
  )
  const isSelectionHydrated = isProviderSelectionHydrated(
    hydratedProviderSelectionKeyRef.current,
    workspace.id,
    selectedProvider,
  )
  const canChangeProviderSelection =
    capabilities !== null && canChangeManagedSessionSelection(snapshot)

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

    if (startedSessionRef.current) {
      hydratedProviderSelectionKeyRef.current = selectionHydrationKey
      return
    }

    const persisted = loadPersistedProviderSelection(
      workspace.id,
      selectedProvider,
    )
    const resolution = resolveProviderSelection(providerCapabilities, persisted)

    if (!resolution.modelId) {
      setError(resolution.explanation)
      setSelectionNotice(resolution.explanation)
      return
    }

    setSelectedModel(resolution.modelId)
    setEffort(resolution.effort ?? undefined)
    setServiceTier(resolution.serviceTier)
    setSelectionNotice(resolution.explanation)
    persistProviderSelection(workspace.id, selectedProvider, {
      effort: resolution.effort ?? undefined,
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

  useLayoutEffect(() => {
    if (!isActive) {
      shouldFocusComposerRef.current = false
      wasActiveRef.current = false
      return
    }
    if (!wasActiveRef.current) shouldFocusComposerRef.current = true
    wasActiveRef.current = true
    if (!isDraftHydrated || !shouldFocusComposerRef.current) return
    shouldFocusComposerRef.current = false
    const activeElement = document.activeElement
    if (
      activeElement instanceof HTMLElement &&
      paneRef.current?.contains(activeElement)
    )
      return
    textareaRef.current?.focus({ preventScroll: true })
  }, [isActive, isDraftHydrated])

  const hydrateManagedDraft = useCallback(async () => {
    const generation = draftLoadGenerationRef.current + 1
    draftLoadGenerationRef.current = generation
    setIsDraftHydrated(false)
    setDraftLoadError(null)
    setError((currentError) =>
      currentError?.startsWith('Could not load saved draft:')
        ? null
        : currentError,
    )
    try {
      const draft = await loadManagedDraft(composerStorageKey)
      if (draftLoadGenerationRef.current !== generation) return
      setDraftInput(draft?.text ?? '')
      setAttachments(draft?.attachments ?? [])
      setSelectedRecipientAliases(draft?.recipients ?? [])
      setSelectedSkill(draft?.selectedSkill ?? null)
      setIsDraftHydrated(true)
    } catch (draftError) {
      if (draftLoadGenerationRef.current !== generation) return
      const message = `Could not load saved draft: ${getErrorMessage(draftError)}`
      setDraftLoadError(message)
      setError(message)
    }
  }, [composerStorageKey])

  useEffect(() => {
    void hydrateManagedDraft()
    return () => {
      draftLoadGenerationRef.current += 1
    }
  }, [hydrateManagedDraft])

  useEffect(() => {
    if (!isDraftHydrated) return
    const draft = {
      attachments: [...attachments],
      recipients: [...selectedRecipientAliases],
      ...(selectedSkill ? { selectedSkill } : {}),
      text: draftInput,
    }
    const persistDraft = async () => {
      if (
        !draft.text &&
        draft.recipients.length === 0 &&
        draft.attachments.length === 0 &&
        !draft.selectedSkill
      ) {
        await removeManagedDraft(composerStorageKey)
      } else {
        await saveManagedDraft(composerStorageKey, draft)
      }
    }
    draftSaveChainRef.current = (draftSaveChainRef.current ?? Promise.resolve())
      .catch(() => undefined)
      .then(persistDraft)
    void draftSaveChainRef.current.catch((draftError) => {
      setError(getErrorMessage(draftError))
    })
  }, [
    attachments,
    composerStorageKey,
    draftInput,
    isDraftHydrated,
    selectedRecipientAliases,
    selectedSkill,
  ])

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
        setAgentMode(existing.interactionMode)
        if (existing.agents) {
          setConfiguredAgents(existing.agents)
          configuredAgentsInitializedRef.current = true
        }
        const composerSelection = getComposerProviderSelection(existing)
        setSelectedModel(composerSelection.model)
        setEffort(composerSelection.effort)
        setServiceTier(composerSelection.serviceTier ?? null)
        setSelectionNotice(existing.selectionNotice)
        if (isUnifiedPane) {
          setSelectedProvider(composerSelection.mode)
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
          serviceTier,
        },
        paneId,
        permissionMode: agentMode === 'plan' ? 'plan' : permissionMode,
        sessionId,
        serviceTier,
        workspaceId: workspace.id,
      })
      setSnapshot(created)
      setAgentMode(created.interactionMode)
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
      setAgentMode(nextSnapshot.interactionMode)
      if (nextSnapshot.agents) {
        setConfiguredAgents(nextSnapshot.agents)
        configuredAgentsInitializedRef.current = true
      }
      const composerSelection = getComposerProviderSelection(nextSnapshot)
      setSelectedModel(composerSelection.model)
      setEffort(composerSelection.effort)
      setServiceTier(composerSelection.serviceTier ?? null)
      setSelectionNotice(nextSnapshot.selectionNotice)
      if (isUnifiedPane) {
        setSelectedProvider(composerSelection.mode)
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

    void api.getManagedSessionSnapshots().then(async (snapshots) => {
      const existing = snapshots[sessionId]
      if (existing) {
        applySnapshot(existing)
        return
      }
      const transcriptApi = api as AideApi & {
        getTaskTranscript?: (
          requestedSessionId: string,
        ) => Promise<ManagedSessionSnapshot | null>
      }
      const transcript = await transcriptApi.getTaskTranscript?.(sessionId)
      if (transcript) {
        setSnapshot(transcript)
      }
    })

    return unsubscribe
  }, [isUnifiedPane, sessionId, terminalMode])

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
    async (
      text: string,
      recipients: readonly string[] = [],
      promptAttachments: readonly ManagedSessionAttachment[] = [],
      providerSkill?: ProviderSkill,
    ) => {
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
        await api.sendManagedSessionInput(
          sessionId,
          trimmed,
          recipients,
          promptAttachments,
          providerSkill
            ? { id: providerSkill.id, provider: providerSkill.provider }
            : undefined,
        )
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
    const submittedAttachments = attachments
    const submittedSkill = selectedSkill
    let clearedSubmission = false
    const parsed = extractExplicitRecipientAliases(
      submittedDraft,
      configuredAgents.map((agent) => agent.alias),
    )

    if (parsed.error) {
      setError(parsed.error)
      return
    }

    if (submittedSkill && selectedProvider !== submittedSkill.provider) {
      setError(
        `/${submittedSkill.name} runs with ${submittedSkill.owner}. Select it again to switch providers.`,
      )
      return
    }

    const recipients = Array.from(
      new Set([...submittedRecipientAliases, ...parsed.aliases]),
    )

    if (submittedSkill && recipients.length > 0) {
      setError(
        `/${submittedSkill.name} runs with ${submittedSkill.owner} and cannot be combined with opinion recipients.`,
      )
      return
    }

    if (draftInputRef.current === submittedDraft) {
      clearedSubmission = true
      draftInputRef.current = ''
      composerMetadataRef.current = {
        attachments: [],
        recipients: [],
        skill: null,
      }
      setDraftInput((currentDraft) =>
        currentDraft === submittedDraft ? '' : currentDraft,
      )
      setSelectedRecipientAliases((currentAliases) =>
        currentAliases === submittedRecipientAliases ? [] : currentAliases,
      )
      setAttachments((currentAttachments) =>
        currentAttachments === submittedAttachments ? [] : currentAttachments,
      )
      setSelectedSkill((currentSkill) =>
        currentSkill === submittedSkill ? null : currentSkill,
      )
    }

    const sent = await sendPromptText(
      parsed.text,
      recipients,
      submittedAttachments,
      submittedSkill ?? undefined,
    )

    const currentMetadata = composerMetadataRef.current
    if (
      !sent &&
      clearedSubmission &&
      draftInputRef.current === '' &&
      currentMetadata.attachments.length === 0 &&
      currentMetadata.recipients.length === 0 &&
      currentMetadata.skill === null
    ) {
      draftInputRef.current = submittedDraft
      composerMetadataRef.current = {
        attachments: submittedAttachments,
        recipients: submittedRecipientAliases,
        skill: submittedSkill,
      }
      setDraftInput(submittedDraft)
      setSelectedRecipientAliases(submittedRecipientAliases)
      setAttachments(submittedAttachments)
      setSelectedSkill(submittedSkill)
    }
  }, [
    attachments,
    configuredAgents,
    draftInput,
    selectedRecipientAliases,
    selectedProvider,
    selectedSkill,
    sendPromptText,
  ])

  const addImageFiles = useCallback(
    async (files: readonly File[]) => {
      try {
        const nextAttachments = await createImageAttachments(files, attachments)
        if (nextAttachments.length > 0) {
          setAttachments((current) => [...current, ...nextAttachments])
          setError(null)
        }
      } catch (attachmentError) {
        setError(getErrorMessage(attachmentError))
      }
    },
    [attachments],
  )

  const handleComposerPaste = useCallback(
    (event: ClipboardEvent<HTMLTextAreaElement>) => {
      const imageFiles = Array.from(event.clipboardData.files).filter((file) =>
        file.type.startsWith('image/'),
      )
      if (imageFiles.length === 0) return
      event.preventDefault()
      void addImageFiles(imageFiles)
    },
    [addImageFiles],
  )

  const handleComposerDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      const imageFiles = Array.from(event.dataTransfer.files).filter((file) =>
        file.type.startsWith('image/'),
      )
      if (imageFiles.length === 0) return
      event.preventDefault()
      void addImageFiles(imageFiles)
    },
    [addImageFiles],
  )

  const handlePickWorkspaceFiles = useCallback(async () => {
    const api = getAideApi()
    if (!api) return
    try {
      const paths = await api.pickManagedSessionFiles(workspace.id)
      const uniquePaths = paths.filter(
        (filePath) =>
          !attachments.some(
            (attachment) =>
              attachment.kind === 'workspace-file' &&
              attachment.path === filePath,
          ),
      )
      if (
        attachments.length + uniquePaths.length >
        MANAGED_SESSION_MAX_ATTACHMENTS
      ) {
        throw new Error(
          `Attach at most ${MANAGED_SESSION_MAX_ATTACHMENTS} files.`,
        )
      }
      setAttachments((current) => {
        const existingPaths = new Set(
          current.flatMap((attachment) =>
            attachment.kind === 'workspace-file' ? [attachment.path] : [],
          ),
        )
        return [
          ...current,
          ...uniquePaths
            .filter((filePath) => !existingPaths.has(filePath))
            .map((filePath) => ({
              id: crypto.randomUUID(),
              kind: 'workspace-file' as const,
              path: filePath,
            })),
        ]
      })
      setError(null)
    } catch (attachmentError) {
      setError(getErrorMessage(attachmentError))
    }
  }, [attachments, workspace.id])

  const runQueueAction = useCallback(
    async (action: (api: AideApi) => Promise<void>) => {
      const api = getAideApi()
      if (!api) return
      setIsSubmitting(true)
      try {
        if (!(await ensureSession())) return
        await action(api)
        setError(null)
      } catch (queueError) {
        setError(getErrorMessage(queueError))
      } finally {
        setIsSubmitting(false)
      }
    },
    [ensureSession],
  )

  const handleRetryTurn = useCallback(
    async (text: string, recipientAlias: string) => {
      await sendPromptText(text, [recipientAlias])
    },
    [sendPromptText],
  )

  const handleRewindRestored = useCallback(
    async (result: TurnCheckpointRestoreResult) => {
      const api = getAideApi()
      if (!api) {
        throw new Error('Managed provider bridge did not load.')
      }
      await saveManagedDraft(`aide:managed-composer:${result.sessionId}`, {
        attachments: [...(rewindTarget?.attachments ?? [])],
        recipients: [],
        text: result.editedPrompt,
      })
      await api.openTask(result.sessionId)
    },
    [rewindTarget],
  )

  const handleBranchConversation = useCallback(
    async (responseContentItemId: string) => {
      const api = getAideApi()
      if (!api) {
        setError('Managed provider bridge did not load.')
        return
      }
      try {
        await api.branchManagedSession(sessionId, responseContentItemId)
      } catch (branchError) {
        setError(getErrorMessage(branchError))
      }
    },
    [sessionId],
  )

  const handleInterruptRecipient = useCallback(
    (recipientAlias: string) => {
      const api = getAideApi()
      if (api) {
        void api.interruptManagedSession(sessionId, recipientAlias)
      }
    },
    [sessionId],
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

  const applyAgentMode = useCallback(
    async (interactionMode: ManagedSessionInteractionMode) => {
      if (!startedSessionRef.current) {
        setAgentMode(interactionMode)
        return
      }

      const api = getAideApi()

      if (!api) {
        setError('Managed provider bridge did not load.')
        return
      }

      setIsSubmitting(true)
      try {
        const updated = await api.configureManagedSessionMode(
          sessionId,
          interactionMode,
        )
        setSnapshot(updated)
        setAgentMode(updated.interactionMode)
        setError(null)
      } catch (modeError) {
        setError(getErrorMessage(modeError))
      } finally {
        setIsSubmitting(false)
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
        return false
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
        return false
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
        setError(null)
        return true
      }

      const api = getAideApi()
      if (!api) {
        setError('Managed provider bridge did not load.')
        return false
      }

      try {
        const updated = await api.switchManagedSessionProvider(
          sessionId,
          change.selection,
        )
        setSnapshot(updated)
        const composerSelection = getComposerProviderSelection(updated)
        setSelectedModel(composerSelection.model)
        setEffort(composerSelection.effort)
        setServiceTier(composerSelection.serviceTier ?? null)
        setSelectionNotice(updated.selectionNotice)
        persistProviderSelection(workspace.id, composerSelection.mode, {
          effort: composerSelection.effort,
          modelId: composerSelection.model,
          serviceTier: composerSelection.serviceTier ?? null,
        })
        if (isUnifiedPane) {
          setSelectedProvider(composerSelection.mode)
          localStorage.setItem(
            `aide:workspace:${workspace.id}:provider`,
            composerSelection.mode,
          )
        }
        setError(null)
        return true
      } catch (switchError) {
        setError(getErrorMessage(switchError))
        return false
      }
    },
    [capabilities, isUnifiedPane, selectedProvider, sessionId, workspace.id],
  )

  const handleModelSwitch = useCallback(
    async (newMode: ManagedSessionMode, newModelId: string) => {
      const changed = await handleProviderSelectionChange(newMode, {
        effort: newMode === selectedProvider ? effort : undefined,
        modelId: newModelId,
        serviceTier: newMode === selectedProvider ? serviceTier : undefined,
      })

      if (changed && selectedSkill && selectedSkill.provider !== newMode) {
        setSelectedSkill(null)
        setSelectionNotice(
          `Removed /${selectedSkill.name} because it runs with ${selectedSkill.owner}.`,
        )
      }
    },
    [
      effort,
      handleProviderSelectionChange,
      selectedProvider,
      selectedSkill,
      serviceTier,
    ],
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
  const visibleTurnGroups = useMemo(() => {
    const contentTurnIds = new Set(
      turnGroups
        .map((group) => group.turnId)
        .filter((turnId): turnId is string => turnId !== null),
    )
    const emptyOpinionGroups = (snapshot?.turns ?? [])
      .filter(
        (turn) => Boolean(turn.recipientAlias) && !contentTurnIds.has(turn.id),
      )
      .map((turn) => ({ items: [], turnId: turn.id }))

    return [...turnGroups, ...emptyOpinionGroups]
  }, [snapshot?.turns, turnGroups])

  const selectRecipient = useCallback(
    (agent: ManagedSessionAgentConfig) => {
      const mention = getWorkspaceFileMention(draftInput, composerCursorIndex)
      if (!mention) return

      const alias = agent.alias.toLowerCase()
      setDraftInput(removeWorkspaceFileMention(draftInput, mention))
      setComposerCursorIndex(mention.startIndex)
      setSelectedRecipientAliases((aliases) =>
        aliases.includes(alias) ? aliases : [...aliases, alias],
      )
      if (selectedSkill) {
        setSelectedSkill(null)
        setSelectionNotice(
          `Removed /${selectedSkill.name} because opinion recipients use their configured models.`,
        )
      }
      setIsRecipientMenuDismissed(true)
      textareaRef.current?.focus()
      setError(null)
    },
    [composerCursorIndex, draftInput, selectedSkill],
  )

  const selectWorkspaceFileFromMention = useCallback(
    (filePath: string) => {
      const mention = getWorkspaceFileMention(draftInput, composerCursorIndex)
      if (!mention) return

      try {
        const nextAttachments = appendWorkspaceFileAttachment(
          attachments,
          filePath,
          crypto.randomUUID(),
        )
        setAttachments(nextAttachments)
        const nextDraft = removeWorkspaceFileMention(draftInput, mention)
        setDraftInput(nextDraft)
        setComposerCursorIndex(mention.startIndex)
        setIsRecipientMenuDismissed(true)
        setError(null)
        requestAnimationFrame(() => {
          textareaRef.current?.focus()
          textareaRef.current?.setSelectionRange(
            mention.startIndex,
            mention.startIndex,
          )
        })
      } catch (attachmentError) {
        setError(getErrorMessage(attachmentError))
      }
    },
    [attachments, composerCursorIndex, draftInput],
  )

  const loadProviderSkills = useCallback(
    async (forceReload = false) => {
      const api = getAideApi()

      if (!api) {
        setProviderSkills({
          errors: {
            claude: 'Managed provider bridge did not load.',
            codex: 'Managed provider bridge did not load.',
          },
          skills: [],
        })
        return
      }

      setIsProviderSkillsLoading(true)
      try {
        setProviderSkills(
          await api.getProviderSkills(workspace.id, forceReload),
        )
      } catch (skillsError) {
        const message = getErrorMessage(skillsError)
        setProviderSkills({
          errors: { claude: message, codex: message },
          skills: [],
        })
      } finally {
        setIsProviderSkillsLoading(false)
      }
    },
    [workspace.id],
  )

  const slashContext = useMemo<SlashCommandContext>(
    () => ({
      agentMode,
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
      setAgentMode: applyAgentMode,
      setDraft: (text: string) => setDraftInput(text),
    }),
    [
      agentMode,
      applyAgentMode,
      sessionId,
      snapshot?.content,
      snapshot?.sessionState,
    ],
  )

  const workspaceFileMention = getWorkspaceFileMention(
    draftInput,
    composerCursorIndex,
  )
  const workspaceFileMentionQuery = workspaceFileMention?.query ?? null
  const recipientMentionQuery = workspaceFileMentionQuery
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

  useEffect(() => {
    if (
      (slashQuery !== null || workspaceFileMentionQuery !== null) &&
      !providerSkills &&
      !isProviderSkillsLoading
    ) {
      void loadProviderSkills()
    }
  }, [
    isProviderSkillsLoading,
    loadProviderSkills,
    providerSkills,
    slashQuery,
    workspaceFileMentionQuery,
  ])

  const recipientSkillSuggestions = useMemo(
    () =>
      workspaceFileMentionQuery !== null
        ? filterProviderSkills(
            (providerSkills?.skills ?? []).filter(
              (skill) => isUnifiedPane || skill.provider === selectedProvider,
            ),
            workspaceFileMentionQuery,
          ).slice(0, 6)
        : [],
    [
      isUnifiedPane,
      providerSkills?.skills,
      selectedProvider,
      workspaceFileMentionQuery,
    ],
  )

  const filteredSlashCommands = useMemo<SlashCommand[]>(
    () =>
      slashQuery === null
        ? []
        : filterSlashCommands(SLASH_COMMANDS, slashQuery, slashContext),
    [slashContext, slashQuery],
  )
  const filteredProviderSkills = useMemo(
    () =>
      slashQuery === null
        ? []
        : filterProviderSkills(
            (providerSkills?.skills ?? []).filter(
              (skill) => isUnifiedPane || skill.provider === selectedProvider,
            ),
            slashQuery,
          ),
    [isUnifiedPane, providerSkills?.skills, selectedProvider, slashQuery],
  )
  const slashMenuItems = useMemo<ManagedSlashMenuItem[]>(
    () => [
      ...filteredSlashCommands.map(
        (command): ManagedSlashMenuItem => ({ command, kind: 'command' }),
      ),
      ...filteredProviderSkills.map(
        (skill): ManagedSlashMenuItem => ({ kind: 'skill', skill }),
      ),
    ],
    [filteredProviderSkills, filteredSlashCommands],
  )
  const providerSkillErrors = Object.entries(providerSkills?.errors ?? {})
  const slashMenuOpen = slashQuery !== null && !isSlashMenuDismissed
  const recipientMenuOpen =
    !isRecipientMenuDismissed &&
    !slashMenuOpen &&
    (recipientMentionQuery !== null || workspaceFileMention !== null)
  const workspaceFileSearchQuery = recipientMenuOpen
    ? (workspaceFileMentionQuery?.trim() ?? '')
    : ''
  const workspaceFileSuggestions: readonly string[] =
    workspaceFileSearchResult?.query === workspaceFileSearchQuery
      ? workspaceFileSearchResult.filePaths
      : []
  const isWorkspaceFileSearchLoading =
    workspaceFileSearchQuery !== '' &&
    workspaceFileSearchResult?.query !== workspaceFileSearchQuery
  const recipientMenuItemCount =
    recipientSuggestions.length +
    recipientSkillSuggestions.length +
    workspaceFileSuggestions.length

  useEffect(() => {
    const query = workspaceFileSearchQuery
    const api = getAideApi()
    if (!api || !query) {
      workspaceFileSearchRef.current.cancel()
      return
    }

    void workspaceFileSearchRef.current.run(
      () => api.searchManagedSessionFiles(workspace.id, query),
      (filePaths) => {
        setWorkspaceFileSearchResult({ filePaths, query })
      },
      () => {
        setWorkspaceFileSearchResult({ filePaths: [], query })
      },
    )
    return () => workspaceFileSearchRef.current.cancel()
  }, [workspace.id, workspaceFileSearchQuery])

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

  useEffect(() => {
    if (!slashMenuOpen) return
    slashMenuRef.current
      ?.querySelectorAll('[role="option"]')
      [slashActiveIndex]?.scrollIntoView({ block: 'nearest' })
  }, [slashActiveIndex, slashMenuOpen])

  const runSlashCommand = useCallback(
    async (command: SlashCommand) => {
      await command.run(slashContext)
    },
    [slashContext],
  )

  const selectProviderSkill = useCallback(
    async (skill: ProviderSkill, nextDraft = '') => {
      if (!canChangeProviderSelection) {
        setError('Finish the active turn before selecting a provider skill.')
        return
      }

      const changed = await handleProviderSelectionChange(
        skill.provider,
        loadPersistedProviderSelection(workspace.id, skill.provider),
      )
      if (!changed) {
        return
      }

      const clearedRecipients = selectedRecipientAliases.length > 0
      setSelectedRecipientAliases([])
      setSelectedSkill(skill)
      setDraftInput(nextDraft)
      setIsRecipientMenuDismissed(true)
      setSelectionNotice(
        `/${skill.name} runs with ${skill.owner}.${clearedRecipients ? ' Opinion recipients were cleared.' : ''}`,
      )
      textareaRef.current?.focus()
    },
    [
      canChangeProviderSelection,
      handleProviderSelectionChange,
      selectedRecipientAliases.length,
      workspace.id,
    ],
  )

  const selectSkillFromMention = useCallback(
    (skill: ProviderSkill) => {
      const mention = getWorkspaceFileMention(draftInput, composerCursorIndex)
      if (!mention) return
      const nextDraft = removeWorkspaceFileMention(draftInput, mention)
      setComposerCursorIndex(mention.startIndex)
      void selectProviderSkill(skill, nextDraft)
    },
    [composerCursorIndex, draftInput, selectProviderSkill],
  )

  const runningTurnId = useMemo(
    () => snapshot?.turns.find((turn) => turn.state === 'running')?.id ?? null,
    [snapshot?.turns],
  )
  const rewindDisabledReason =
    runningTurnId !== null || snapshot?.sessionState === 'running'
      ? 'Stop the running task before rewinding.'
      : null

  return (
    <section
      className="managed-agent-pane flex h-full w-full min-h-0 min-w-0 flex-col overflow-hidden bg-surface"
      data-testid="managed-agent-pane"
      ref={paneRef}
    >
      <div className="flex h-[var(--pane-header-h)] shrink-0 items-center justify-between gap-3 border-b border-border/70 px-4">
        <h2 className="text-sm font-semibold tracking-[-0.374px] text-foreground">
          {isUnifiedPane ? 'Agent' : providerLabel}
        </h2>

        <div className="flex items-center gap-2">
          <IconTooltip label="Jev settings">
            <Button
              aria-label="Jev settings"
              className="size-8 rounded-md"
              isIconOnly
              aria-expanded={isJevSetupOpen}
              onPress={() => setIsJevSetupOpen((open) => !open)}
              ref={jevSettingsButtonRef}
              size="sm"
              variant="ghost"
            >
              <ShieldCheck aria-hidden="true" className="size-4" />
            </Button>
          </IconTooltip>
          <OpenInEditorButton cwd={workspace.worktreePath} />
          <Button
            isDisabled={!isSubmitting && snapshot?.sessionState !== 'running'}
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

      {rewindTarget ? (
        <ManagedRewindDialog
          checkpointId={rewindTarget.checkpointId}
          onClose={() => setRewindTarget(null)}
          onRestored={handleRewindRestored}
          sessionId={sessionId}
        />
      ) : null}

      <JevSetup
        isOpen={isJevSetupOpen}
        key={workspace.id}
        onOpenChange={(isOpen) => {
          setIsJevSetupOpen(isOpen)
          if (!isOpen) {
            requestAnimationFrame(() => jevSettingsButtonRef.current?.focus())
          }
        }}
        workspaceId={workspace.id}
      />

      {error ? (
        <div className="flex items-center gap-3 border-b border-accent-red bg-accent-red-soft px-4 py-2.5 text-sm text-accent-red">
          <span className="flex-1">{error}</span>
          {draftLoadError ? (
            <button
              className="font-semibold underline underline-offset-2"
              onClick={() => void hydrateManagedDraft()}
              type="button"
            >
              Retry draft
            </button>
          ) : null}
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

      <div className="relative min-h-0 flex-1">
        <div
          className="relative h-full overflow-y-auto pl-12 pr-4 py-4"
          data-testid="managed-session-content"
          onScroll={handleScroll}
          ref={scrollRef}
        >
          {visibleTurnGroups.length > 0 ? (
            <div className="mx-auto max-w-3xl space-y-8">
              {visibleTurnGroups.map((group) => {
                const turn = snapshot?.turns.find(
                  (candidate) => candidate.id === group.turnId,
                ) as RecipientTurnSummary | undefined

                return (
                  <TurnGroupBlock
                    canBranch={turn?.state === 'completed'}
                    checkpointId={turn?.checkpointId ?? null}
                    group={group}
                    isFailed={turn?.state === 'failed'}
                    isRunning={turn?.state === 'running'}
                    key={group.turnId ?? `system-${group.items[0]?.id}`}
                    onBranch={(responseContentItemId) =>
                      void handleBranchConversation(responseContentItemId)
                    }
                    onEditFromHere={(checkpointId, item) =>
                      setRewindTarget({
                        attachments: item.attachments ?? [],
                        checkpointId,
                      })
                    }
                    onInterrupt={handleInterruptRecipient}
                    onRetry={(text, recipientAlias) =>
                      void handleRetryTurn(text, recipientAlias)
                    }
                    providerLabel={
                      turn?.provider === 'claude'
                        ? 'Claude'
                        : turn?.provider === 'codex'
                          ? 'Codex'
                          : workingProviderLabel
                    }
                    recipientAlias={turn?.recipientAlias ?? null}
                    requestText={turn?.requestText ?? null}
                    rewindDisabledReason={rewindDisabledReason}
                    sessionId={sessionId}
                  />
                )
              })}

              {snapshot?.sessionState === 'running' &&
              runningTurnId === null ? (
                <div className="flex items-center gap-2 px-1 text-[13px] text-muted-foreground">
                  <LoaderCircle className="size-3.5 animate-spin text-primary-on-dark" />
                  {workingProviderLabel} is working...
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

        <ConversationMinimap
          key={sessionId}
          scrollRef={scrollRef}
          contentLength={contentLength}
        />
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

        <ManagedInputQueue
          canSteer={Boolean(
            snapshot?.provider === 'codex' &&
              !snapshot.pendingProviderSelection &&
              snapshot.turns.some(
                (turn) => turn.state === 'running' && !turn.recipientAlias,
              ),
          )}
          isPaused={snapshot?.queuePaused ?? false}
          isSubmitting={isSubmitting}
          items={snapshot?.queuedInputs ?? []}
          onCancel={(queuedInputId) =>
            void runQueueAction((api) =>
              api.cancelManagedSessionQueuedInput(sessionId, queuedInputId),
            )
          }
          onResume={() =>
            void runQueueAction((api) =>
              api.resumeManagedSessionQueue(sessionId),
            )
          }
          onSendNow={(queuedInputId) =>
            void runQueueAction((api) =>
              api.sendManagedSessionQueuedInputNow(sessionId, queuedInputId),
            )
          }
        />

        <div
          className="relative mx-auto w-full max-w-3xl rounded-2xl bg-surface-3 shadow-sm transition-colors focus-within:bg-surface-4"
          data-testid="managed-composer"
          onDragOver={(event) => {
            if (event.dataTransfer.types.includes('Files'))
              event.preventDefault()
          }}
          onDrop={handleComposerDrop}
        >
          {recipientMenuOpen ? (
            <RecipientMentionMenu
              activeIndex={recipientActiveIndex}
              agents={recipientSuggestions}
              filePaths={workspaceFileSuggestions}
              isFileSearchLoading={isWorkspaceFileSearchLoading}
              onActiveIndexChange={setRecipientActiveIndex}
              onSelectAgent={selectRecipient}
              onSelectFile={selectWorkspaceFileFromMention}
              onSelectSkill={selectSkillFromMention}
              skills={recipientSkillSuggestions}
            />
          ) : null}

          {slashMenuOpen ? (
            <div
              aria-label="Commands and provider skills"
              className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-sm rounded-md border border-border bg-surface shadow-[0_20px_60px_rgba(0,0,0,0.4)]"
              data-testid="managed-slash-menu"
              ref={slashMenuRef}
              role="listbox"
            >
              <div className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
                  Commands and skills
                </span>
                <button
                  className="inline-flex shrink-0 items-center gap-1 text-[10px] font-semibold text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
                  disabled={isProviderSkillsLoading}
                  onClick={() => void loadProviderSkills(true)}
                  type="button"
                >
                  <RefreshCw
                    className={cn(
                      'size-3',
                      isProviderSkillsLoading && 'animate-spin',
                    )}
                  />
                  Refresh skills
                </button>
              </div>
              <ul className="max-h-60 overflow-y-auto p-1">
                {slashMenuItems.map((item, index) => {
                  const isActive = index === slashActiveIndex
                  const isSkill = item.kind === 'skill'
                  const itemKey = isSkill
                    ? `${item.skill.provider}:${item.skill.id}`
                    : `command:${item.command.id}`

                  return (
                    <li key={itemKey}>
                      <button
                        aria-selected={isActive}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                          isActive
                            ? 'bg-surface-tertiary text-foreground'
                            : 'text-foreground/80 hover:bg-surface-secondary'
                        } disabled:cursor-not-allowed disabled:opacity-40`}
                        disabled={isSkill && !canChangeProviderSelection}
                        onClick={() => {
                          if (item.kind === 'command') {
                            void runSlashCommand(item.command)
                          } else {
                            void selectProviderSkill(item.skill)
                          }
                        }}
                        onMouseEnter={() => setSlashActiveIndex(index)}
                        role="option"
                        type="button"
                      >
                        <span className="flex min-w-0 flex-col">
                          <span className="flex min-w-0 items-center gap-2">
                            <span className="truncate font-semibold">
                              {isSkill
                                ? `/${item.skill.name}`
                                : item.command.label}
                            </span>
                            {isSkill ? (
                              <span className="shrink-0 rounded-full border border-border px-1.5 py-0.5 text-[10px] font-semibold text-muted-foreground">
                                {item.skill.owner}
                              </span>
                            ) : null}
                          </span>
                          <span className="truncate text-xs text-muted-foreground">
                            {isSkill
                              ? `${item.skill.description} Runs with ${item.skill.owner}.`
                              : item.command.description}
                          </span>
                        </span>
                      </button>
                    </li>
                  )
                })}
                {isProviderSkillsLoading && slashMenuItems.length === 0 ? (
                  <li className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                    <LoaderCircle className="size-3.5 animate-spin" />
                    Loading provider skills…
                  </li>
                ) : null}
                {!isProviderSkillsLoading && slashMenuItems.length === 0 ? (
                  <li className="px-3 py-2 text-xs text-muted-foreground">
                    No matching commands or skills.
                  </li>
                ) : null}
              </ul>
              {providerSkillErrors.length > 0 ? (
                <div className="max-h-24 overflow-y-auto break-words border-t border-border/60 px-3 py-2 text-xs text-destructive">
                  {providerSkillErrors.map(([provider, message]) => (
                    <p key={provider}>
                      {provider === 'claude' ? 'Claude' : 'Codex'}: {message}
                    </p>
                  ))}
                </div>
              ) : null}
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

          <ManagedComposerAttachments
            attachments={attachments}
            onRemove={(attachmentId) =>
              setAttachments((current) =>
                current.filter((attachment) => attachment.id !== attachmentId),
              )
            }
          />

          {selectedSkill ? (
            <div className="flex flex-wrap items-center gap-2 px-4 pt-3">
              <button
                aria-label={`Remove /${selectedSkill.name}`}
                className="max-w-full break-all rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-left text-xs font-semibold text-primary transition-colors hover:bg-primary/20"
                data-testid="managed-provider-skill-chip"
                onClick={() => setSelectedSkill(null)}
                type="button"
              >
                @{selectedSkill.owner} · /{selectedSkill.name} ×
              </button>
              <span className="text-[11px] text-muted-foreground">
                Runs with {selectedSkill.owner}
              </span>
            </div>
          ) : null}

          {selectedRecipientAliases.length > 0 ? (
            <div
              className="flex flex-wrap gap-1.5 px-4 pt-3"
              data-testid="managed-recipient-chips"
            >
              {selectedRecipientAliases.map((alias) => (
                <Button
                  aria-label={`Remove @${alias}`}
                  className="h-6 rounded-full border border-primary/40 bg-primary/10 px-2 text-xs font-semibold text-primary hover:bg-primary/20"
                  key={alias}
                  onPress={() => {
                    setSelectedRecipientAliases((aliases) =>
                      aliases.filter((value) => value !== alias),
                    )
                    textareaRef.current?.focus()
                  }}
                  size="sm"
                  variant="ghost"
                >
                  @{alias} ×
                </Button>
              ))}
            </div>
          ) : null}

          <p aria-live="polite" className="sr-only">
            {selectedSkill
              ? `Selected skill /${selectedSkill.name}; runs with ${selectedSkill.owner}`
              : selectedRecipientAliases.length > 0
                ? `Recipients: ${selectedRecipientAliases.map((alias) => `@${alias}`).join(', ')}`
                : 'Conversation default recipient'}
          </p>

          <textarea
            ref={textareaRef}
            aria-label={
              activeQuestion ? 'Free-form answer' : `${providerLabel} prompt`
            }
            className="max-h-[200px] w-full resize-none overflow-y-auto border-none bg-transparent px-4 pt-3.5 pb-2 text-[15px] leading-[1.5] placeholder:text-muted-foreground/70 focus:outline-none"
            disabled={!isDraftHydrated}
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
                setComposerCursorIndex(event.target.selectionStart)
                setRecipientActiveIndex(0)
                setIsRecipientMenuDismissed(false)
                setIsSlashMenuDismissed(false)
              }
              const el = event.target
              el.style.height = 'auto'
              el.style.height = `${el.scrollHeight}px`
            }}
            onKeyDown={(event) => {
              if (
                !activeQuestion &&
                event.key === 'Backspace' &&
                draftInput.length === 0 &&
                selectedRecipientAliases.length > 0 &&
                !event.metaKey &&
                !event.ctrlKey &&
                !event.altKey
              ) {
                event.preventDefault()
                setSelectedRecipientAliases((aliases) => aliases.slice(0, -1))
                return
              }

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
                    recipientMenuItemCount,
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
                  const selection = resolveMentionMenuSelection(
                    recipientActiveIndex,
                    recipientSuggestions.length,
                    recipientSkillSuggestions.length,
                    workspaceFileSuggestions,
                  )
                  if (selection?.kind === 'agent') {
                    const agent = recipientSuggestions[selection.agentIndex]
                    if (agent) selectRecipient(agent)
                  } else if (selection?.kind === 'file') {
                    selectWorkspaceFileFromMention(selection.filePath)
                  } else if (selection?.kind === 'skill') {
                    const skill =
                      recipientSkillSuggestions[selection.skillIndex]
                    if (skill) selectSkillFromMention(skill)
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
                if (event.key === 'ArrowDown' && slashMenuItems.length > 0) {
                  event.preventDefault()
                  setSlashActiveIndex(
                    (index) => (index + 1) % slashMenuItems.length,
                  )
                  return
                }

                if (event.key === 'ArrowUp' && slashMenuItems.length > 0) {
                  event.preventDefault()
                  setSlashActiveIndex(
                    (index) =>
                      (index - 1 + slashMenuItems.length) %
                      slashMenuItems.length,
                  )
                  return
                }

                if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
                  event.preventDefault()
                  const item = slashMenuItems[slashActiveIndex]
                  if (item?.kind === 'command') {
                    void runSlashCommand(item.command)
                  } else if (item?.kind === 'skill') {
                    void selectProviderSkill(item.skill)
                  }
                  return
                }

                if (event.key === 'Escape') {
                  event.preventDefault()
                  setIsSlashMenuDismissed(true)
                  return
                }
              }

              if (event.key === 'Escape' && openComposerMenu) {
                event.preventDefault()
                setOpenComposerMenu(null)
                return
              }

              const hotkey = resolveAgentHotkey(event, {
                isMac: isMac(),
                isMenuOpen:
                  recipientMenuOpen ||
                  slashMenuOpen ||
                  openComposerMenu !== null,
                isTurnRunning: snapshot?.sessionState === 'running',
              })

              if (hotkey === 'interrupt') {
                event.preventDefault()
                const api = getAideApi()
                if (api) {
                  void api.interruptManagedSession(sessionId)
                }
                return
              }

              if (hotkey === 'send-queued-now') {
                event.preventDefault()
                const queuedInput = snapshot?.queuedInputs?.[0]
                if (queuedInput) {
                  void runQueueAction((api) =>
                    api.sendManagedSessionQueuedInputNow(
                      sessionId,
                      queuedInput.id,
                    ),
                  )
                }
                return
              }

              if (hotkey) {
                event.preventDefault()
                setOpenComposerMenu(COMPOSER_MENU_BY_HOTKEY[hotkey])
                return
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
                if (!startedSessionRef.current && !isSelectionHydrated) {
                  return
                }
                void handleSendInput()
              }
            }}
            onPaste={handleComposerPaste}
            onSelect={(event) => {
              setComposerCursorIndex(event.currentTarget.selectionStart)
              setIsRecipientMenuDismissed(false)
            }}
            placeholder={
              activeQuestion
                ? 'Type your own answer, or leave this blank to use the selected option'
                : 'Ask anything · @ for context · / for skills'
            }
            rows={3}
            value={activeQuestion ? primaryAnswer : draftInput}
          />

          <div className="flex min-w-0 flex-wrap items-center gap-0.5 border-t border-border/40 px-2 py-2">
            <ManagedComposerAttachmentButton
              isDisabled={isSubmitting || Boolean(activeQuestion)}
              onPickFiles={() => void handlePickWorkspaceFiles()}
            />
            {isUnifiedPane ? (
              <ModelSelector
                capabilities={capabilities}
                isDisabled={capabilities === null}
                isOpen={openComposerMenu === 'model'}
                model={selectedModel}
                onChange={(mode, modelId) =>
                  void handleModelSwitch(mode, modelId)
                }
                onOpenChange={(isOpen) =>
                  setOpenComposerMenu(isOpen ? 'model' : null)
                }
                provider={selectedProvider}
              />
            ) : (
              <span className="composer-tool">{providerLabel}</span>
            )}
            {snapshot?.pendingProviderSelection ? (
              <span
                className="px-1 text-[10px] text-muted-foreground"
                role="status"
              >
                Next message
              </span>
            ) : null}
            <ConfiguredAgentSettings
              agents={configuredAgents}
              capabilities={capabilities}
              isDisabled={!canChangeProviderSelection || isSubmitting}
              onChange={(agents) => void handleConfiguredAgentsChange(agents)}
            />
            <ReasoningExtrasDropdown
              capabilities={capabilities}
              effort={effort}
              isDisabled={capabilities === null}
              isOpen={openComposerMenu === 'effort'}
              model={selectedModel}
              onEffortChange={(nextEffort) =>
                void handleEffortChange(nextEffort)
              }
              onOpenChange={(isOpen) =>
                setOpenComposerMenu(isOpen ? 'effort' : null)
              }
              onServiceTierChange={(nextServiceTier) =>
                void handleServiceTierChange(nextServiceTier)
              }
              provider={selectedProvider}
              serviceTier={serviceTier}
            />
            {agentMode === 'plan' ? (
              <span className="composer-tool is-pill" data-active="true">
                Plan mode
              </span>
            ) : null}
            <PermissionDropdown
              isOpen={openComposerMenu === 'permission'}
              onOpenChange={(isOpen) =>
                setOpenComposerMenu(isOpen ? 'permission' : null)
              }
              onPermissionModeChange={setPermissionMode}
              permissionMode={permissionMode}
            />
            <span className="min-w-0 flex-1" />
            {snapshot?.usage || snapshot?.usageSummary ? (
              <ContextWindowMeter
                usage={snapshot.usage}
                summary={snapshot.usageSummary}
              />
            ) : null}
            {activeQuestion ? (
              <button
                className="flex shrink-0 items-center gap-1.5 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-30"
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
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-[opacity,background-color] duration-150 hover:bg-primary-focus disabled:opacity-30"
                disabled={
                  isSubmitting ||
                  !isDraftHydrated ||
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
      </div>
    </section>
  )
}

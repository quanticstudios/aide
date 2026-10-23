import { Button } from '@heroui/react'
import {
  ArrowUp,
  Check,
  ChevronDown,
  LoaderCircle,
  Lock,
  LockOpen,
  PenLine,
  RefreshCw,
} from 'lucide-react'
import type {
  ChangeEvent,
  ClipboardEvent,
  Dispatch,
  DragEvent,
  RefObject,
  SetStateAction,
} from 'react'
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { ComposerDefaults } from '../../../shared/composer-defaults'
import type { ManagedSessionAgentConfig } from '../../../shared/conversation-routing'
import {
  extractExplicitRecipientAliases,
  getNextRecipientSuggestionIndex,
  getRecipientSuggestions,
} from '../../../shared/conversation-routing'
import type { AideApi } from '../../../shared/ipc'
import type {
  ManagedSessionAttachment,
  ManagedSessionEffort,
  ManagedSessionInteractionMode,
  ManagedSessionPermissionMode,
  ManagedSessionSnapshot,
} from '../../../shared/managed-session'
import { MANAGED_SESSION_MAX_ATTACHMENTS } from '../../../shared/managed-session'
import type { WorkspaceRecord } from '../../../shared/persistence'
import type {
  ProviderCapabilitiesSnapshot,
  ProviderSelectionInput,
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
import { composerProviderSelectionInput } from '../lib/managed-session-selection'
import {
  extractSlashQuery,
  filterProviderSkills,
  filterSlashCommands,
  SLASH_COMMANDS,
  type SlashCommand,
  type SlashCommandContext,
} from '../lib/managed-slash-commands'
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
import ManagedComposerAttachments, {
  ManagedComposerAttachmentButton,
} from './ManagedComposerAttachments'
import ModelSelector from './ModelSelector'
import ReasoningExtrasDropdown from './ReasoningExtrasDropdown'
import RecipientMentionMenu from './RecipientMentionMenu'

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
          className="absolute bottom-full right-0 z-50 mb-1 min-w-[280px] rounded-lg floating-surface py-1.5"
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

type DraftAnswersState = Record<string, Record<string, string>>

interface ManagedComposerPaneState {
  readonly agentMode: 'build' | 'plan'
  readonly canChangeProviderSelection: boolean
  readonly capabilities: ProviderCapabilitiesSnapshot | null
  readonly composerDefaults: ComposerDefaults | null | undefined
  readonly configuredAgents: readonly ManagedSessionAgentConfig[]
  readonly effort: ManagedSessionEffort | undefined
  readonly handleProviderSelectionChange: (
    newMode: ManagedSessionMode,
    requestedSelection: ProviderSelectionInput,
  ) => Promise<boolean>
  readonly isActive: boolean
  readonly isSelectionHydrated: boolean
  readonly isSubmitting: boolean
  readonly isUnifiedPane: boolean
  readonly paneRef: RefObject<HTMLElement | null>
  readonly permissionMode: ManagedSessionPermissionMode
  readonly providerLabel: string
  readonly selectedModel: string | undefined
  readonly selectedProvider: ManagedSessionMode
  readonly sendPromptText: (
    text: string,
    recipients?: readonly string[],
    promptAttachments?: readonly ManagedSessionAttachment[],
    providerSkill?: ProviderSkill,
  ) => Promise<boolean>
  readonly serviceTier: string | null
  readonly sessionId: string
  readonly setAgentMode: Dispatch<SetStateAction<'build' | 'plan'>>
  readonly setConfiguredAgents: Dispatch<
    SetStateAction<readonly ManagedSessionAgentConfig[]>
  >
  readonly setError: Dispatch<SetStateAction<string | null>>
  readonly setIsSubmitting: Dispatch<SetStateAction<boolean>>
  readonly setPermissionMode: Dispatch<
    SetStateAction<ManagedSessionPermissionMode>
  >
  readonly setSelectionNotice: Dispatch<SetStateAction<string | null>>
  readonly setSnapshot: Dispatch<SetStateAction<ManagedSessionSnapshot | null>>
  readonly snapshot: ManagedSessionSnapshot | null
  readonly startedSessionRef: RefObject<boolean>
  readonly workspace: WorkspaceRecord
}

export function useManagedComposer(pane: ManagedComposerPaneState) {
  const {
    agentMode,
    canChangeProviderSelection,
    composerDefaults,
    configuredAgents,
    effort,
    handleProviderSelectionChange,
    isActive,
    isUnifiedPane,
    paneRef,
    selectedModel,
    selectedProvider,
    sendPromptText,
    serviceTier,
    sessionId,
    setAgentMode,
    setConfiguredAgents,
    setError,
    setIsSubmitting,
    setPermissionMode,
    setSelectionNotice,
    setSnapshot,
    snapshot,
    startedSessionRef,
    workspace,
  } = pane
  const composerStorageKey = `aide:managed-composer:${sessionId}`
  const [draftInput, setDraftInput] = useState('')
  const draftInputRef = useRef('')
  const [attachments, setAttachments] = useState<
    readonly ManagedSessionAttachment[]
  >([])

  useEffect(() => {
    draftInputRef.current = draftInput
  }, [draftInput])
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
  const [slashActiveIndex, setSlashActiveIndex] = useState(0)
  const [isSlashMenuDismissed, setIsSlashMenuDismissed] = useState(false)
  const [openComposerMenu, setOpenComposerMenu] = useState<
    'effort' | 'model' | 'permission' | null
  >(null)
  const slashMenuRef = useRef<HTMLDivElement | null>(null)
  const shouldFocusComposerRef = useRef(false)
  const wasActiveRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

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
  }, [isActive, isDraftHydrated, paneRef])

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
  }, [composerStorageKey, setError])

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
    setError,
  ])

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
    setError,
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
    [attachments, setError],
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
  }, [attachments, workspace.id, setError])

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
    [sessionId, setError, setSnapshot, startedSessionRef, setConfiguredAgents],
  )

  const applyPermissionMode = useCallback(
    async (nextPermissionMode: ManagedSessionPermissionMode) => {
      setPermissionMode(nextPermissionMode)

      if (!startedSessionRef.current) {
        return
      }

      const api = getAideApi()

      if (!api) {
        setError('Managed provider bridge did not load.')
        return
      }

      try {
        const updated = await api.configureManagedSessionPermissionMode(
          sessionId,
          nextPermissionMode,
        )
        setSnapshot(updated)
        setError(null)
      } catch (permissionError) {
        setError(getErrorMessage(permissionError))
      }
    },
    [sessionId, setPermissionMode, setSnapshot, startedSessionRef, setError],
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
    [
      sessionId,
      setSnapshot,
      setError,
      startedSessionRef,
      setIsSubmitting,
      setAgentMode,
    ],
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
      setSelectionNotice,
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
    [draftAnswers, sessionId, snapshot?.pendingUserInputs, setError],
  )

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
    [
      composerCursorIndex,
      draftInput,
      selectedSkill,
      setSelectionNotice,
      setError,
    ],
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
    [attachments, composerCursorIndex, draftInput, setError],
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
        composerProviderSelectionInput(
          composerDefaults ?? null,
          skill.provider,
        ),
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
      composerDefaults,
      handleProviderSelectionChange,
      selectedRecipientAliases.length,
      setSelectionNotice,
      setError,
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

  return {
    ...pane,
    activeAnswers,
    activeQuestion,
    allQuestionsAnswered,
    applyPermissionMode,
    attachments,
    draftInput,
    draftLoadError,
    handleComposerDrop,
    handleComposerPaste,
    handleConfiguredAgentsChange,
    handleDraftAnswerChange,
    handleEffortChange,
    handleModelSwitch,
    handlePickWorkspaceFiles,
    handleResolveUserInput,
    handleSendInput,
    handleServiceTierChange,
    hydrateManagedDraft,
    isDraftHydrated,
    isProviderSkillsLoading,
    isWorkspaceFileSearchLoading,
    loadProviderSkills,
    openComposerMenu,
    primaryAnswer,
    primaryQuestionId,
    providerSkillErrors,
    recipientActiveIndex,
    recipientMenuItemCount,
    recipientMenuOpen,
    recipientSkillSuggestions,
    recipientSuggestions,
    runSlashCommand,
    selectedRecipientAliases,
    selectedSkill,
    selectProviderSkill,
    selectRecipient,
    selectSkillFromMention,
    selectWorkspaceFileFromMention,
    setAttachments,
    setComposerCursorIndex,
    setDraftInput,
    setIsRecipientMenuDismissed,
    setIsSlashMenuDismissed,
    setOpenComposerMenu,
    setRecipientActiveIndex,
    setSelectedRecipientAliases,
    setSelectedSkill,
    setSlashActiveIndex,
    slashActiveIndex,
    slashMenuItems,
    slashMenuOpen,
    slashMenuRef,
    textareaRef,
    workspaceFileSuggestions,
  }
}

type ManagedComposerProps = ReturnType<typeof useManagedComposer>

export default function ManagedComposer({
  activeAnswers,
  activeQuestion,
  agentMode,
  allQuestionsAnswered,
  applyPermissionMode,
  attachments,
  canChangeProviderSelection,
  capabilities,
  configuredAgents,
  draftInput,
  effort,
  handleComposerDrop,
  handleComposerPaste,
  handleConfiguredAgentsChange,
  handleDraftAnswerChange,
  handleEffortChange,
  handleModelSwitch,
  handlePickWorkspaceFiles,
  handleResolveUserInput,
  handleSendInput,
  handleServiceTierChange,
  isDraftHydrated,
  isProviderSkillsLoading,
  isSelectionHydrated,
  isSubmitting,
  isUnifiedPane,
  isWorkspaceFileSearchLoading,
  loadProviderSkills,
  openComposerMenu,
  permissionMode,
  primaryAnswer,
  primaryQuestionId,
  providerLabel,
  providerSkillErrors,
  recipientActiveIndex,
  recipientMenuItemCount,
  recipientMenuOpen,
  recipientSkillSuggestions,
  recipientSuggestions,
  runSlashCommand,
  selectedModel,
  selectedProvider,
  selectedRecipientAliases,
  selectedSkill,
  selectProviderSkill,
  selectRecipient,
  selectSkillFromMention,
  selectWorkspaceFileFromMention,
  serviceTier,
  sessionId,
  setAttachments,
  setComposerCursorIndex,
  setDraftInput,
  setIsRecipientMenuDismissed,
  setIsSlashMenuDismissed,
  setOpenComposerMenu,
  setRecipientActiveIndex,
  setSelectedRecipientAliases,
  setSelectedSkill,
  setSlashActiveIndex,
  slashActiveIndex,
  slashMenuItems,
  slashMenuOpen,
  slashMenuRef,
  snapshot,
  startedSessionRef,
  textareaRef,
  workspaceFileSuggestions,
}: ManagedComposerProps) {
  return (
    <div
      className="relative mx-auto w-full max-w-3xl rounded-2xl bg-surface-2 shadow-[0_1px_2px_rgba(0,0,0,0.5),0_0_0_1px_var(--border)] transition-shadow focus-within:shadow-[0_0_0_1px_var(--primary),0_8px_24px_-12px_rgba(0,0,0,0.8)]"
      data-testid="managed-composer"
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault()
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
          className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-sm rounded-lg floating-surface"
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
                          {isSkill ? `/${item.skill.name}` : item.command.label}
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
                <p className="eyebrow">{question.header ?? 'Input required'}</p>
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
            handleDraftAnswerChange(activeQuestion.id, primaryQuestionId, value)
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
                const skill = recipientSkillSuggestions[selection.skillIndex]
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
                  (index - 1 + slashMenuItems.length) % slashMenuItems.length,
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
              recipientMenuOpen || slashMenuOpen || openComposerMenu !== null,
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
            onChange={(mode, modelId) => void handleModelSwitch(mode, modelId)}
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
          onEffortChange={(nextEffort) => void handleEffortChange(nextEffort)}
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
          onPermissionModeChange={(mode) => void applyPermissionMode(mode)}
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
  )
}

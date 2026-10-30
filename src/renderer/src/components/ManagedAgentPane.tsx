import { ArrowDown, LoaderCircle } from 'lucide-react'
import {
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react'
import type { TurnCheckpointRestoreResult } from '../../../shared/checkpoints'
import type { ComposerDefaults } from '../../../shared/composer-defaults'
import type { ManagedSessionAgentConfig } from '../../../shared/conversation-routing'
import type { AideApi } from '../../../shared/ipc'
import {
  JEV_CONSENT_REQUIRED_MESSAGE,
  JEV_CREDENTIAL_REQUIRED_MESSAGE,
} from '../../../shared/jev'
import type {
  ManagedSessionAttachment,
  ManagedSessionContentItem,
  ManagedSessionContextWindow,
  ManagedSessionEffort,
  ManagedSessionPermissionMode,
  ManagedSessionSnapshot,
  ManagedSessionTurnSummary,
} from '../../../shared/managed-session'
import { readPlanText } from '../../../shared/managed-session'
import type { WorkspaceRecord } from '../../../shared/persistence'
import {
  type ProviderCapabilitiesSnapshot,
  type ProviderSelectionInput,
  resolveProviderSelection,
} from '../../../shared/provider-capabilities'
import type { ProviderSkill } from '../../../shared/provider-skills'
import type { ManagedSessionMode } from '../../../shared/terminal'
import { useTranscriptFollow } from '../hooks/useTranscriptFollow'
import { isEqualValue } from '../lib/deep-equal'
import { requestFrameFlush } from '../lib/frame-flush'
import { saveManagedDraft } from '../lib/managed-draft-storage'
import type { ManagedSessionUpdate } from '../lib/managed-session-events'
import { groupContentByTurn } from '../lib/managed-session-grouping'
import { getSessionTransport } from '../lib/session-transport'
import { buildTranscriptRows } from '../lib/transcript-rows'
import {
  canChangeManagedSessionSelection,
  composerProviderSelectionInput,
  getComposerProviderSelection,
  isProviderSelectionHydrated,
  planManagedSessionSelectionChange,
  providerSelectionHydrationKey,
} from '../lib/managed-session-selection'
import { resolveTerminalLaunchModeForPaneId } from '../lib/pane-catalog'
import { WorkspaceIdContext } from '../lib/workspace-id'
import { WorkspaceVisibilityContext } from '../lib/workspace-visibility'
import { ConversationMinimap, type MinimapAnchor } from './ConversationMinimap'
import ManagedComposer, { useManagedComposer } from './ManagedComposer'
import ManagedEmptyState from './ManagedEmptyState'
import ManagedPendingApprovalPanel from './ManagedPendingApprovalPanel'
import DiffPanel from './DiffPanel'
import ManagedRewindDialog from './ManagedRewindDialog'
import PlanCard from './PlanCard'
import TranscriptList, {
  type TranscriptVirtualizer,
} from './transcript/TranscriptList'
import TurnGroupBlock from './transcript/TurnGroupBlock'

interface ManagedAgentPaneProps {
  readonly isActive: boolean
  readonly onOpenJevSettings: (trigger: HTMLElement) => void
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

function readLegacyComposerDefaults(
  workspaceId: string,
): ComposerDefaults | null {
  const stored = localStorage.getItem(`aide:workspace:${workspaceId}:provider`)
  const provider: ManagedSessionMode = stored === 'codex' ? 'codex' : 'claude'
  const selection = loadPersistedProviderSelection(workspaceId, provider)

  if (!selection.modelId) {
    return null
  }

  return {
    agents: [],
    ...(selection.effort ? { effort: selection.effort } : {}),
    model: selection.modelId,
    permissionMode: 'default',
    provider,
    serviceTier: selection.serviceTier ?? null,
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

interface RecipientTurnSummary extends ManagedSessionTurnSummary {
  readonly recipientAlias?: string
  readonly requestText?: string
}
export default function ManagedAgentPane({
  isActive,
  onOpenJevSettings,
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
    () =>
      terminalMode === 'claude' || terminalMode === 'codex'
        ? terminalMode
        : 'claude',
  )
  const [selectedModel, setSelectedModel] = useState<string | undefined>(
    undefined,
  )
  const [capabilities, setCapabilities] =
    useState<ProviderCapabilitiesSnapshot | null>(null)
  const [selectionNotice, setSelectionNotice] = useState<string | null>(null)
  const [snapshot, setSnapshot] = useState<ManagedSessionSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [configuredAgents, setConfiguredAgents] = useState<
    readonly ManagedSessionAgentConfig[]
  >([])
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [agentMode, setAgentMode] = useState<'build' | 'plan'>('build')
  const [effort, setEffort] = useState<ManagedSessionEffort | undefined>(
    undefined,
  )
  const [contextWindow] = useState<ManagedSessionContextWindow>('200k')
  const [serviceTier, setServiceTier] = useState<string | null>(null)
  const [permissionMode, setPermissionMode] =
    useState<ManagedSessionPermissionMode>('default')
  const [composerDefaults, setComposerDefaults] = useState<
    ComposerDefaults | null | undefined
  >(undefined)
  const [diffPanelTarget, setDiffPanelTarget] = useState<{
    checkpointId: string
    path: string | null
  } | null>(null)
  const [rewindTarget, setRewindTarget] = useState<{
    readonly attachments: readonly ManagedSessionAttachment[]
    readonly checkpointId: string
  } | null>(null)
  const startedSessionRef = useRef(false)
  const configuredAgentsInitializedRef = useRef(false)
  const hydratedProviderSelectionKeyRef = useRef<string | null>(null)
  const snapshotRevisionRef = useRef({ revision: -1, runtimeGeneration: -1 })
  const paneRef = useRef<HTMLElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const virtualizerRef = useRef<TranscriptVirtualizer | null>(null)
  const { pinNextMessage, scrollToLatest, showScrollToLatest } =
    useTranscriptFollow({
      contentRef: transcriptRef,
      pinSelector: '[data-testid="managed-content-user-prompt"]',
      scrollRef,
      sessionId,
    })

  // why: the open measure starts when the pane picks up its session, before the snapshot arrives, so loading it counts.
  useLayoutEffect(() => {
    performance.mark(`transcript-open-start:${sessionId}`)
  }, [sessionId])

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
    const api = getAideApi()

    if (!api || terminalMode === 'shell') {
      setComposerDefaults(null)
      return
    }

    let isStale = false
    const applyStoredDefaults = (stored: ComposerDefaults | null) => {
      if (isStale) {
        return
      }

      if (stored && !startedSessionRef.current) {
        setPermissionMode(stored.permissionMode)
        if (isUnifiedPane) {
          setSelectedProvider(stored.provider)
        }
        if (stored.agents.length > 0) {
          configuredAgentsInitializedRef.current = true
          setConfiguredAgents(stored.agents)
        }
      }

      setComposerDefaults(stored)
    }

    void api
      .getComposerDefaults(workspace.id)
      .then((stored) =>
        applyStoredDefaults(stored ?? readLegacyComposerDefaults(workspace.id)),
      )
      .catch(() => applyStoredDefaults(null))

    return () => {
      isStale = true
    }
  }, [isUnifiedPane, terminalMode, workspace.id])

  useEffect(() => {
    const providerCapabilities = capabilities?.providers[selectedProvider]

    hydratedProviderSelectionKeyRef.current = null

    if (!providerCapabilities || composerDefaults === undefined) {
      return
    }

    if (startedSessionRef.current) {
      hydratedProviderSelectionKeyRef.current = selectionHydrationKey
      return
    }

    const resolution = resolveProviderSelection(
      providerCapabilities,
      composerProviderSelectionInput(composerDefaults, selectedProvider),
    )

    if (!resolution.modelId) {
      setError(resolution.explanation)
      setSelectionNotice(resolution.explanation)
      return
    }

    setSelectedModel(resolution.modelId)
    setEffort(resolution.effort ?? undefined)
    setServiceTier(resolution.serviceTier)
    setSelectionNotice(resolution.explanation)
    hydratedProviderSelectionKeyRef.current = selectionHydrationKey
  }, [capabilities, composerDefaults, selectedProvider, selectionHydrationKey])

  useEffect(() => {
    const api = getAideApi()

    if (
      !api ||
      composerDefaults === undefined ||
      !selectedModel ||
      !isSelectionHydrated
    ) {
      return
    }

    // why: a settings write failure must not stop an available provider from running.
    void api
      .setComposerDefaults(workspace.id, {
        agents: configuredAgents,
        ...(effort ? { effort } : {}),
        model: selectedModel,
        permissionMode,
        provider: selectedProvider,
        serviceTier,
      })
      .catch(() => undefined)
  }, [
    composerDefaults,
    configuredAgents,
    effort,
    isSelectionHydrated,
    permissionMode,
    selectedModel,
    selectedProvider,
    serviceTier,
    workspace.id,
  ])

  useEffect(() => {
    if (!capabilities || configuredAgentsInitializedRef.current) {
      return
    }

    configuredAgentsInitializedRef.current = true
    setConfiguredAgents(getDefaultConfiguredAgents(capabilities))
  }, [capabilities])

  const ensureSession = useCallback(async () => {
    if (startedSessionRef.current) return true

    const transport = getSessionTransport()

    if (!transport || terminalMode === 'shell') {
      setError('Managed provider bridge did not load.')
      return false
    }

    try {
      const snapshots = await transport.getSessions()
      const existing = snapshots[sessionId] ?? null

      if (existing) {
        setSnapshot(existing)
        setAgentMode(existing.interactionMode)
        setPermissionMode(existing.permissionMode)
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

      const created = await transport.start({
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
        permissionMode,
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

  const isWorkspaceVisible = useContext(WorkspaceVisibilityContext)
  const isWorkspaceVisibleRef = useRef(isWorkspaceVisible)
  const deferredUpdatesRef = useRef<ManagedSessionUpdate[]>([])
  const flushDeferredUpdatesRef = useRef<() => void>(() => undefined)
  // why: off-screen workspaces hold their updates, collapsing back-to-back snapshots, and render them once they slide into view.
  useLayoutEffect(() => {
    isWorkspaceVisibleRef.current = isWorkspaceVisible
    if (isWorkspaceVisible) flushDeferredUpdatesRef.current()
  }, [isWorkspaceVisible])

  useEffect(() => {
    const transport = getSessionTransport()

    if (!transport || terminalMode === 'shell') {
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
      setPermissionMode(nextSnapshot.permissionMode)
      if (nextSnapshot.agents) {
        const agents = nextSnapshot.agents
        // why: a fresh array on every snapshot re-runs the effect that writes composer defaults to the database.
        setConfiguredAgents((current) =>
          isEqualValue(current, agents) ? current : agents,
        )
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

    const handleUpdate = (update: ManagedSessionUpdate) => {
      if (update.type === 'removed') {
        snapshotRevisionRef.current = { revision: -1, runtimeGeneration: -1 }
        startedSessionRef.current = false
        setSnapshot(null)
        return
      }

      applySnapshot(update.snapshot)
    }
    const flushDeferredUpdates = () => {
      const deferred = deferredUpdatesRef.current.splice(0)
      for (const update of deferred) handleUpdate(update)
    }
    let cancelFrameFlush = () => {}
    const unsubscribe = transport.subscribeSession(sessionId, (update) => {
      const deferred = deferredUpdatesRef.current
      if (update.type === 'snapshot' && deferred.at(-1)?.type === 'snapshot') {
        deferred[deferred.length - 1] = update
      } else {
        deferred.push(update)
      }
      // why: every visible pane flushes in the same animation frame, so streaming agents cost one React commit per frame instead of one per update.
      if (isWorkspaceVisibleRef.current) {
        cancelFrameFlush = requestFrameFlush(flushDeferredUpdates)
      }
    })
    flushDeferredUpdatesRef.current = flushDeferredUpdates

    void transport.getSessions().then(async (snapshots) => {
      const existing = snapshots[sessionId]
      if (existing) {
        applySnapshot(existing)
        return
      }
      const transcript = await transport.getSavedSession(sessionId)
      if (transcript) {
        setSnapshot(transcript)
      }
    })

    return () => {
      cancelFrameFlush()
      // why: queued updates belong to the old session; the next mount fetches a fresh snapshot that already includes them.
      deferredUpdatesRef.current = []
      flushDeferredUpdatesRef.current = () => undefined
      unsubscribe()
    }
  }, [isUnifiedPane, sessionId, terminalMode])

  const sendPromptText = useCallback(
    async (
      text: string,
      recipients: readonly string[] = [],
      promptAttachments: readonly ManagedSessionAttachment[] = [],
      providerSkill?: ProviderSkill,
    ) => {
      const transport = getSessionTransport()
      const trimmed = text.trim()

      if (!transport || !trimmed) {
        return false
      }

      setIsSubmitting(true)

      try {
        if (!startedSessionRef.current) {
          if (!(await ensureSession())) {
            return false
          }
        }
        const virtualizer = virtualizerRef.current
        if (
          virtualizer &&
          (virtualizer.getVirtualItems().at(-1)?.index ?? -1) <
            virtualizer.options.count - 1
        ) {
          // why: the follow hook pins the newest prompt it finds in the DOM, so the newest rows have to be mounted before the send.
          scrollToLatest()
          await new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve)),
          )
        }
        pinNextMessage()
        await transport.send(
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
    [ensureSession, pinNextMessage, scrollToLatest, sessionId],
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
      const transport = getSessionTransport()
      if (!transport) {
        setError('Managed provider bridge did not load.')
        return
      }
      try {
        await transport.fork(sessionId, responseContentItemId)
      } catch (branchError) {
        setError(getErrorMessage(branchError))
      }
    },
    [sessionId],
  )

  const handleInterruptRecipient = useCallback(
    (recipientAlias: string) => {
      const transport = getSessionTransport()
      if (transport) {
        void transport.interrupt(sessionId, recipientAlias)
      }
    },
    [sessionId],
  )

  const retryTurnRef = useRef(handleRetryTurn)
  useLayoutEffect(() => {
    retryTurnRef.current = handleRetryTurn
  })
  const handleTurnRetry = useCallback(
    (text: string, recipientAlias: string) =>
      void retryTurnRef.current(text, recipientAlias),
    [],
  )
  const handleOpenDiff = useCallback(
    (checkpointId: string, path: string | null) =>
      setDiffPanelTarget({ checkpointId, path }),
    [],
  )
  const handleTurnBranch = useCallback(
    (responseContentItemId: string) =>
      void handleBranchConversation(responseContentItemId),
    [handleBranchConversation],
  )
  const handleTurnEditFromHere = useCallback(
    (checkpointId: string, item: ManagedSessionContentItem) =>
      setRewindTarget({ attachments: item.attachments ?? [], checkpointId }),
    [],
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
        if (newMode !== selectedProvider) {
          setSelectedProvider(newMode)
        }
        setError(null)
        return true
      }

      const transport = getSessionTransport()
      if (!transport) {
        setError('Managed provider bridge did not load.')
        return false
      }

      try {
        const updated = await transport.setModel(sessionId, change.selection)
        setSnapshot(updated)
        const composerSelection = getComposerProviderSelection(updated)
        setSelectedModel(composerSelection.model)
        setEffort(composerSelection.effort)
        setServiceTier(composerSelection.serviceTier ?? null)
        setSelectionNotice(updated.selectionNotice)
        if (isUnifiedPane) {
          setSelectedProvider(composerSelection.mode)
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

  const composer = useManagedComposer({
    agentMode,
    canChangeProviderSelection,
    capabilities,
    composerDefaults,
    configuredAgents,
    effort,
    handleProviderSelectionChange,
    isActive,
    isSelectionHydrated,
    isSubmitting,
    isUnifiedPane,
    paneRef,
    permissionMode,
    providerLabel,
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
  })
  const { draftLoadError, hydrateManagedDraft, setDraftInput, textareaRef } =
    composer
  const handlePickRecentPrompt = useCallback(
    (text: string) => {
      setDraftInput(text)
      requestAnimationFrame(() => {
        textareaRef.current?.focus()
        textareaRef.current?.setSelectionRange(text.length, text.length)
      })
    },
    [setDraftInput, textareaRef],
  )

  const handleResolveApproval = useCallback(
    async (
      requestId: string,
      decision: 'accept' | 'accept-for-session' | 'deny',
    ) => {
      const transport = getSessionTransport()

      if (!transport) {
        return
      }

      try {
        await transport.resolveApproval(sessionId, requestId, decision)
      } catch (resolveError) {
        setError(getErrorMessage(resolveError))
      }
    },
    [sessionId],
  )

  const handleImplementPlanInNewThread = useCallback(
    async (requestId: string) => {
      try {
        await getSessionTransport()?.implementPlanInNewThread(
          sessionId,
          requestId,
        )
      } catch (implementError) {
        setError(getErrorMessage(implementError))
      }
    },
    [sessionId],
  )
  const pendingApproval = snapshot?.pendingApprovals[0]
  const pendingPlan =
    pendingApproval?.requestType === 'plan-approval'
      ? readPlanText(pendingApproval)
      : null

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
  const transcriptRows = useMemo(
    () => buildTranscriptRows(visibleTurnGroups),
    [visibleTurnGroups],
  )
  const minimapAnchors = useMemo(
    () =>
      transcriptRows.flatMap((row, index): MinimapAnchor[] => {
        const reply = row.group.items.reduce(
          (last, item) => (item.kind === 'assistant-text' ? item.text : last),
          '',
        )
        return row.items.flatMap((item) =>
          item.kind === 'user-prompt'
            ? [{ id: item.id, prompt: item.text, reply, row: index }]
            : [],
        )
      }),
    [transcriptRows],
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
      {rewindTarget ? (
        <ManagedRewindDialog
          checkpointId={rewindTarget.checkpointId}
          onClose={() => setRewindTarget(null)}
          onRestored={handleRewindRestored}
          sessionId={sessionId}
        />
      ) : null}

      {error ? (
        <div className="flex items-center gap-3 border-b border-accent-red bg-accent-red-soft px-4 py-2.5 text-sm text-accent-red">
          <span className="flex-1">{error}</span>
          {error === JEV_CONSENT_REQUIRED_MESSAGE ||
          error === JEV_CREDENTIAL_REQUIRED_MESSAGE ? (
            <button
              className="font-semibold underline underline-offset-2"
              onClick={(event) => onOpenJevSettings(event.currentTarget)}
              type="button"
            >
              Open Settings
            </button>
          ) : null}
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
          ref={scrollRef}
        >
          {transcriptRows.length > 0 ? (
            <div ref={transcriptRef}>
              <WorkspaceIdContext value={workspace.id}>
                <TranscriptList
                  renderRow={(row) => {
                    const turn = snapshot?.turns.find(
                      (candidate) => candidate.id === row.group.turnId,
                    ) as RecipientTurnSummary | undefined

                    return (
                      <TurnGroupBlock
                        canBranch={turn?.state === 'completed'}
                        checkpointId={turn?.checkpointId ?? null}
                        isCompleted={turn?.state === 'completed'}
                        isFailed={turn?.state === 'failed'}
                        isRunning={turn?.state === 'running'}
                        onBranch={handleTurnBranch}
                        onEditFromHere={handleTurnEditFromHere}
                        onInterrupt={handleInterruptRecipient}
                        onOpenDiff={handleOpenDiff}
                        onRetry={handleTurnRetry}
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
                        row={row}
                        sessionId={sessionId}
                      />
                    )
                  }}
                  rows={transcriptRows}
                  scrollRef={scrollRef}
                  sessionId={sessionId}
                  virtualizerRef={virtualizerRef}
                />
              </WorkspaceIdContext>

              {snapshot?.sessionState === 'running' &&
              runningTurnId === null ? (
                <div className="mx-auto flex max-w-3xl items-center gap-2 px-1 text-[13px] text-muted-foreground">
                  <LoaderCircle className="size-3.5 animate-spin text-primary-on-dark" />
                  {workingProviderLabel} is working...
                </div>
              ) : null}
            </div>
          ) : (
            <ManagedEmptyState
              model={selectedModel}
              onPickPrompt={handlePickRecentPrompt}
              providerLabel={providerLabel}
              sessionId={sessionId}
              workspace={workspace}
            />
          )}

          {showScrollToLatest ? (
            <button
              className="sticky bottom-2 left-1/2 z-10 -translate-x-1/2 rounded-full border border-border/60 bg-surface-secondary px-3 py-1.5 text-xs text-muted-foreground shadow-md transition-colors hover:bg-surface-tertiary hover:text-foreground"
              onClick={scrollToLatest}
              type="button"
            >
              <ArrowDown className="mr-1 inline size-3" />
              Jump to latest
            </button>
          ) : null}
        </div>

        <ConversationMinimap
          anchors={minimapAnchors}
          key={sessionId}
          scrollRef={scrollRef}
          virtualizerRef={virtualizerRef}
        />

        {diffPanelTarget ? (
          <DiffPanel
            checkpointId={diffPanelTarget.checkpointId}
            initialPath={diffPanelTarget.path}
            key={`${diffPanelTarget.checkpointId}:${diffPanelTarget.path}`}
            onClose={() => setDiffPanelTarget(null)}
            sessionId={sessionId}
            workspaceId={workspace.id}
          />
        ) : null}
      </div>

      <div className="flex flex-col gap-2 px-4 pb-3 pt-2">
        {pendingApproval && pendingPlan ? (
          <PlanCard
            key={pendingApproval.id}
            onImplement={() =>
              void handleResolveApproval(pendingApproval.id, 'accept')
            }
            onImplementInNewThread={() =>
              void handleImplementPlanInNewThread(pendingApproval.id)
            }
            onRefine={() => textareaRef.current?.focus()}
            plan={pendingPlan}
            total={snapshot?.pendingApprovals.length ?? 1}
            workspaceId={workspace.id}
          />
        ) : pendingApproval ? (
          <ManagedPendingApprovalPanel
            approval={pendingApproval}
            key={pendingApproval.id}
            onResolve={(requestId, decision) =>
              void handleResolveApproval(requestId, decision)
            }
            total={snapshot?.pendingApprovals.length ?? 1}
          />
        ) : null}

        <ManagedComposer {...composer} />
      </div>
    </section>
  )
}

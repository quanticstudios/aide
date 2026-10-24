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
import type { WorkspaceRecord } from '../../../shared/persistence'
import {
  type ProviderCapabilitiesSnapshot,
  type ProviderSelectionInput,
  resolveProviderSelection,
} from '../../../shared/provider-capabilities'
import type { ProviderSkill } from '../../../shared/provider-skills'
import type { ManagedSessionMode } from '../../../shared/terminal'
import { isEqualValue } from '../lib/deep-equal'
import { requestFrameFlush } from '../lib/frame-flush'
import { saveManagedDraft } from '../lib/managed-draft-storage'
import {
  type ManagedSessionUpdate,
  subscribeManagedSession,
} from '../lib/managed-session-events'
import { groupContentByTurn } from '../lib/managed-session-grouping'
import {
  canChangeManagedSessionSelection,
  composerProviderSelectionInput,
  getComposerProviderSelection,
  isProviderSelectionHydrated,
  planManagedSessionSelectionChange,
  providerSelectionHydrationKey,
} from '../lib/managed-session-selection'
import { resolveTerminalLaunchModeForPaneId } from '../lib/pane-catalog'
import { WorkspaceVisibilityContext } from '../lib/workspace-visibility'
import { ConversationMinimap } from './ConversationMinimap'
import ManagedComposer, { useManagedComposer } from './ManagedComposer'
import ManagedPendingApprovalPanel from './ManagedPendingApprovalPanel'
import ManagedRewindDialog from './ManagedRewindDialog'
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
    const unsubscribe = subscribeManagedSession(api, sessionId, (update) => {
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

    return () => {
      cancelFrameFlush()
      // why: queued updates belong to the old session; the next mount fetches a fresh snapshot that already includes them.
      deferredUpdatesRef.current = []
      flushDeferredUpdatesRef.current = () => undefined
      unsubscribe()
    }
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

  const retryTurnRef = useRef(handleRetryTurn)
  useLayoutEffect(() => {
    retryTurnRef.current = handleRetryTurn
  })
  const handleTurnRetry = useCallback(
    (text: string, recipientAlias: string) =>
      void retryTurnRef.current(text, recipientAlias),
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
  const { draftLoadError, hydrateManagedDraft } = composer

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
                    onBranch={handleTurnBranch}
                    onEditFromHere={handleTurnEditFromHere}
                    onInterrupt={handleInterruptRecipient}
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

        <ManagedComposer {...composer} />
      </div>
    </section>
  )
}

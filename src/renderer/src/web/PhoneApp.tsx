import { ArrowDown, ArrowLeft, Plus, Send, Square } from 'lucide-react'
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react'
import {
  type ManagedSessionDecision,
  type ManagedSessionSnapshot,
  readPlanText,
} from '../../../shared/managed-session'
import type { SavedTask } from '../../../shared/task-library'
import type { ManagedSessionMode } from '../../../shared/terminal'
import DaemonConnectionBanner from '../components/DaemonConnectionBanner'
import ManagedPendingApprovalPanel from '../components/ManagedPendingApprovalPanel'
import ManagedPendingUserInputPanel from '../components/ManagedPendingUserInputPanel'
import PlanCard from '../components/PlanCard'
import TranscriptList, {
  type TranscriptVirtualizer,
} from '../components/transcript/TranscriptList'
import TurnGroupBlock from '../components/transcript/TurnGroupBlock'
import { useTranscriptFollow } from '../hooks/useTranscriptFollow'
import type { DaemonProject, DaemonTransport } from '../lib/daemon-transport'
import { groupContentByTurn } from '../lib/managed-session-grouping'
import { buildTranscriptRows } from '../lib/transcript-rows'
import { WorkspaceIdContext } from '../lib/workspace-id'
import { parsePhoneRoute, sessionHash } from './routes'

const STATUS_LABELS: Record<SavedTask['status'], string> = {
  approval: 'Needs approval',
  completed: 'Done',
  failed: 'Failed',
  idle: 'Idle',
  input: 'Needs input',
  interrupted: 'Stopped',
  running: 'Working',
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function subscribeHash(listener: () => void): () => void {
  window.addEventListener('hashchange', listener)
  return () => window.removeEventListener('hashchange', listener)
}

/** aide's client for a browser the daemon served it to, laid out for a phone: the session list, one session full screen, a new session. */
export default function PhoneApp({
  transport,
}: {
  readonly transport: DaemonTransport
}) {
  const hash = useSyncExternalStore(
    subscribeHash,
    () => window.location.hash,
    () => '',
  )
  const route = parsePhoneRoute(hash)

  return (
    <div className="phone-app" data-testid="phone-app">
      <DaemonConnectionBanner transport={transport} />
      {route.kind === 'session' ? (
        <SessionView
          key={route.sessionId}
          sessionId={route.sessionId}
          transport={transport}
        />
      ) : route.kind === 'new' ? (
        <NewSession transport={transport} />
      ) : (
        <SessionList transport={transport} />
      )}
    </div>
  )
}

function PhoneHeader({
  action,
  backLabel,
  title,
}: {
  readonly action?: React.ReactNode
  readonly backLabel?: string
  readonly title: string
}) {
  return (
    <header className="phone-header">
      {backLabel ? (
        <a aria-label={backLabel} className="phone-icon-button" href="#/">
          <ArrowLeft className="size-5" />
        </a>
      ) : null}
      <h1 className="min-w-0 flex-1 truncate text-base font-semibold">
        {title}
      </h1>
      {action}
    </header>
  )
}

function SessionList({ transport }: { readonly transport: DaemonTransport }) {
  const [tasks, setTasks] = useState<readonly SavedTask[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const connection = useSyncExternalStore(
    transport.subscribeConnection,
    transport.getConnection,
  )
  const isConnected = connection.status === 'connected'

  useEffect(() => {
    if (!isConnected) return
    let isStale = false
    const load = () =>
      void transport.listSessions().then(
        (snapshot) => {
          if (isStale) return
          setTasks(snapshot.tasks.filter((task) => !task.archived))
          setError(null)
        },
        (loadError) => !isStale && setError(errorMessage(loadError)),
      )
    load()
    const unsubscribe = transport.subscribeSessionList(load)
    return () => {
      isStale = true
      unsubscribe()
    }
  }, [isConnected, transport])

  return (
    <>
      <PhoneHeader
        action={
          <a className="phone-button phone-button-primary" href="#/new">
            <Plus className="size-4" />
            New
          </a>
        }
        title="Sessions"
      />
      <main className="phone-scroll">
        {error ? (
          <p className="px-4 py-3 text-sm text-accent-red" role="alert">
            {error}
          </p>
        ) : null}
        {tasks?.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            No sessions yet. Start one with New.
          </p>
        ) : null}
        <ul aria-label="Sessions" className="divide-y divide-border">
          {tasks?.map((task) => (
            <li key={task.sessionId}>
              <a
                className="flex min-h-14 flex-col justify-center gap-0.5 px-4 py-2 active:bg-surface-secondary"
                data-testid="phone-session"
                href={sessionHash(task.sessionId)}
              >
                <span className="truncate text-[15px] font-medium text-foreground">
                  {task.title || 'Untitled session'}
                </span>
                <span className="flex min-w-0 gap-2 text-[13px] text-muted-foreground">
                  <span
                    className={
                      task.status === 'approval' || task.status === 'input'
                        ? 'shrink-0 font-medium text-accent-peach'
                        : 'shrink-0'
                    }
                  >
                    {STATUS_LABELS[task.status]}
                  </span>
                  <span className="truncate">
                    {[task.projectName, task.branchName]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                </span>
              </a>
            </li>
          ))}
        </ul>
      </main>
    </>
  )
}

function SessionView({
  sessionId,
  transport,
}: {
  readonly sessionId: string
  readonly transport: DaemonTransport
}) {
  const [snapshot, setSnapshot] = useState<ManagedSessionSnapshot | null>(null)
  const [isRemoved, setIsRemoved] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draft, setDraft] = useState('')
  const [answers, setAnswers] = useState<
    Record<string, Record<string, string>>
  >({})
  const scrollRef = useRef<HTMLDivElement>(null)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const virtualizerRef = useRef<TranscriptVirtualizer | null>(null)
  const { pinNextMessage, scrollToLatest, showScrollToLatest } =
    useTranscriptFollow({
      contentRef: transcriptRef,
      pinSelector: '[data-testid="managed-content-user-prompt"]',
      scrollRef,
      sessionId,
    })

  useEffect(
    () =>
      transport.subscribeSession(sessionId, (update) => {
        if (update.type === 'snapshot') setSnapshot(update.snapshot)
        else if (update.type === 'removed') setIsRemoved(true)
      }),
    [sessionId, transport],
  )

  const run = useCallback(async (action: () => Promise<unknown>) => {
    try {
      await action()
      setError(null)
    } catch (actionError) {
      setError(errorMessage(actionError))
    }
  }, [])

  const rows = useMemo(
    () => buildTranscriptRows(groupContentByTurn(snapshot?.content ?? [])),
    [snapshot?.content],
  )
  const isRunning = snapshot?.sessionState === 'running'
  const approval = snapshot?.pendingApprovals[0]
  const plan = approval ? readPlanText(approval) : null
  const inputRequest = snapshot?.pendingUserInputs[0]
  const resolveApproval = (
    requestId: string,
    decision: ManagedSessionDecision,
  ) => void run(() => transport.resolveApproval(sessionId, requestId, decision))

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const text = draft.trim()
    if (!text) return
    pinNextMessage()
    setDraft('')
    void run(() => transport.send(sessionId, text))
  }

  return (
    <>
      <PhoneHeader
        action={
          isRunning ? (
            <button
              className="phone-button"
              onClick={() => void run(() => transport.interrupt(sessionId))}
              type="button"
            >
              <Square className="size-4" />
              Stop
            </button>
          ) : null
        }
        backLabel="Back to sessions"
        title={
          // why: a snapshot has no title; its first prompt is what the list shows.
          snapshot?.content.find((item) => item.kind === 'user-prompt')?.text ||
          'Session'
        }
      />
      <main className="phone-scroll phone-transcript" ref={scrollRef}>
        {isRemoved ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">
            This session is gone. It was archived or removed.
          </p>
        ) : snapshot === null ? (
          <p className="px-4 py-6 text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="px-3 py-3" ref={transcriptRef}>
            <WorkspaceIdContext value={snapshot.workspaceId}>
              <TranscriptList
                renderRow={(row) => {
                  const turn = snapshot.turns.find(
                    (candidate) => candidate.id === row.group.turnId,
                  )
                  return (
                    <TurnGroupBlock
                      canBranch={false}
                      checkpointId={null}
                      isCompleted={turn?.state === 'completed'}
                      isFailed={turn?.state === 'failed'}
                      isRunning={turn?.state === 'running'}
                      onBranch={() => undefined}
                      onEditFromHere={() => undefined}
                      onInterrupt={() =>
                        void run(() => transport.interrupt(sessionId))
                      }
                      onOpenDiff={() => undefined}
                      onRetry={(text) =>
                        void run(() => transport.send(sessionId, text))
                      }
                      providerLabel={
                        snapshot.provider === 'codex' ? 'Codex' : 'Claude'
                      }
                      recipientAlias={null}
                      requestText={null}
                      rewindDisabledReason={null}
                      row={row}
                      sessionId={sessionId}
                      workedForMs={
                        turn?.completedAt
                          ? Date.parse(turn.completedAt) -
                            Date.parse(turn.startedAt)
                          : null
                      }
                    />
                  )
                }}
                rows={rows}
                scrollRef={scrollRef}
                sessionId={sessionId}
                virtualizerRef={virtualizerRef}
              />
            </WorkspaceIdContext>
          </div>
        )}
        {showScrollToLatest ? (
          <button
            className="phone-button sticky bottom-3 left-1/2 -translate-x-1/2 shadow-md"
            onClick={scrollToLatest}
            type="button"
          >
            <ArrowDown className="size-4" />
            Jump to latest
          </button>
        ) : null}
      </main>
      {error ? (
        <p
          className="border-t border-accent-red bg-accent-red-soft px-4 py-2 text-sm text-accent-red"
          role="alert"
        >
          {error}
        </p>
      ) : null}
      {approval ? (
        <section aria-label="Approval required" className="phone-sheet">
          {plan ? (
            <PlanCard
              onImplement={() => resolveApproval(approval.id, 'accept')}
              onImplementInNewThread={() =>
                void run(() =>
                  transport.implementPlanInNewThread(sessionId, approval.id),
                )
              }
              onRefine={() => textareaRef.current?.focus()}
              plan={plan}
              total={snapshot?.pendingApprovals.length ?? 1}
              workspaceId={snapshot?.workspaceId ?? ''}
            />
          ) : (
            <ManagedPendingApprovalPanel
              approval={approval}
              key={approval.id}
              onResolve={resolveApproval}
              total={snapshot?.pendingApprovals.length ?? 1}
            />
          )}
        </section>
      ) : inputRequest ? (
        <section aria-label="Input required" className="phone-sheet">
          <ManagedPendingUserInputPanel
            answers={answers[inputRequest.id] ?? {}}
            onAnswerChange={(questionId, value) =>
              setAnswers((current) => ({
                ...current,
                [inputRequest.id]: {
                  ...current[inputRequest.id],
                  [questionId]: value,
                },
              }))
            }
            onSubmit={(requestId) =>
              void run(() =>
                transport.resolveInput(
                  sessionId,
                  requestId,
                  answers[requestId] ?? {},
                ),
              )
            }
            request={inputRequest}
          />
        </section>
      ) : null}
      <form className="phone-composer" onSubmit={submit}>
        <textarea
          aria-label={isRunning ? 'Steer the agent' : 'Message'}
          className="phone-input min-h-11 flex-1 resize-none"
          onChange={(event) => setDraft(event.target.value)}
          placeholder={isRunning ? 'Steer the agent…' : 'Message…'}
          ref={textareaRef}
          rows={1}
          value={draft}
        />
        <button
          aria-label={isRunning ? 'Steer' : 'Send'}
          className="phone-icon-button phone-button-primary"
          disabled={!draft.trim() || snapshot === null}
          type="submit"
        >
          <Send className="size-5" />
        </button>
      </form>
    </>
  )
}

function NewSession({ transport }: { readonly transport: DaemonTransport }) {
  const [projects, setProjects] = useState<readonly DaemonProject[]>([])
  const [folder, setFolder] = useState('')
  const [provider, setProvider] = useState<ManagedSessionMode>('claude')
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isStarting, setIsStarting] = useState(false)

  const isConnected =
    useSyncExternalStore(transport.subscribeConnection, transport.getConnection)
      .status === 'connected'

  useEffect(() => {
    if (!isConnected) return
    void transport.listProjects().then(
      (found) => {
        setProjects(found)
        setFolder((current) => current || (found[0]?.root ?? ''))
      },
      () => undefined,
    )
  }, [isConnected, transport])

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setIsStarting(true)
    try {
      // pitwall picks the chat's ids; these only satisfy aide's config shape.
      const id = `phone-${Date.now()}`
      const snapshot = await transport.start({
        cwd: folder.trim(),
        mode: provider,
        paneId: id,
        sessionId: id,
        workspaceId: '',
      })
      if (prompt.trim()) await transport.send(snapshot.sessionId, prompt.trim())
      window.location.hash = sessionHash(snapshot.sessionId)
    } catch (startError) {
      setError(errorMessage(startError))
      setIsStarting(false)
    }
  }

  return (
    <>
      <PhoneHeader backLabel="Back to sessions" title="New session" />
      <main className="phone-scroll">
        <form
          className="flex flex-col gap-4 px-4 py-4"
          onSubmit={(event) => void submit(event)}
        >
          <label className="flex flex-col gap-1 text-sm font-medium">
            Folder
            <input
              className="phone-input"
              list="phone-projects"
              onChange={(event) => setFolder(event.target.value)}
              placeholder="/home/me/src/project"
              required
              value={folder}
            />
            <datalist id="phone-projects">
              {projects.map((project) => (
                <option key={project.root} value={project.root}>
                  {project.name}
                </option>
              ))}
            </datalist>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            Agent
            <select
              className="phone-input"
              onChange={(event) =>
                setProvider(event.target.value as ManagedSessionMode)
              }
              value={provider}
            >
              <option value="claude">Claude</option>
              <option value="codex">Codex</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm font-medium">
            First message
            <textarea
              className="phone-input min-h-28"
              onChange={(event) => setPrompt(event.target.value)}
              value={prompt}
            />
          </label>
          {error ? (
            <p className="text-sm text-accent-red" role="alert">
              {error}
            </p>
          ) : null}
          <button
            className="phone-button phone-button-primary"
            disabled={isStarting || !folder.trim()}
            type="submit"
          >
            {isStarting ? 'Starting…' : 'Start session'}
          </button>
        </form>
      </main>
    </>
  )
}

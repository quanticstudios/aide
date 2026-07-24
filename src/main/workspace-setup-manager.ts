import {
  type ChildProcessWithoutNullStreams,
  type SpawnOptions,
  spawn as spawnChild,
} from 'node:child_process'
import { statSync } from 'node:fs'
import { userInfo } from 'node:os'
import path from 'node:path'

import type { ProjectRecord, WorkspaceRecord } from '../shared/persistence'
import type {
  WorkspaceSetupCollectionSnapshot,
  WorkspaceSetupEvent,
  WorkspaceSetupSnapshot,
  WorkspaceSetupStatus,
} from '../shared/workspace-setup'

const MAX_OUTPUT_BYTES = 64 * 1024
const MAX_OUTPUT_LINES = 1_000
const CANCEL_KILL_GRACE_MS = 2_000

export interface WorkspaceSetupStore {
  getProject(projectId: string): ProjectRecord | null
  getWorkspace(workspaceId: string): WorkspaceRecord | null
  getWorkspaceSetupRevision(): number
  getWorkspaceSetupState(workspaceId: string): WorkspaceSetupSnapshot | null
  getWorkspaceSetupStates(): Record<string, WorkspaceSetupSnapshot>
  listWorkspaces(): WorkspaceRecord[]
  reconcileInterruptedWorkspaceSetups(): WorkspaceSetupSnapshot[]
  saveWorkspaceSetupState(
    input: WorkspaceSetupSnapshot,
  ): WorkspaceSetupSnapshot | null
}

export interface WorkspaceSetupManagerOptions {
  readonly getNow?: () => string
  readonly getShell?: () => string | null | undefined
  readonly getUserShell?: () => string | null | undefined
  readonly kill?: (pid: number, signal?: NodeJS.Signals | number) => boolean
  readonly onUpdate: (event: WorkspaceSetupEvent) => void
  readonly platform?: NodeJS.Platform
  readonly setTimeout?: typeof setTimeout
  readonly spawn?: (
    command: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => ChildProcessWithoutNullStreams
  readonly store: WorkspaceSetupStore
}

interface LiveSetup {
  readonly child: ChildProcessWithoutNullStreams
  cancelled: boolean
  readonly completeTermination: () => void
  readonly generation: number
  killTimer: ReturnType<typeof setTimeout> | null
  readonly projectSetupRevision: number
  readonly terminationComplete: Promise<void>
  readonly workspaceId: string
}

type SetupSpawner = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcessWithoutNullStreams

function removeTerminalControls(value: string): string {
  const ansiEscapeSequence =
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape sequences are defined by ESC and BEL control bytes.
    /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/g
  // biome-ignore lint/suspicious/noControlCharactersInRegex: Terminal output must discard C0 control bytes before rendering.
  const c0ControlCharacters = /[\u0000-\u0008\u000b-\u001f\u007f]/g

  return value.replace(ansiEscapeSequence, '').replace(c0ControlCharacters, '')
}

function retainUtf8Tail(value: string, maxBytes: number): string {
  const bytes = Buffer.from(value, 'utf8')

  if (bytes.byteLength <= maxBytes) {
    return value
  }

  let offset = bytes.byteLength - maxBytes
  while (offset < bytes.byteLength && (bytes[offset] & 0xc0) === 0x80) {
    offset += 1
  }

  return bytes.subarray(offset).toString('utf8')
}

function retainLineTail(value: string, maxLines: number): string {
  const lines = value.split('\n')
  return lines.length <= maxLines ? value : lines.slice(-maxLines).join('\n')
}

function isSafeExecutableShell(candidate: string | null | undefined): boolean {
  if (
    !candidate ||
    !path.isAbsolute(candidate) ||
    [...candidate].some((character) => {
      const code = character.codePointAt(0) ?? 0
      return code <= 0x1f || code === 0x7f
    })
  ) {
    return false
  }

  try {
    const stats = statSync(candidate)
    return stats.isFile() && (stats.mode & 0o111) !== 0
  } catch {
    return false
  }
}

export function resolveWorkspaceSetupShell(input: {
  readonly environmentShell?: string | null
  readonly fallbackShells?: readonly string[]
  readonly userShell?: string | null
}): string {
  for (const candidate of [input.environmentShell, input.userShell]) {
    if (isSafeExecutableShell(candidate)) {
      return candidate as string
    }
  }

  for (const candidate of input.fallbackShells ?? ['/bin/bash', '/bin/sh']) {
    if (isSafeExecutableShell(candidate)) {
      return candidate
    }
  }

  // POSIX systems where neither standard shell exists cannot run setup. The
  // caller turns the spawn failure into a safe, retryable setup failure.
  return '/bin/sh'
}

function makeVirtualSnapshot(input: {
  commandRequired: boolean
  projectSetupRevision: number
  workspaceId: string
}): WorkspaceSetupSnapshot {
  const now = new Date(0).toISOString()
  return {
    attempt: 0,
    commandRequired: input.commandRequired,
    endedAt: null,
    errorSummary: null,
    exitCode: null,
    outputByteLength: 0,
    outputLineCount: 0,
    outputTail: '',
    outputTruncated: false,
    projectSetupRevision: input.projectSetupRevision,
    revision: 0,
    signal: null,
    startedAt: null,
    state: input.commandRequired ? 'not-run' : 'not-required',
    updatedAt: now,
    workspaceId: input.workspaceId,
  }
}

function setupFailureMessage(state: WorkspaceSetupStatus): string {
  if (state === 'failed') {
    return 'Project setup failed for this workspace. Retry setup before starting a managed agent.'
  }

  if (state === 'cancelled') {
    return 'Project setup was cancelled for this workspace. Run setup before starting a managed agent.'
  }

  if (state === 'queued' || state === 'running') {
    return 'Project setup is still running for this workspace. Wait for it to finish before starting a managed agent.'
  }

  return 'Project setup is required for this workspace. Run setup before starting a managed agent.'
}

/** The sole owner of project-setup child processes and durable state. */
export class WorkspaceSetupManager {
  private readonly getNow: () => string
  private readonly liveByWorkspace = new Map<string, LiveSetup>()
  private readonly nextGenerationByWorkspace = new Map<string, number>()
  private readonly platform: NodeJS.Platform
  private quiescing = false
  private readonly setTimeout: typeof setTimeout
  private readonly spawn: SetupSpawner

  public constructor(private readonly options: WorkspaceSetupManagerOptions) {
    this.getNow = options.getNow ?? (() => new Date().toISOString())
    this.platform = options.platform ?? process.platform
    this.setTimeout = options.setTimeout ?? setTimeout
    this.spawn =
      options.spawn ??
      ((command, args, spawnOptions) =>
        spawnChild(
          command,
          [...args],
          spawnOptions,
        ) as ChildProcessWithoutNullStreams)

    for (const setup of options.store.reconcileInterruptedWorkspaceSetups()) {
      this.publish(this.normalizeSnapshot(setup))
    }
  }

  public getCollectionSnapshot(): WorkspaceSetupCollectionSnapshot {
    return {
      revision: this.options.store.getWorkspaceSetupRevision(),
      setupsByWorkspace: Object.fromEntries(
        this.options.store
          .listWorkspaces()
          .map((workspace) => [workspace.id, this.getSnapshot(workspace.id)]),
      ),
    }
  }

  public getSnapshot(workspaceId: string): WorkspaceSetupSnapshot {
    const workspace = this.options.store.getWorkspace(workspaceId)
    if (!workspace) {
      throw new Error('Workspace does not exist.')
    }

    const project = this.options.store.getProject(workspace.projectId)
    if (!project) {
      throw new Error('Parent project does not exist.')
    }

    const stored = this.options.store.getWorkspaceSetupState(workspaceId)
    return this.normalizeSnapshot(
      stored ??
        makeVirtualSnapshot({
          commandRequired: project.setupCommand !== null,
          projectSetupRevision: project.worktreeSetupRevision,
          workspaceId,
        }),
      project,
    )
  }

  public assertManagedSessionAllowed(workspaceId: string): void {
    const setup = this.getSnapshot(workspaceId)

    if (!setup.commandRequired || setup.state === 'succeeded') {
      return
    }

    throw new Error(setupFailureMessage(setup.state))
  }

  public getActiveSetupCount(): number {
    return this.liveByWorkspace.size
  }

  /** Blocks new setup child processes while an explicit update restart runs. */
  public beginQuiescing(): () => void {
    this.quiescing = true
    return () => {
      this.quiescing = false
    }
  }

  /** Publishes a command revision change without implicitly starting work. */
  public publishProjectSnapshots(projectId: string): void {
    for (const workspace of this.options.store.listWorkspaces()) {
      if (workspace.projectId === projectId) {
        // Command changes can alter a virtual setup projection even when no
        // setup row exists yet. Persist the projection so every emitted event
        // has a strictly newer collection revision and renderers cannot
        // mistake it for an already-hydrated snapshot.
        this.persist(this.getSnapshot(workspace.id))
      }
    }
  }

  /** Starts a fresh attempt, or returns the live attempt for duplicate calls. */
  public run(workspaceId: string): WorkspaceSetupSnapshot {
    if (this.quiescing) {
      throw new Error('Workspace setup is unavailable while Aide restarts.')
    }
    const existing = this.liveByWorkspace.get(workspaceId)
    if (existing) {
      return this.getSnapshot(workspaceId)
    }

    const workspace = this.options.store.getWorkspace(workspaceId)
    if (!workspace) {
      throw new Error('Workspace does not exist.')
    }
    const project = this.options.store.getProject(workspace.projectId)
    if (!project) {
      throw new Error('Parent project does not exist.')
    }

    const command = project.setupCommand
    if (!command) {
      return this.persist({
        ...this.getSnapshot(workspaceId),
        commandRequired: false,
        projectSetupRevision: project.worktreeSetupRevision,
        state: 'not-required',
      })
    }

    const previous = this.options.store.getWorkspaceSetupState(workspaceId)
    const startedAt = this.getNow()
    this.persist({
      attempt: (previous?.attempt ?? 0) + 1,
      commandRequired: true,
      endedAt: null,
      errorSummary: null,
      exitCode: null,
      outputByteLength: 0,
      outputLineCount: 0,
      outputTail: '',
      outputTruncated: false,
      projectSetupRevision: project.worktreeSetupRevision,
      revision: previous?.revision ?? 0,
      signal: null,
      startedAt,
      state: 'running',
      updatedAt: startedAt,
      workspaceId,
    })

    const generation =
      (this.nextGenerationByWorkspace.get(workspaceId) ?? 0) + 1
    this.nextGenerationByWorkspace.set(workspaceId, generation)
    const shell = resolveWorkspaceSetupShell({
      environmentShell: this.options.getShell?.() ?? process.env.SHELL,
      userShell: this.options.getUserShell?.() ?? this.readUserShell(),
    })

    try {
      const child = this.spawn(shell, ['-lc', command], {
        cwd: workspace.worktreePath,
        detached: this.platform !== 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      })
      let completeTermination: () => void = () => undefined
      const terminationComplete = new Promise<void>((resolve) => {
        completeTermination = resolve
      })
      const live: LiveSetup = {
        child,
        cancelled: false,
        completeTermination,
        generation,
        killTimer: null,
        projectSetupRevision: project.worktreeSetupRevision,
        terminationComplete,
        workspaceId,
      }
      this.liveByWorkspace.set(workspaceId, live)

      child.stdout.setEncoding('utf8')
      child.stderr.setEncoding('utf8')
      child.stdout.on('data', (chunk: string | Buffer) =>
        this.appendOutput(live, String(chunk)),
      )
      child.stderr.on('data', (chunk: string | Buffer) =>
        this.appendOutput(live, String(chunk)),
      )
      child.once('error', () => {
        this.settle(live, {
          errorSummary: 'Setup command could not be started.',
          state: 'failed',
        })
      })
      child.once('close', (exitCode, signal) => {
        if (live.cancelled) {
          this.finishTermination(live)
          return
        }
        this.settle(live, {
          errorSummary:
            exitCode === 0 && !signal ? null : 'Setup command failed.',
          exitCode: typeof exitCode === 'number' ? exitCode : null,
          signal: signal ? String(signal) : null,
          state: exitCode === 0 && !signal ? 'succeeded' : 'failed',
        })
      })
    } catch {
      this.settleWithoutChild(workspaceId, generation, {
        errorSummary: 'Setup command could not be started.',
        state: 'failed',
      })
    }

    // A synchronous spawn failure settles immediately. Always return the
    // authoritative persisted projection so IPC cannot hand a renderer a
    // stale `running` snapshot after the failure event.
    return this.getSnapshot(workspaceId)
  }

  public cancel(workspaceId: string): WorkspaceSetupSnapshot {
    const live = this.liveByWorkspace.get(workspaceId)
    if (!live) {
      return this.getSnapshot(workspaceId)
    }

    if (live.cancelled) {
      return this.getSnapshot(workspaceId)
    }

    live.cancelled = true
    this.terminateProcessTree(live)
    return this.persistTerminal(live, {
      errorSummary: 'Setup was cancelled.',
      state: 'cancelled',
    })
  }

  public async shutdown(): Promise<void> {
    const terminations = [...this.liveByWorkspace.entries()].map(
      ([workspaceId, live]) => {
        this.cancel(workspaceId)
        return live.terminationComplete
      },
    )
    await Promise.all(terminations)
  }

  /**
   * Call before deleting a workspace record. The child must be stopped before
   * the FK cascade removes its state row, otherwise its process would outlive
   * the workspace even though stale output is safely ignored.
   */
  public async cancelForWorkspace(workspaceId: string): Promise<void> {
    const live = this.liveByWorkspace.get(workspaceId)
    if (!live) return
    this.cancel(workspaceId)
    await live.terminationComplete
  }

  private appendOutput(live: LiveSetup, chunk: string): void {
    if (this.liveByWorkspace.get(live.workspaceId) !== live) {
      return
    }

    const current = this.options.store.getWorkspaceSetupState(live.workspaceId)
    if (
      !current ||
      current.projectSetupRevision !== live.projectSetupRevision
    ) {
      return
    }

    const sanitized = removeTerminalControls(chunk)
    if (!sanitized) {
      return
    }

    const combined = `${current.outputTail}${sanitized}`
    const outputTail = retainLineTail(
      retainUtf8Tail(combined, MAX_OUTPUT_BYTES),
      MAX_OUTPUT_LINES,
    )
    const outputByteLength =
      current.outputByteLength + Buffer.byteLength(sanitized)
    const outputLineCount =
      current.outputLineCount + sanitized.split('\n').length - 1

    this.persist({
      ...current,
      commandRequired: true,
      outputByteLength,
      outputLineCount,
      outputTail,
      outputTruncated:
        current.outputTruncated ||
        Buffer.byteLength(combined) > MAX_OUTPUT_BYTES ||
        current.outputLineCount + sanitized.split('\n').length - 1 >
          MAX_OUTPUT_LINES,
      projectSetupRevision: live.projectSetupRevision,
    })
  }

  private normalizeSnapshot(
    stored: WorkspaceSetupSnapshot,
    explicitProject?: ProjectRecord,
  ): WorkspaceSetupSnapshot {
    const workspace = this.options.store.getWorkspace(stored.workspaceId)
    const project =
      explicitProject ??
      (workspace ? this.options.store.getProject(workspace.projectId) : null)

    if (!project || project.setupCommand === null) {
      if (stored.state === 'running' || stored.state === 'queued') {
        return { ...stored, commandRequired: false }
      }
      return {
        ...stored,
        commandRequired: false,
        projectSetupRevision:
          project?.worktreeSetupRevision ?? stored.projectSetupRevision,
        state: 'not-required',
      }
    }

    if (
      stored.projectSetupRevision !== project.worktreeSetupRevision &&
      stored.state !== 'running' &&
      stored.state !== 'queued'
    ) {
      return {
        ...stored,
        commandRequired: true,
        errorSummary:
          'The project setup command changed. Run setup before starting an agent.',
        projectSetupRevision: project.worktreeSetupRevision,
        state: 'not-run',
      }
    }

    return { ...stored, commandRequired: true }
  }

  private persist(input: WorkspaceSetupSnapshot): WorkspaceSetupSnapshot {
    const saved = this.options.store.saveWorkspaceSetupState(input)
    if (!saved) {
      throw new Error('Workspace does not exist.')
    }
    const normalized = this.normalizeSnapshot(saved)
    this.publish(normalized)
    return normalized
  }

  private persistTerminal(
    live: LiveSetup,
    terminal: Pick<WorkspaceSetupSnapshot, 'errorSummary' | 'state'> &
      Partial<Pick<WorkspaceSetupSnapshot, 'exitCode' | 'signal'>>,
  ): WorkspaceSetupSnapshot {
    const current = this.options.store.getWorkspaceSetupState(live.workspaceId)
    if (!current) {
      return this.getSnapshot(live.workspaceId)
    }

    return this.persist({
      ...current,
      endedAt: this.getNow(),
      errorSummary: terminal.errorSummary,
      exitCode: terminal.exitCode ?? current.exitCode,
      signal: terminal.signal ?? current.signal,
      state: terminal.state,
    })
  }

  private settle(
    live: LiveSetup,
    terminal: Pick<WorkspaceSetupSnapshot, 'errorSummary' | 'state'> &
      Partial<Pick<WorkspaceSetupSnapshot, 'exitCode' | 'signal'>>,
  ): void {
    if (this.liveByWorkspace.get(live.workspaceId) !== live) {
      return
    }
    this.liveByWorkspace.delete(live.workspaceId)
    if (live.killTimer) {
      clearTimeout(live.killTimer)
    }
    live.completeTermination()
    this.persistTerminal(live, terminal)
  }

  private settleWithoutChild(
    workspaceId: string,
    generation: number,
    terminal: Pick<WorkspaceSetupSnapshot, 'errorSummary' | 'state'>,
  ): void {
    if ((this.nextGenerationByWorkspace.get(workspaceId) ?? 0) !== generation) {
      return
    }
    const setup = this.options.store.getWorkspaceSetupState(workspaceId)
    if (!setup) return
    this.persist({ ...setup, endedAt: this.getNow(), ...terminal })
  }

  private terminateProcessTree(live: LiveSetup): void {
    const pid = live.child.pid
    if (!pid) {
      this.finishTermination(live)
      return
    }

    const kill = this.options.kill ?? process.kill
    const send = (signal: NodeJS.Signals) => {
      try {
        kill(this.platform !== 'win32' ? -pid : pid, signal)
      } catch {
        try {
          live.child.kill(signal)
        } catch {
          // The process already exited; the persisted cancellation is still true.
        }
      }
    }

    send('SIGTERM')
    live.killTimer = this.setTimeout(() => {
      send('SIGKILL')
      // SIGKILL has been sent to the entire POSIX process group. Do not keep
      // shutdown blocked forever if a platform cannot report a final close.
      this.finishTermination(live)
    }, CANCEL_KILL_GRACE_MS)
  }

  private finishTermination(live: LiveSetup): void {
    if (live.killTimer) {
      clearTimeout(live.killTimer)
      live.killTimer = null
    }
    if (this.liveByWorkspace.get(live.workspaceId) === live) {
      this.liveByWorkspace.delete(live.workspaceId)
    }
    live.completeTermination()
  }

  private publish(setup: WorkspaceSetupSnapshot): void {
    this.options.onUpdate({
      revision: this.options.store.getWorkspaceSetupRevision(),
      setup,
      workspaceId: setup.workspaceId,
    })
  }

  private readUserShell(): string | null {
    try {
      return userInfo().shell || null
    } catch {
      return null
    }
  }
}

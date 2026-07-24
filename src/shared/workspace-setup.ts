export type WorkspaceSetupStatus =
  | 'not-required'
  | 'not-run'
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'

/**
 * This is deliberately a bounded renderer-facing projection. Command text is
 * stored only on ProjectRecord and is never carried in lifecycle events.
 */
export interface WorkspaceSetupSnapshot {
  attempt: number
  commandRequired: boolean
  endedAt: string | null
  errorSummary: string | null
  exitCode: number | null
  outputByteLength: number
  outputLineCount: number
  outputTail: string
  outputTruncated: boolean
  projectSetupRevision: number
  revision: number
  signal: string | null
  startedAt: string | null
  state: WorkspaceSetupStatus
  updatedAt: string
  workspaceId: string
}

export interface WorkspaceSetupCollectionSnapshot {
  activitiesByWorkspace?: never
  revision: number
  setupsByWorkspace: Record<string, WorkspaceSetupSnapshot>
}

export interface WorkspaceSetupEvent {
  revision: number
  setup: WorkspaceSetupSnapshot
  workspaceId: string
}

export const MAX_PROJECT_SETUP_COMMAND_LENGTH = 4_096

/**
 * Commands are intentionally a small, single-line local-shell contract. The
 * app never expands or interpolates them; the user's configured shell does.
 */
export function normalizeProjectSetupCommand(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null
  }

  if (typeof value !== 'string') {
    throw new Error('Project setup command must be text.')
  }

  const command = value.trim()

  if (command.length === 0) {
    return null
  }

  if (command.length > MAX_PROJECT_SETUP_COMMAND_LENGTH) {
    throw new Error(
      `Project setup command must be at most ${MAX_PROJECT_SETUP_COMMAND_LENGTH} characters.`,
    )
  }

  if (
    [...command].some((character) => {
      const code = character.codePointAt(0) ?? 0
      return code <= 0x1f || code === 0x7f
    })
  ) {
    throw new Error('Project setup command cannot contain control characters.')
  }

  return command
}

export function formatWorkspaceSetupStatus(
  setup: WorkspaceSetupSnapshot,
): string {
  if (setup.state === 'not-required') return 'No setup required'
  if (setup.state === 'not-run') return 'Setup required'
  if (setup.state === 'queued') return 'Setup queued'
  if (setup.state === 'running') return 'Setup running'
  if (setup.state === 'succeeded') return 'Setup complete'
  if (setup.state === 'cancelled') return 'Setup cancelled'
  return 'Setup failed'
}

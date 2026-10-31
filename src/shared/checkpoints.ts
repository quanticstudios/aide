import type {
  ManagedSessionConfig,
  ManagedSessionSnapshot,
} from './managed-session'

export type CheckpointRestoreMode =
  | 'code-and-conversation'
  | 'conversation-only'

export interface TurnCheckpointChange {
  path: string
  previousPath?: string
  status:
    | 'added'
    | 'copied'
    | 'deleted'
    | 'modified'
    | 'renamed'
    | 'type-changed'
}

/** One file changed by a turn, with its unified patch and line counts. */
export interface TurnCheckpointDiffFile {
  additions: number
  deletions: number
  patch: string
  path: string
  status: TurnCheckpointChange['status']
}

/** Every file a single turn changed, plus the totals shown on the turn chip. */
export interface TurnCheckpointDiff {
  additions: number
  deletions: number
  files: TurnCheckpointDiffFile[]
}

export interface TurnCheckpointSummary {
  capturedAt: string
  checkpointId: string
  sessionId: string
  workspaceId: string
}

export interface TurnCheckpointPreview {
  changes: TurnCheckpointChange[]
  checkpoint: TurnCheckpointSummary
  createdAt: string
  expiresAt: string
  previewId: string
  restorePatch: string
  sessionRevision: number
  turnChanges: TurnCheckpointChange[] | null
  turnPatch: string | null
}

export interface TurnCheckpointCaptureInput {
  config: ManagedSessionConfig
  editedPrompt: string
  snapshot: ManagedSessionSnapshot
}

export interface TurnCheckpointRestoreSeed {
  checkpointId: string
  config: ManagedSessionConfig
  editedPrompt: string
  mode: CheckpointRestoreMode
  snapshot: ManagedSessionSnapshot
  sourceSessionId: string
}

export interface TurnCheckpointRestoreResult {
  checkpointId: string
  editedPrompt: string
  mode: CheckpointRestoreMode
  sessionId: string
  sourceSessionId: string
}

export interface ManagedTurnCheckpointRecorder {
  captureTurn(input: TurnCheckpointCaptureInput): Promise<TurnCheckpointSummary>
  completeTurn(checkpointId: string): Promise<void>
}

function readPatchPath(section: string): string | null {
  const newPath = /^\+\+\+ (.+)$/m.exec(section)?.[1]
  const oldPath = /^--- (.+)$/m.exec(section)?.[1]
  const chosen =
    newPath && newPath !== '/dev/null'
      ? newPath
      : oldPath && oldPath !== '/dev/null'
        ? oldPath
        : null
  return chosen ? chosen.replace(/^[ab]\//, '') : null
}

function readPatchStatus(section: string): TurnCheckpointChange['status'] {
  if (/^new file mode /m.test(section)) return 'added'
  if (/^deleted file mode /m.test(section)) return 'deleted'
  return 'modified'
}

/** Splits a multi-file turn patch into per-file entries with their line counts. */
export function parseTurnDiffPatch(patch: string): TurnCheckpointDiffFile[] {
  const files: TurnCheckpointDiffFile[] = []

  for (const section of patch.split(/^(?=diff --git )/m)) {
    if (!section.startsWith('diff --git ')) continue
    const filePath = readPatchPath(section)
    if (!filePath) continue

    let additions = 0
    let deletions = 0
    let insideHunk = false
    for (const line of section.split('\n')) {
      if (line.startsWith('@@')) {
        insideHunk = true
        continue
      }
      if (!insideHunk) continue
      if (line.startsWith('+')) additions += 1
      else if (line.startsWith('-')) deletions += 1
    }

    files.push({
      additions,
      deletions,
      patch: section.replace(/\n+$/, ''),
      path: filePath,
      status: readPatchStatus(section),
    })
  }

  return files
}

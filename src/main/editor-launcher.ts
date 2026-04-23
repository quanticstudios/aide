import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface AvailableEditor {
  readonly command: string
  readonly id: string
  readonly label: string
}

interface EditorCandidate {
  readonly command: string
  readonly id: string
  readonly label: string
}

const EDITOR_CANDIDATES: readonly EditorCandidate[] = [
  { command: 'code', id: 'vscode', label: 'VS Code' },
  { command: 'cursor', id: 'cursor', label: 'Cursor' },
  { command: 'zed', id: 'zed', label: 'Zed' },
  { command: 'subl', id: 'sublime', label: 'Sublime Text' },
  { command: 'idea', id: 'idea', label: 'IntelliJ IDEA' },
  { command: 'webstorm', id: 'webstorm', label: 'WebStorm' },
]

let cachedEditors: AvailableEditor[] | null = null

async function hasCommand(command: string): Promise<boolean> {
  try {
    await execFileAsync('command', ['-v', command], { shell: '/bin/sh' })
    return true
  } catch {
    try {
      await execFileAsync('which', [command])
      return true
    } catch {
      return false
    }
  }
}

export async function listAvailableEditors(): Promise<AvailableEditor[]> {
  if (cachedEditors) {
    return cachedEditors
  }

  const checks = await Promise.all(
    EDITOR_CANDIDATES.map(async (candidate) => ({
      candidate,
      available: await hasCommand(candidate.command),
    })),
  )

  cachedEditors = checks
    .filter((entry) => entry.available)
    .map((entry) => ({
      command: entry.candidate.command,
      id: entry.candidate.id,
      label: entry.candidate.label,
    }))

  return cachedEditors
}

export async function launchEditor(
  editorId: string,
  cwd: string,
): Promise<void> {
  const editors = await listAvailableEditors()
  const editor = editors.find((entry) => entry.id === editorId)

  if (!editor) {
    throw new Error(`Editor ${editorId} is not available`)
  }

  if (!cwd) {
    throw new Error('Cannot launch editor without a working directory')
  }

  await execFileAsync(editor.command, [cwd], {
    timeout: 10_000,
  })
}

export function resetEditorCache(): void {
  cachedEditors = null
}

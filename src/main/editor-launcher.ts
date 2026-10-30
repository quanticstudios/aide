import { execFile } from 'node:child_process'
import { access } from 'node:fs/promises'
import path from 'node:path'
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

/** Arguments that open `file` at `line` in `editor`, with `cwd` as the project where the editor takes one. */
export function editorFileArguments(
  editorId: string,
  cwd: string,
  file: string,
  line: number | null,
): string[] {
  if (editorId === 'idea' || editorId === 'webstorm') {
    return line ? [cwd, '--line', String(line), file] : [cwd, file]
  }
  const target = line ? `${file}:${line}` : file
  if (editorId === 'vscode' || editorId === 'cursor') {
    return [cwd, '--goto', target]
  }
  return [cwd, target]
}

/** Opens a workspace-relative file in the first available editor; refuses paths that leave `cwd`. */
export async function openFileInEditor(
  cwd: string,
  relativePath: string,
  line: number | null,
): Promise<void> {
  const file = path.resolve(cwd, relativePath)
  const relative = path.relative(cwd, file)
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error('File is outside the workspace.')
  }
  // why: editors create a missing file instead of failing, so a mistyped path would leave an empty buffer.
  await access(file).catch(() => {
    throw new Error(`File not found: ${relative}`)
  })

  const [editor] = await listAvailableEditors()
  if (!editor) {
    throw new Error('No supported editor is installed.')
  }

  await execFileAsync(
    editor.command,
    editorFileArguments(editor.id, cwd, file, line),
    { timeout: 10_000 },
  )
}

export function resetEditorCache(): void {
  cachedEditors = null
}

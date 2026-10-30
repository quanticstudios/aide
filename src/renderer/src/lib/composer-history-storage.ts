import {
  type ManagedDraft,
  runManagedDraftRequest,
  validateManagedDraft,
} from './managed-draft-storage'

const MAX_PROMPT_HISTORY = 100
const MAX_STASHED_DRAFTS = 20

export interface StashedDraft {
  createdAt: string
  draft: ManagedDraft
  id: string
}

// why: these share the draft store under their own key prefix, so no schema upgrade is needed.
const promptHistoryKey = (workspaceId: string) =>
  `aide:prompt-history:${workspaceId}`
const stashKey = (workspaceId: string) => `aide:composer-stash:${workspaceId}`

export function appendPrompt(
  prompts: readonly string[],
  prompt: string,
): string[] {
  if (!prompt.trim() || prompts.at(-1) === prompt) return [...prompts]
  return [...prompts, prompt].slice(-MAX_PROMPT_HISTORY)
}

export function addStashedDraft(
  stashes: readonly StashedDraft[],
  stash: StashedDraft,
): StashedDraft[] {
  return [stash, ...stashes].slice(0, MAX_STASHED_DRAFTS)
}

/** Steps through prompt history like a shell; index null means the live, empty draft. */
export function stepPromptHistory(
  prompts: readonly string[],
  index: number | null,
  direction: 'newer' | 'older',
): { index: number | null; text: string } | null {
  if (direction === 'older') {
    const next = (index ?? prompts.length) - 1
    const text = prompts[next]
    return text === undefined ? null : { index: next, text }
  }
  if (index === null) return null
  const next = index + 1
  const text = prompts[next]
  return text === undefined ? { index: null, text: '' } : { index: next, text }
}

export async function loadPromptHistory(
  workspaceId: string,
): Promise<string[]> {
  const stored = await runManagedDraftRequest('readonly', (store) =>
    store.get(promptHistoryKey(workspaceId)),
  )
  return Array.isArray(stored)
    ? stored.filter((prompt): prompt is string => typeof prompt === 'string')
    : []
}

export async function recordPrompt(
  workspaceId: string,
  prompt: string,
): Promise<void> {
  const prompts = appendPrompt(await loadPromptHistory(workspaceId), prompt)
  await runManagedDraftRequest('readwrite', (store) =>
    store.put(prompts, promptHistoryKey(workspaceId)),
  )
}

export async function loadStashedDrafts(
  workspaceId: string,
): Promise<StashedDraft[]> {
  const stored = await runManagedDraftRequest('readonly', (store) =>
    store.get(stashKey(workspaceId)),
  )
  if (!Array.isArray(stored)) return []
  return stored.flatMap((entry): StashedDraft[] => {
    try {
      return typeof entry?.id === 'string' &&
        typeof entry.createdAt === 'string'
        ? [
            {
              createdAt: entry.createdAt,
              draft: validateManagedDraft(entry.draft),
              id: entry.id,
            },
          ]
        : []
    } catch {
      return []
    }
  })
}

/** Re-reads before writing so panes sharing a workspace do not drop each other's stashes. */
export async function updateStashedDrafts(
  workspaceId: string,
  update: (stashes: StashedDraft[]) => StashedDraft[],
): Promise<StashedDraft[]> {
  const stashes = update(await loadStashedDrafts(workspaceId))
  await runManagedDraftRequest('readwrite', (store) =>
    store.put(stashes, stashKey(workspaceId)),
  )
  return stashes
}

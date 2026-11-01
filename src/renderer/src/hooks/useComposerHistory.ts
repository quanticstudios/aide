import type { KeyboardEvent } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  addStashedDraft,
  loadPromptHistory,
  loadStashedDrafts,
  recordPrompt,
  type StashedDraft,
  stepPromptHistory,
  updateStashedDrafts,
} from '../lib/composer-history-storage'
import type { ManagedDraft } from '../lib/managed-draft-storage'
import { isMac } from '../lib/platform'

const emptyDraft: ManagedDraft = { attachments: [], text: '' }

function isEmptyDraft(draft: ManagedDraft): boolean {
  return !draft.text && draft.attachments.length === 0 && !draft.selectedSkill
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** Mod+S draft stash and Up/Down prompt recall for one workspace's composer. */
export function useComposerHistory({
  applyDraft,
  draft,
  setError,
  workspaceId,
}: {
  readonly applyDraft: (draft: ManagedDraft) => void
  readonly draft: ManagedDraft
  readonly setError: (error: string | null) => void
  readonly workspaceId: string
}) {
  const [stashes, setStashes] = useState<readonly StashedDraft[]>([])
  const promptsRef = useRef<readonly string[]>([])
  const historyIndexRef = useRef<number | null>(null)

  const refreshStashes = useCallback(() => {
    loadStashedDrafts(workspaceId).then(setStashes, (error) =>
      setError(getErrorMessage(error)),
    )
  }, [setError, workspaceId])

  useEffect(refreshStashes, [refreshStashes])

  const stashDraft = useCallback(() => {
    if (isEmptyDraft(draft)) return
    const stash = {
      createdAt: new Date().toISOString(),
      draft,
      id: crypto.randomUUID(),
    }
    applyDraft(emptyDraft)
    updateStashedDrafts(workspaceId, (current) =>
      addStashedDraft(current, stash),
    ).then(setStashes, (error) => {
      applyDraft(stash.draft)
      setError(`Could not stash the draft: ${getErrorMessage(error)}`)
    })
  }, [applyDraft, draft, setError, workspaceId])

  const restoreStash = useCallback(
    (id: string) => {
      const current = draft
      let restored: StashedDraft | undefined
      updateStashedDrafts(workspaceId, (list) => {
        restored = list.find((stash) => stash.id === id)
        const remaining = list.filter((stash) => stash.id !== id)
        // why: restoring over a typed draft swaps it into the stash instead of dropping it.
        return !restored || isEmptyDraft(current)
          ? remaining
          : addStashedDraft(remaining, {
              createdAt: new Date().toISOString(),
              draft: current,
              id: crypto.randomUUID(),
            })
      }).then(
        (list) => {
          setStashes(list)
          if (restored) applyDraft(restored.draft)
        },
        (error) => setError(getErrorMessage(error)),
      )
    },
    [applyDraft, draft, setError, workspaceId],
  )

  const removeStash = useCallback(
    (id: string) => {
      updateStashedDrafts(workspaceId, (list) =>
        list.filter((stash) => stash.id !== id),
      ).then(setStashes, (error) => setError(getErrorMessage(error)))
    },
    [setError, workspaceId],
  )

  const recordSentPrompt = useCallback(
    (prompt: string) => {
      historyIndexRef.current = null
      void recordPrompt(workspaceId, prompt).catch(() => undefined)
    },
    [workspaceId],
  )

  /** Returns true when the key was a stash or history key and has been handled. */
  const handleHistoryKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): boolean => {
      const isModS = isMac()
        ? event.metaKey && !event.ctrlKey
        : event.ctrlKey && !event.metaKey
      if (
        isModS &&
        !event.altKey &&
        !event.shiftKey &&
        event.key.toLowerCase() === 's'
      ) {
        event.preventDefault()
        stashDraft()
        return true
      }
      // invariant: modified arrows belong to App-level workspace and pane navigation.
      if (
        (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      ) {
        return false
      }
      const index = historyIndexRef.current
      const isBrowsing =
        index !== null && draft.text === promptsRef.current[index]
      if (!isBrowsing) {
        if (draft.text !== '' || event.key === 'ArrowDown') return false
        historyIndexRef.current = null
      }
      event.preventDefault()
      const step = (prompts: readonly string[]) => {
        const next = stepPromptHistory(
          prompts,
          historyIndexRef.current,
          event.key === 'ArrowUp' ? 'older' : 'newer',
        )
        if (!next) return
        historyIndexRef.current = next.index
        applyDraft({ ...draft, text: next.text })
      }
      if (isBrowsing) {
        step(promptsRef.current)
        return true
      }
      // why: reload on entry so prompts sent from another pane of this workspace show up.
      loadPromptHistory(workspaceId).then(
        (prompts) => {
          promptsRef.current = prompts
          step(prompts)
        },
        (error) => setError(getErrorMessage(error)),
      )
      return true
    },
    [applyDraft, draft, setError, stashDraft, workspaceId],
  )

  return {
    handleHistoryKeyDown,
    recordSentPrompt,
    refreshStashes,
    removeStash,
    restoreStash,
    stashes,
  }
}

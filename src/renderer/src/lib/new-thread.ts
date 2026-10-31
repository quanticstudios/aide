import { createContext } from 'react'

/** Opens an agent pane in workspace `workspaceId` that sends `prompt` once its session starts; null where no workspace hosts the pane. */
export const NewThreadContext = createContext<
  ((workspaceId: string, prompt: string) => void) | null
>(null)

const pendingPrompts = new Map<string, string>()

export function queueThreadPrompt(paneId: string, prompt: string): void {
  pendingPrompts.set(paneId, prompt)
}

/** Returns and forgets the prompt queued for an agent pane before it mounted. */
export function takeThreadPrompt(paneId: string): string | undefined {
  const prompt = pendingPrompts.get(paneId)
  pendingPrompts.delete(paneId)
  return prompt
}

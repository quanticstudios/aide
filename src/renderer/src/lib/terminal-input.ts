import { createContext } from 'react'

/** Opens a terminal pane in the active workspace with `command` typed at the prompt; null where no workspace hosts the transcript. */
export const RunInTerminalContext = createContext<
  ((command: string) => void) | null
>(null)

const pendingInput = new Map<string, string>()

/**
 * Returns the text "Run in terminal" may type for a code block, or null when it cannot be typed without running something.
 * @remarks Any control character, newline and carriage return included, would act as a key press, so blocks with one get no action.
 */
export function terminalCommand(code: string): string | null {
  const command = code.trim()
  return command && !/\p{Cc}/u.test(command) ? command : null
}

export function queueTerminalInput(paneId: string, input: string): void {
  pendingInput.set(paneId, input)
}

/** Returns and forgets the input queued for a terminal pane before its shell started. */
export function takeTerminalInput(paneId: string): string | undefined {
  const input = pendingInput.get(paneId)
  pendingInput.delete(paneId)
  return input
}

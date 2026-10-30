import { Button } from '@heroui/react'
import {
  ArrowDown,
  ArrowUp,
  CornerDownRight,
  Pencil,
  Play,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'

import type {
  ManagedSessionQueueAction,
  ManagedSessionQueuedInput,
} from '../../../shared/managed-session'
import { getSessionTransport } from '../lib/session-transport'

interface ManagedQueuedMessagesProps {
  readonly isPaused: boolean
  readonly queuedInputs: readonly ManagedSessionQueuedInput[]
  readonly sessionId: string
}

/** Messages waiting for the running turn to end, above the composer. */
export default function ManagedQueuedMessages({
  isPaused,
  queuedInputs,
  sessionId,
}: ManagedQueuedMessagesProps) {
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)

  const run = async (action: ManagedSessionQueueAction) => {
    const transport = getSessionTransport()
    if (!transport) return
    try {
      await transport.updateQueue(sessionId, action)
      setError(null)
    } catch (actionError) {
      setError(
        actionError instanceof Error
          ? actionError.message
          : String(actionError),
      )
    }
  }

  return (
    <section
      aria-label="Queued messages"
      className="mx-auto w-full max-w-3xl rounded-lg border border-border bg-surface-2 px-3 py-2"
      data-testid="managed-queued-messages"
    >
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">
          {queuedInputs.length} queued
        </span>
        <span className="min-w-0 flex-1 truncate">
          {isPaused
            ? 'Paused. Resume to send them as turns end.'
            : 'Each one sends when the current turn ends.'}
        </span>
        {isPaused ? (
          <Button
            onPress={() => void run({ type: 'resume' })}
            size="sm"
            variant="secondary"
          >
            <Play className="size-3.5" />
            Resume
          </Button>
        ) : null}
      </div>
      {error ? (
        <p className="mt-1 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <ol className="mt-1 flex flex-col gap-1">
        {queuedInputs.map((input, index) => (
          <li
            className="flex items-start gap-1 rounded-md bg-surface-3 px-2 py-1 text-[13px]"
            data-testid="managed-queued-message"
            key={input.id}
          >
            {editing?.id === input.id ? (
              <form
                className="flex min-w-0 flex-1 flex-col gap-1"
                onSubmit={(event) => {
                  event.preventDefault()
                  if (!editing.text.trim()) return
                  void run({ type: 'edit', id: input.id, text: editing.text })
                  setEditing(null)
                }}
              >
                <textarea
                  aria-label="Edit queued message"
                  className="w-full resize-y rounded border border-border bg-surface-2 px-2 py-1 text-[13px] outline-none focus:border-primary"
                  onChange={(event) =>
                    setEditing({ id: input.id, text: event.target.value })
                  }
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setEditing(null)
                    } else if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault()
                      event.currentTarget.form?.requestSubmit()
                    }
                  }}
                  ref={(element) => element?.focus()}
                  rows={2}
                  value={editing.text}
                />
                <div className="flex gap-1">
                  <Button size="sm" type="submit" variant="primary">
                    Save
                  </Button>
                  <Button
                    onPress={() => setEditing(null)}
                    size="sm"
                    variant="ghost"
                  >
                    Cancel
                  </Button>
                </div>
              </form>
            ) : (
              <>
                <span className="min-w-0 flex-1 py-1">
                  <span className="line-clamp-2 whitespace-pre-wrap break-words">
                    {input.text}
                  </span>
                  {input.lastError ? (
                    <span className="block text-xs text-danger">
                      {input.lastError}
                    </span>
                  ) : null}
                </span>
                <Button
                  aria-label="Move up"
                  isDisabled={index === 0}
                  isIconOnly
                  onPress={() =>
                    void run({ type: 'move', id: input.id, index: index - 1 })
                  }
                  size="sm"
                  variant="ghost"
                >
                  <ArrowUp className="size-3.5" />
                </Button>
                <Button
                  aria-label="Move down"
                  isDisabled={index === queuedInputs.length - 1}
                  isIconOnly
                  onPress={() =>
                    void run({ type: 'move', id: input.id, index: index + 1 })
                  }
                  size="sm"
                  variant="ghost"
                >
                  <ArrowDown className="size-3.5" />
                </Button>
                <Button
                  aria-label="Edit"
                  isIconOnly
                  onPress={() => setEditing({ id: input.id, text: input.text })}
                  size="sm"
                  variant="ghost"
                >
                  <Pencil className="size-3.5" />
                </Button>
                <Button
                  aria-label="Steer now"
                  isIconOnly
                  onPress={() => void run({ type: 'steer', id: input.id })}
                  size="sm"
                  variant="ghost"
                >
                  <CornerDownRight className="size-3.5" />
                </Button>
                <Button
                  aria-label="Delete"
                  isIconOnly
                  onPress={() => void run({ type: 'remove', id: input.id })}
                  size="sm"
                  variant="ghost"
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </>
            )}
          </li>
        ))}
      </ol>
    </section>
  )
}

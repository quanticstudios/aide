import { Button, Modal } from '@heroui/react'
import { useEffect, useRef, useState } from 'react'

import type {
  CheckpointRestoreMode,
  TurnCheckpointChange,
  TurnCheckpointPreview,
  TurnCheckpointRestoreResult,
} from '../../../shared/checkpoints'
import { getSessionTransport } from '../lib/session-transport'
import { cn } from '../lib/utils'

interface ManagedRewindDialogProps {
  readonly checkpointId: string
  readonly onClose: () => void
  readonly onRestored: (result: TurnCheckpointRestoreResult) => Promise<void>
  readonly sessionId: string
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Checkpoint restore failed.'
}

export function getRewindChangeLabel(change: TurnCheckpointChange): string {
  if (change.status === 'renamed' || change.status === 'copied') {
    return `${change.previousPath} → ${change.path}`
  }
  return change.path
}

function RewindChangeList({
  changes,
  isLater,
}: {
  readonly changes: readonly TurnCheckpointChange[]
  readonly isLater?: (change: TurnCheckpointChange) => boolean
}) {
  return (
    <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border bg-surface-2 p-3 font-mono text-xs">
      {changes.map((change) => (
        <li
          className="flex min-w-0 items-baseline gap-2"
          key={`${change.status}:${change.previousPath ?? ''}:${change.path}`}
        >
          <span className="w-16 shrink-0 uppercase text-muted-foreground">
            {change.status}
          </span>
          <span
            className="min-w-0 truncate"
            title={getRewindChangeLabel(change)}
          >
            {getRewindChangeLabel(change)}
          </span>
          {isLater?.(change) ? (
            <span className="ml-auto shrink-0 rounded bg-accent-yellow-soft px-1.5 font-sans text-[11px] text-accent-yellow">
              After this message
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  )
}

export function RewindRestoreContent({
  error,
  mode,
  onModeChange,
  preview,
}: {
  readonly error: string | null
  readonly mode: CheckpointRestoreMode
  readonly onModeChange: (mode: CheckpointRestoreMode) => void
  readonly preview: TurnCheckpointPreview | null
}) {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Aide reopens the conversation from before this message and returns the
        prompt to the composer.
      </p>

      <fieldset className="space-y-2">
        <label
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
            mode === 'conversation-only'
              ? 'border-primary bg-primary/5'
              : 'border-border hover:bg-surface-2',
          )}
        >
          <input
            checked={mode === 'conversation-only'}
            className="mt-1"
            name="rewind-restore-mode"
            onChange={() => onModeChange('conversation-only')}
            type="radio"
          />
          <span>
            <span className="block text-sm font-medium text-foreground">
              Keep file changes
            </span>
            <span className="block text-xs text-muted-foreground">
              Every workspace file stays as it is now.
            </span>
          </span>
        </label>
        <label
          className={cn(
            'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors',
            mode === 'code-and-conversation'
              ? 'border-primary bg-primary/5'
              : 'border-border hover:bg-surface-2',
          )}
        >
          <input
            checked={mode === 'code-and-conversation'}
            className="mt-1"
            name="rewind-restore-mode"
            onChange={() => onModeChange('code-and-conversation')}
            type="radio"
          />
          <span>
            <span className="block text-sm font-medium text-foreground">
              Revert files too
            </span>
            <span className="block text-xs text-muted-foreground">
              Restore the listed files to their contents before this message.
            </span>
          </span>
        </label>
      </fieldset>

      <section aria-label="Previewed file changes">
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          Files a revert would change
        </h3>
        {preview ? (
          preview.changes.length ? (
            <RewindChangeList
              changes={preview.changes}
              isLater={(change) =>
                preview.keptChanges === null &&
                preview.turnChanges !== null &&
                !preview.turnChanges.some(
                  (turnChange) => turnChange.path === change.path,
                )
              }
            />
          ) : (
            <p className="rounded-lg border border-border bg-surface-2 p-3 text-sm text-muted-foreground">
              Reverting files would not change the workspace.
            </p>
          )
        ) : (
          <p className="rounded-lg border border-border bg-surface-2 p-3 text-sm text-muted-foreground">
            Loading the preview…
          </p>
        )}
        {preview?.keptChanges === null && preview.changes.length ? (
          <p className="mt-2 text-xs text-muted-foreground">
            This pitwall reverts every listed file, edits made after this
            message included.
          </p>
        ) : null}
      </section>

      {preview?.keptChanges?.length ? (
        <section aria-label="Files edited after this message">
          <h3 className="mb-2 text-sm font-semibold text-foreground">
            Edited after this message, kept as they are
          </h3>
          <RewindChangeList changes={preview.keptChanges} />
        </section>
      ) : null}

      {error ? (
        <p className="text-sm text-accent-red" role="alert">
          {error}
        </p>
      ) : null}
    </>
  )
}

/** Confirms rewinding a conversation to the checkpoint captured before one user message. */
export default function ManagedRewindDialog({
  checkpointId,
  onClose,
  onRestored,
  sessionId,
}: ManagedRewindDialogProps) {
  const [preview, setPreview] = useState<TurnCheckpointPreview | null>(null)
  const [mode, setMode] = useState<CheckpointRestoreMode>('conversation-only')
  const [error, setError] = useState<string | null>(null)
  const [isRestoring, setIsRestoring] = useState(false)
  const restoredResultRef = useRef<TurnCheckpointRestoreResult | null>(null)

  useEffect(() => {
    let isCurrent = true
    const transport = getSessionTransport()
    if (!transport) return
    transport
      .previewRewind(sessionId, checkpointId)
      .then((nextPreview) => {
        if (isCurrent) setPreview(nextPreview)
      })
      .catch((previewError: unknown) => {
        if (isCurrent) setError(getErrorMessage(previewError))
      })
    return () => {
      isCurrent = false
    }
  }, [checkpointId, sessionId])

  async function restore(): Promise<void> {
    const transport = getSessionTransport()
    if (!transport || !preview) return
    setError(null)
    setIsRestoring(true)
    try {
      // invariant: one preview restores at most once, so a retry reuses its result.
      const result =
        restoredResultRef.current ??
        (await transport.rewind(preview.previewId, mode))
      restoredResultRef.current = result
      await onRestored(result)
      onClose()
    } catch (restoreError) {
      setError(getErrorMessage(restoreError))
    } finally {
      setIsRestoring(false)
    }
  }

  return (
    <Modal>
      <Modal.Backdrop
        isDismissable={!isRestoring}
        isOpen
        onOpenChange={(nextIsOpen) => {
          if (!nextIsOpen && !isRestoring) onClose()
        }}
        variant="opaque"
      >
        <Modal.Container placement="center" size="lg">
          <Modal.Dialog className="rounded-xl border border-border bg-surface text-foreground shadow-[0_20px_60px_color-mix(in_srgb,var(--shadow-color)_40%,transparent)]">
            <Modal.Header>
              <Modal.Heading>Edit from here</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-4 text-foreground">
              <RewindRestoreContent
                error={error}
                mode={mode}
                onModeChange={setMode}
                preview={preview}
              />
            </Modal.Body>
            <Modal.Footer>
              <Button
                isDisabled={isRestoring}
                onPress={onClose}
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                isDisabled={isRestoring || !preview}
                onPress={() => void restore()}
                variant="primary"
              >
                {isRestoring ? 'Rewinding…' : 'Rewind conversation'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

import { Button, Modal } from '@heroui/react'
import { History } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import type {
  CheckpointRestoreMode,
  TurnCheckpointChange,
  TurnCheckpointPreview,
  TurnCheckpointRestoreResult,
} from '../../../shared/checkpoints'
import type { AideApi } from '../../../shared/ipc'

interface ManagedCheckpointControlsProps {
  readonly checkpointId: string
  readonly isDisabled: boolean
  readonly onRestored: (result: TurnCheckpointRestoreResult) => void
  readonly sessionId: string
}

interface CheckpointRestoreDialogProps {
  readonly error: string | null
  readonly isOpen: boolean
  readonly isRestoring: boolean
  readonly mode: CheckpointRestoreMode
  readonly onModeChange: (mode: CheckpointRestoreMode) => void
  readonly onOpenChange: (isOpen: boolean) => void
  readonly onRestore: () => void
  readonly preview: TurnCheckpointPreview | null
}

function getAideApi(): AideApi | null {
  return typeof window === 'undefined' ? null : window.aide
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Checkpoint restore failed.'
}

export function getCheckpointChangeLabel(change: TurnCheckpointChange): string {
  if (change.status === 'renamed' || change.status === 'copied') {
    return `${change.previousPath} → ${change.path}`
  }
  return change.path
}

export function CheckpointRestoreContent({
  error,
  mode,
  onModeChange,
  preview,
}: Pick<
  CheckpointRestoreDialogProps,
  'error' | 'mode' | 'onModeChange' | 'preview'
>) {
  return (
    <>
      <p className="text-sm text-muted-foreground">
        Aide creates a new conversation and returns the saved prompt to the
        composer. The current conversation remains unchanged.
      </p>

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold text-foreground">
          Restore
        </legend>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
          <input
            checked={mode === 'conversation-only'}
            className="mt-1"
            name="checkpoint-restore-mode"
            onChange={() => onModeChange('conversation-only')}
            type="radio"
          />
          <span>
            <span className="block text-sm font-medium text-foreground">
              Conversation only
            </span>
            <span className="block text-xs text-muted-foreground">
              Keep every workspace file as it is now.
            </span>
          </span>
        </label>
        <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-border p-3">
          <input
            checked={mode === 'code-and-conversation'}
            className="mt-1"
            name="checkpoint-restore-mode"
            onChange={() => onModeChange('code-and-conversation')}
            type="radio"
          />
          <span>
            <span className="block text-sm font-medium text-foreground">
              Code and conversation
            </span>
            <span className="block text-xs text-muted-foreground">
              Restore the previewed files to their pre-turn contents.
            </span>
          </span>
        </label>
      </fieldset>

      <section aria-label="Previewed file changes">
        <h3 className="mb-2 text-sm font-semibold text-foreground">
          File preview
        </h3>
        {preview?.changes.length ? (
          <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-border bg-surface-secondary p-3 font-mono text-xs">
            {preview.changes.map((change) => (
              <li
                key={`${change.status}:${change.previousPath ?? ''}:${change.path}`}
              >
                <span className="mr-2 uppercase text-muted-foreground">
                  {change.status}
                </span>
                {getCheckpointChangeLabel(change)}
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-lg border border-border bg-surface-secondary p-3 text-sm text-muted-foreground">
            This turn has no file changes.
          </p>
        )}
      </section>

      {error ? (
        <p className="text-sm text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </>
  )
}

export function CheckpointRestoreDialog({
  error,
  isOpen,
  isRestoring,
  mode,
  onModeChange,
  onOpenChange,
  onRestore,
  preview,
}: CheckpointRestoreDialogProps) {
  return (
    <Modal>
      <Modal.Backdrop
        isDismissable={!isRestoring}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        variant="opaque"
      >
        <Modal.Container placement="center" size="lg">
          <Modal.Dialog className="rounded-xl border border-border bg-surface shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
            <Modal.Header>
              <Modal.Heading>Restore checkpoint</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="gap-4">
              <CheckpointRestoreContent
                error={error}
                mode={mode}
                onModeChange={onModeChange}
                preview={preview}
              />
            </Modal.Body>
            <Modal.Footer>
              <Button
                isDisabled={isRestoring}
                onPress={() => onOpenChange(false)}
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                isDisabled={isRestoring || !preview}
                onPress={onRestore}
                variant="primary"
              >
                {isRestoring ? 'Restoring…' : 'Restore to new conversation'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

export default function ManagedCheckpointControls({
  checkpointId,
  isDisabled,
  onRestored,
  sessionId,
}: ManagedCheckpointControlsProps) {
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const [preview, setPreview] = useState<TurnCheckpointPreview | null>(null)
  const [mode, setMode] = useState<CheckpointRestoreMode>('conversation-only')
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const [isRestoring, setIsRestoring] = useState(false)

  useEffect(() => {
    if (!isOpen && preview) triggerRef.current?.focus()
  }, [isOpen, preview])

  async function openPreview(): Promise<void> {
    const api = getAideApi()
    if (!api) return
    setError(null)
    setIsLoading(true)
    try {
      const nextPreview = await api.previewTurnCheckpointRestore(
        sessionId,
        checkpointId,
      )
      setPreview(nextPreview)
      setMode('conversation-only')
      setIsOpen(true)
    } catch (nextError) {
      setError(getErrorMessage(nextError))
    } finally {
      setIsLoading(false)
    }
  }

  async function restore(): Promise<void> {
    const api = getAideApi()
    if (!api || !preview) return
    setError(null)
    setIsRestoring(true)
    try {
      const result = await api.restoreTurnCheckpoint(preview.previewId, mode)
      setIsOpen(false)
      onRestored(result)
    } catch (nextError) {
      setError(getErrorMessage(nextError))
    } finally {
      setIsRestoring(false)
    }
  }

  return (
    <>
      <Button
        ref={triggerRef}
        isDisabled={isDisabled || isLoading}
        onPress={() => void openPreview()}
        size="sm"
        variant="ghost"
      >
        <History className="size-3.5" />
        {isLoading ? 'Preparing preview…' : 'Restore checkpoint'}
      </Button>
      {!isOpen && error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
      <CheckpointRestoreDialog
        error={error}
        isOpen={isOpen}
        isRestoring={isRestoring}
        mode={mode}
        onModeChange={setMode}
        onOpenChange={(nextIsOpen) => {
          if (!isRestoring) setIsOpen(nextIsOpen)
        }}
        onRestore={() => void restore()}
        preview={preview}
      />
    </>
  )
}

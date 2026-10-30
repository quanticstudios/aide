import { Button, Modal } from '@heroui/react'
import { useState } from 'react'

import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'
import { isLinkedWorktree } from '../../../shared/persistence'

interface DeleteWorkspaceModalProps {
  readonly onClose: () => void
  readonly project: ProjectRecord
  readonly workspace: WorkspaceRecord
}

export default function DeleteWorkspaceModal({
  onClose,
  project,
  workspace,
}: DeleteWorkspaceModalProps) {
  const hasWorktree = isLinkedWorktree(project, workspace)
  const [removeWorktree, setRemoveWorktree] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  async function confirm(): Promise<void> {
    setIsDeleting(true)
    try {
      await window.aide.deleteWorkspace(workspace.id, removeWorktree)
      onClose()
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : 'Workspace deletion failed.',
      )
      setIsDeleting(false)
    }
  }

  return (
    <Modal>
      <Modal.Backdrop
        isDismissable={!isDeleting}
        isOpen
        onOpenChange={(isOpen) => {
          if (!isOpen) onClose()
        }}
        variant="opaque"
      >
        <Modal.Container placement="center" size="md">
          <Modal.Dialog className="rounded-xl border border-border bg-surface shadow-[0_20px_60px_color-mix(in_srgb,var(--shadow-color)_40%,transparent)]">
            <Modal.Header>
              <Modal.Heading>Delete "{workspace.name}"?</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="flex flex-col gap-3 text-sm">
              <p className="text-muted-foreground">
                Stops its terminals and agents and removes it from Aide, along
                with its conversations.
              </p>
              {hasWorktree ? (
                <label className="flex items-start gap-2 text-foreground">
                  <input
                    checked={removeWorktree}
                    className="mt-0.5"
                    disabled={isDeleting}
                    onChange={(event) =>
                      setRemoveWorktree(event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span>
                    Also delete the worktree folder
                    <span className="block break-all font-mono text-xs text-muted-foreground">
                      {workspace.worktreePath}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      Git refuses if it has uncommitted files. The branch{' '}
                      <span className="font-mono">{workspace.branchName}</span>{' '}
                      is kept.
                    </span>
                  </span>
                </label>
              ) : null}
              {error ? <p className="text-accent-red">{error}</p> : null}
            </Modal.Body>
            <Modal.Footer>
              <Button
                isDisabled={isDeleting}
                onPress={onClose}
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                isDisabled={isDeleting}
                onPress={() => void confirm()}
                variant="danger"
              >
                {isDeleting ? 'Deleting…' : 'Delete'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

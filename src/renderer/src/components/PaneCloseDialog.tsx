import { Button, Modal } from '@heroui/react'

import type { PaneCloseWarning } from '../lib/pane-close-warning'

interface PaneCloseDialogProps {
  readonly isOpen: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
  readonly warning: PaneCloseWarning | null
}

export default function PaneCloseDialog({
  isOpen,
  onCancel,
  onConfirm,
  warning,
}: PaneCloseDialogProps) {
  return (
    <Modal>
      <Modal.Backdrop
        isDismissable
        isOpen={isOpen}
        onOpenChange={(nextIsOpen) => {
          if (!nextIsOpen) onCancel()
        }}
        variant="opaque"
      >
        <Modal.Container placement="center" size="sm">
          <Modal.Dialog className="rounded-xl floating-surface text-foreground">
            <Modal.Header>
              <Modal.Heading>{warning?.title ?? 'Close pane?'}</Modal.Heading>
            </Modal.Header>
            <Modal.Body className="text-sm text-muted-foreground">
              {warning?.detail}
            </Modal.Body>
            <Modal.Footer>
              <Button autoFocus onPress={onCancel} variant="secondary">
                Cancel
              </Button>
              <Button onPress={onConfirm} variant="danger">
                Close
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

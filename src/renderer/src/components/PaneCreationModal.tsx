import { Button, Modal, Surface } from '@heroui/react'

import { listPaneCatalogEntries } from '@/lib/pane-catalog'

interface PaneCreationModalProps {
  readonly isOpen: boolean
  readonly onCreatePane: (paneId: string) => void
  readonly onOpenChange: (isOpen: boolean) => void
}

export default function PaneCreationModal({
  isOpen,
  onCreatePane,
  onOpenChange,
}: PaneCreationModalProps) {
  const paneOptions = listPaneCatalogEntries()

  return (
    <Modal>
      <Modal.Backdrop
        isDismissable
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        variant="opaque"
      >
        <Modal.Container placement="center" size="lg">
          <Modal.Dialog className="border border-border/80 bg-surface shadow-[var(--overlay-shadow)]">
            <Modal.Header>
              <Modal.Heading>Add pane</Modal.Heading>
            </Modal.Header>

            <Modal.Body>
              <div className="grid gap-3 sm:grid-cols-2">
                {paneOptions.map((pane) => {
                  const Icon = pane.icon

                  return (
                    <button
                      className="text-left"
                      key={pane.type}
                      onClick={() => {
                        onCreatePane(pane.type)
                        onOpenChange(false)
                      }}
                      type="button"
                    >
                      <Surface className="rounded-2xl border border-border/70 p-4 transition-colors hover:border-primary/45 hover:bg-surface-secondary">
                        <div className="flex items-start gap-3">
                          <div className="rounded-xl border border-border/70 bg-background/70 p-2 text-muted-foreground">
                            <Icon className="size-4" />
                          </div>
                          <div className="space-y-1">
                            <p className="text-sm font-medium text-foreground">
                              {pane.defaultMetadata.type}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {pane.createDescription}
                            </p>
                          </div>
                        </div>
                      </Surface>
                    </button>
                  )
                })}
              </div>
            </Modal.Body>

            <Modal.Footer>
              <Button onPress={() => onOpenChange(false)} variant="ghost">
                Cancel
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

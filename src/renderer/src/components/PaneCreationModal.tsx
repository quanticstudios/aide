import { Button, Modal, Surface } from '@heroui/react'
import { useCallback, useEffect, useState } from 'react'

import { listCreatablePaneCatalogEntries } from '@/lib/pane-catalog'

const COLUMNS = 2

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
  const paneOptions = listCreatablePaneCatalogEntries()
  const [focusedIndex, setFocusedIndex] = useState(0)
  const [previousIsOpen, setPreviousIsOpen] = useState(isOpen)

  // Reset before commit when reopening, rather than briefly showing old keyboard focus.
  if (isOpen !== previousIsOpen) {
    setPreviousIsOpen(isOpen)
    if (isOpen && !previousIsOpen) {
      setFocusedIndex(0)
    }
  }

  const handleSelect = useCallback(
    (index: number) => {
      const option = paneOptions[index]

      if (option) {
        onCreatePane(option.id)
        onOpenChange(false)
      }
    },
    [onCreatePane, onOpenChange, paneOptions],
  )

  useEffect(() => {
    if (!isOpen) {
      return
    }

    function handleKeyDown(event: KeyboardEvent): void {
      const key = event.key
      const code = event.code?.toLowerCase() ?? ''
      const count = paneOptions.length
      const row = Math.floor(focusedIndex / COLUMNS)
      const col = focusedIndex % COLUMNS
      const rows = Math.ceil(count / COLUMNS)

      const isLeft = key === 'ArrowLeft' || key === 'h' || code === 'keyh'
      const isRight = key === 'ArrowRight' || key === 'l' || code === 'keyl'
      const isUp = key === 'ArrowUp' || key === 'k' || code === 'keyk'
      const isDown = key === 'ArrowDown' || key === 'j' || code === 'keyj'

      if (isLeft) {
        event.preventDefault()
        const nextCol = col > 0 ? col - 1 : COLUMNS - 1
        const next = row * COLUMNS + nextCol

        setFocusedIndex(next < count ? next : focusedIndex)
        return
      }

      if (isRight) {
        event.preventDefault()
        const nextCol = (col + 1) % COLUMNS
        const next = row * COLUMNS + nextCol

        setFocusedIndex(next < count ? next : focusedIndex)
        return
      }

      if (isUp) {
        event.preventDefault()
        const nextRow = row > 0 ? row - 1 : rows - 1
        const next = nextRow * COLUMNS + col

        setFocusedIndex(next < count ? next : focusedIndex)
        return
      }

      if (isDown) {
        event.preventDefault()
        const nextRow = (row + 1) % rows
        const next = nextRow * COLUMNS + col

        setFocusedIndex(next < count ? next : focusedIndex)
        return
      }

      if (key === 'Enter' || key === ' ') {
        event.preventDefault()
        handleSelect(focusedIndex)
      }
    }

    document.addEventListener('keydown', handleKeyDown)

    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, focusedIndex, paneOptions, handleSelect])

  return (
    <Modal>
      <Modal.Backdrop
        isDismissable
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        variant="opaque"
      >
        <Modal.Container placement="center" size="lg">
          <Modal.Dialog className="rounded-xl border border-border bg-surface shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
            <Modal.Header>
              <Modal.Heading>Add pane</Modal.Heading>
            </Modal.Header>

            <Modal.Body>
              <div className="grid gap-3 sm:grid-cols-2">
                {paneOptions.map((pane, index) => {
                  const Icon = pane.icon
                  const isFocused = index === focusedIndex

                  return (
                    <button
                      className="text-left"
                      key={pane.id}
                      onClick={() => handleSelect(index)}
                      onMouseEnter={() => setFocusedIndex(index)}
                      type="button"
                    >
                      <Surface
                        className={`overview-card rounded-lg p-4 ${
                          isFocused ? 'is-active' : ''
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <div className="rounded-md border border-border bg-surface-tertiary p-2 text-muted-foreground">
                            <Icon className="size-4" />
                          </div>
                          <div className="space-y-1">
                            <p className="text-sm font-semibold text-foreground">
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

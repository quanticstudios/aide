import { Button, Modal, Surface } from '@heroui/react'
import {
  Eye,
  GitBranch,
  MessageSquareText,
  SquarePen,
  SquareTerminal,
} from 'lucide-react'

const paneOptions = [
  {
    description: 'Task steering, notes, and AI coordination.',
    icon: MessageSquareText,
    id: 'chat',
    label: 'Chat',
  },
  {
    description: 'CLI execution and verification loops.',
    icon: SquareTerminal,
    id: 'terminal',
    label: 'Terminal',
  },
  {
    description: 'Branch state, diffs, and trust checks.',
    icon: GitBranch,
    id: 'git',
    label: 'Git',
  },
  {
    description: 'File inspection and edit validation.',
    icon: SquarePen,
    id: 'editor',
    label: 'Editor',
  },
  {
    description: 'Preview the running app or docs surface.',
    icon: Eye,
    id: 'preview',
    label: 'Preview',
  },
] as const

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
                      key={pane.id}
                      onClick={() => {
                        onCreatePane(pane.id)
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
                              {pane.label}
                            </p>
                            <p className="text-sm text-muted-foreground">
                              {pane.description}
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

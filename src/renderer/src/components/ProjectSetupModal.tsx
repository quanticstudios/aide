import {
  Button,
  Description,
  FieldError,
  Input,
  Label,
  Modal,
  TextField,
} from '@heroui/react'
import { useState } from 'react'

import type { ProjectRecord } from '../../../shared/persistence'

interface ProjectSetupModalProps {
  readonly isOpen: boolean
  readonly onOpenChange: (isOpen: boolean) => void
  readonly onSave: (command: string | null) => Promise<string | null>
  readonly project: ProjectRecord | null
}

export default function ProjectSetupModal({
  isOpen,
  onOpenChange,
  onSave,
  project,
}: ProjectSetupModalProps) {
  const [command, setCommand] = useState(project?.setupCommand ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const resetKey = isOpen
    ? `${project?.id}:${project?.worktreeSetupRevision}`
    : null
  const [previousResetKey, setPreviousResetKey] = useState(resetKey)

  if (resetKey !== previousResetKey) {
    setPreviousResetKey(resetKey)
    if (isOpen) {
      setCommand(project?.setupCommand ?? '')
      setError(null)
    }
  }

  if (!project) return null

  async function save(): Promise<void> {
    setIsSaving(true)
    const result = await onSave(command.trim() || null)
    setIsSaving(false)
    if (result) {
      setError(result)
      return
    }
    onOpenChange(false)
  }

  return (
    <Modal>
      <Modal.Backdrop
        isDismissable={!isSaving}
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        variant="opaque"
      >
        <Modal.Container placement="center" size="md">
          <Modal.Dialog className="rounded-xl floating-surface">
            <Modal.Header>
              <Modal.Heading>Worktree setup</Modal.Heading>
            </Modal.Header>
            <Modal.Body>
              <TextField isInvalid={Boolean(error)}>
                <Label>Project setup command</Label>
                <Input
                  aria-describedby="project-setup-help"
                  autoFocus
                  onChange={(event) => setCommand(event.target.value)}
                  placeholder="bun install && bun run devenv init --non-interactive"
                  value={command}
                />
                <Description id="project-setup-help">
                  Runs once after Aide creates a new worktree. Existing and root
                  worktrees remain manual. Clear this field to disable setup.
                </Description>
                {error ? <FieldError>{error}</FieldError> : null}
              </TextField>
            </Modal.Body>
            <Modal.Footer>
              <Button
                isDisabled={isSaving}
                onPress={() => onOpenChange(false)}
                variant="secondary"
              >
                Cancel
              </Button>
              <Button
                isDisabled={isSaving}
                onPress={() => void save()}
                variant="primary"
              >
                {isSaving ? 'Saving…' : 'Save setup'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

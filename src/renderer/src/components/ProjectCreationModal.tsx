import {
  Button,
  Description,
  FieldError,
  Input,
  Label,
  Modal,
  Surface,
  TextField,
} from '@heroui/react'
import { useEffect, useState } from 'react'

import type { CreateProjectInput } from '../../../shared/persistence'
import type { ProjectDraftValues } from '../lib/project-draft'

interface ProjectCreationModalProps {
  readonly defaults: ProjectDraftValues | null
  readonly isOpen: boolean
  readonly onOpenChange: (isOpen: boolean) => void
  readonly onSubmit: (input: CreateProjectInput) => Promise<string | null>
}

export default function ProjectCreationModal({
  defaults,
  isOpen,
  onOpenChange,
  onSubmit,
}: ProjectCreationModalProps) {
  const [name, setName] = useState(defaults?.name ?? '')
  const [repoRoot, setRepoRoot] = useState(defaults?.repoRoot ?? '')
  const [defaultBranch, setDefaultBranch] = useState(
    defaults?.defaultBranch ?? 'main',
  )
  const [remoteUrl, setRemoteUrl] = useState(defaults?.remoteUrl ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)

  useEffect(() => {
    if (!defaults || !isOpen) {
      return
    }

    setName(defaults.name)
    setRepoRoot(defaults.repoRoot)
    setDefaultBranch(defaults.defaultBranch)
    setRemoteUrl(defaults.remoteUrl)
    setError(null)
  }, [defaults, isOpen])

  const isNameInvalid = name.trim().length === 0
  const isRepoRootInvalid = repoRoot.trim().length === 0
  const isBranchInvalid = defaultBranch.trim().length === 0

  async function handleSubmit(): Promise<void> {
    if (isNameInvalid || isRepoRootInvalid || isBranchInvalid) {
      setError('Name, repo root, and default branch are required.')
      return
    }

    setIsSubmitting(true)

    const submitError = await onSubmit({
      defaultBranch: defaultBranch.trim(),
      name: name.trim(),
      remoteUrl: remoteUrl.trim() || null,
      repoRoot: repoRoot.trim(),
    })

    setIsSubmitting(false)

    if (submitError) {
      setError(submitError)
      return
    }

    onOpenChange(false)
  }

  return (
    <Modal>
      <Modal.Backdrop
        isDismissable
        isOpen={isOpen}
        onOpenChange={onOpenChange}
        variant="opaque"
      >
        <Modal.Container placement="center" size="md">
          <Modal.Dialog className="border border-border/80 bg-surface shadow-[var(--overlay-shadow)]">
            <Modal.Header>
              <Modal.Heading>Create project</Modal.Heading>
            </Modal.Header>

            <Modal.Body>
              <div className="space-y-4">
                <Surface
                  className="rounded-2xl border border-border/70 p-4"
                  variant="secondary"
                >
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    Project root suggestion
                  </p>
                  <p className="mt-2 font-mono text-xs text-muted-foreground">
                    {defaults?.repoRoot ?? 'No runtime path available'}
                  </p>
                </Surface>

                <TextField isInvalid={isNameInvalid}>
                  <Label>Project name</Label>
                  <Input
                    onChange={(event) => setName(event.target.value)}
                    value={name}
                    variant="secondary"
                  />
                  <Description>Shown in the project rail.</Description>
                  <FieldError>Project name is required.</FieldError>
                </TextField>

                <TextField isInvalid={isRepoRootInvalid}>
                  <Label>Repo root</Label>
                  <Input
                    onChange={(event) => setRepoRoot(event.target.value)}
                    value={repoRoot}
                    variant="secondary"
                  />
                  <Description>
                    Workspace creation uses this root when deriving worktree
                    paths.
                  </Description>
                  <FieldError>Repo root is required.</FieldError>
                </TextField>

                <TextField isInvalid={isBranchInvalid}>
                  <Label>Default branch</Label>
                  <Input
                    onChange={(event) => setDefaultBranch(event.target.value)}
                    value={defaultBranch}
                    variant="secondary"
                  />
                  <Description>
                    Used as the baseline branch for this project.
                  </Description>
                  <FieldError>Default branch is required.</FieldError>
                </TextField>

                <TextField>
                  <Label>Remote URL</Label>
                  <Input
                    onChange={(event) => setRemoteUrl(event.target.value)}
                    value={remoteUrl}
                    variant="secondary"
                  />
                  <Description>
                    Optional, but useful for future git and provider flows.
                  </Description>
                </TextField>

                {error ? (
                  <Surface
                    className="rounded-2xl border border-destructive/40 p-3 text-sm text-destructive"
                    variant="secondary"
                  >
                    {error}
                  </Surface>
                ) : null}
              </div>
            </Modal.Body>

            <Modal.Footer>
              <Button onPress={() => onOpenChange(false)} variant="ghost">
                Cancel
              </Button>
              <Button
                isDisabled={isSubmitting}
                onPress={() => void handleSubmit()}
                variant="primary"
              >
                Create project
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

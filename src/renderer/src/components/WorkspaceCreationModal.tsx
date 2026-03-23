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
import { useEffect, useMemo, useState } from 'react'

import type { ProjectRecord } from '../../../shared/persistence'
import {
  buildDefaultWorktreePath,
  createWorkspaceDraftValues,
} from '../lib/workspace-draft'

interface WorkspaceCreationModalProps {
  readonly isOpen: boolean
  readonly onOpenChange: (isOpen: boolean) => void
  readonly onSubmit: (input: {
    branchName: string
    name: string
    projectId: string
    worktreePath: string
  }) => Promise<string | null>
  readonly project: ProjectRecord | null
  readonly workspaceCount: number
}

export default function WorkspaceCreationModal({
  isOpen,
  onOpenChange,
  onSubmit,
  project,
  workspaceCount,
}: WorkspaceCreationModalProps) {
  const defaults = useMemo(
    () =>
      project
        ? createWorkspaceDraftValues(project.repoRoot, workspaceCount + 1)
        : null,
    [project, workspaceCount],
  )
  const [name, setName] = useState(defaults?.name ?? '')
  const [branchName, setBranchName] = useState(defaults?.branchName ?? '')
  const [worktreePath, setWorktreePath] = useState(defaults?.worktreePath ?? '')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [worktreeDirty, setWorktreeDirty] = useState(false)

  useEffect(() => {
    if (!defaults || !isOpen) {
      return
    }

    setName(defaults.name)
    setBranchName(defaults.branchName)
    setWorktreePath(defaults.worktreePath)
    setError(null)
    setWorktreeDirty(false)
  }, [defaults, isOpen])

  useEffect(() => {
    if (!project || worktreeDirty) {
      return
    }

    setWorktreePath(buildDefaultWorktreePath(project.repoRoot, branchName))
  }, [branchName, project, worktreeDirty])

  const isNameInvalid = name.trim().length === 0
  const isBranchInvalid = branchName.trim().length === 0
  const isWorktreeInvalid = worktreePath.trim().length === 0

  if (!project) {
    return null
  }

  const resolvedProject = project

  async function handleSubmit(): Promise<void> {
    if (isNameInvalid || isBranchInvalid || isWorktreeInvalid) {
      setError('Name, branch, and worktree path are required.')
      return
    }

    setIsSubmitting(true)

    const submitError = await onSubmit({
      branchName: branchName.trim(),
      name: name.trim(),
      projectId: resolvedProject.id,
      worktreePath: worktreePath.trim(),
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
              <Modal.Heading>Create workspace</Modal.Heading>
            </Modal.Header>

            <Modal.Body>
              <div className="space-y-4">
                <Surface
                  className="rounded-2xl border border-border/70 p-4"
                  variant="secondary"
                >
                  <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
                    Project
                  </p>
                  <p className="mt-2 text-sm font-medium text-foreground">
                    {resolvedProject.name}
                  </p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {resolvedProject.repoRoot}
                  </p>
                </Surface>

                <TextField isInvalid={isNameInvalid}>
                  <Label>Workspace name</Label>
                  <Input
                    onChange={(event) => setName(event.target.value)}
                    value={name}
                    variant="secondary"
                  />
                  <Description>
                    Used in navigation and switcher surfaces.
                  </Description>
                  <FieldError>Name is required.</FieldError>
                </TextField>

                <TextField isInvalid={isBranchInvalid}>
                  <Label>Branch name</Label>
                  <Input
                    onChange={(event) => setBranchName(event.target.value)}
                    value={branchName}
                    variant="secondary"
                  />
                  <Description>
                    Stored now; real git worktree creation comes later.
                  </Description>
                  <FieldError>Branch name is required.</FieldError>
                </TextField>

                <TextField isInvalid={isWorktreeInvalid}>
                  <Label>Worktree path</Label>
                  <Input
                    onChange={(event) => {
                      setWorktreeDirty(true)
                      setWorktreePath(event.target.value)
                    }}
                    value={worktreePath}
                    variant="secondary"
                  />
                  <Description>
                    Defaults under the project root and can be overridden.
                  </Description>
                  <FieldError>Worktree path is required.</FieldError>
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
                Create workspace
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

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

import type { ProjectRefRecord } from '../../../shared/git'
import type { ProjectRecord } from '../../../shared/persistence'
import {
  buildDefaultWorktreePath,
  createWorkspaceDraftValues,
} from '../lib/workspace-draft'

interface WorkspaceCreationModalProps {
  readonly isOpen: boolean
  readonly loadProjectRefs: (projectId: string) => Promise<ProjectRefRecord[]>
  readonly onOpenChange: (isOpen: boolean) => void
  readonly onSubmit: (input: {
    baseBranch: string
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
  loadProjectRefs,
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
  const [baseBranch, setBaseBranch] = useState(project?.defaultBranch ?? 'main')
  const [worktreePath, setWorktreePath] = useState(defaults?.worktreePath ?? '')
  const [error, setError] = useState<string | null>(null)
  const [refOptions, setRefOptions] = useState<ProjectRefRecord[]>([])
  const [isLoadingRefs, setIsLoadingRefs] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [worktreeDirty, setWorktreeDirty] = useState(false)
  const baseBranchOptionsId = useMemo(
    () => `workspace-base-branches-${project?.id ?? 'missing'}`,
    [project?.id],
  )

  useEffect(() => {
    if (!defaults || !isOpen) {
      return
    }

    setName(defaults.name)
    setBranchName(defaults.branchName)
    setBaseBranch(project?.defaultBranch ?? 'main')
    setWorktreePath(defaults.worktreePath)
    setError(null)
    setRefOptions([])
    setWorktreeDirty(false)
  }, [defaults, isOpen, project?.defaultBranch])

  useEffect(() => {
    if (!isOpen || !project) {
      return
    }

    let isCancelled = false

    setIsLoadingRefs(true)
    setError(null)

    void loadProjectRefs(project.id)
      .then((refs) => {
        if (isCancelled) {
          return
        }

        setRefOptions(refs)

        const hasDefaultBranch = refs.some(
          (candidate) =>
            candidate.name === project.defaultBranch ||
            candidate.name === `origin/${project.defaultBranch}`,
        )

        setBaseBranch((currentBaseBranch) => {
          if (
            currentBaseBranch.trim().length > 0 &&
            refs.some((candidate) => candidate.name === currentBaseBranch)
          ) {
            return currentBaseBranch
          }

          return hasDefaultBranch
            ? project.defaultBranch
            : (refs[0]?.name ?? project.defaultBranch ?? 'main')
        })
      })
      .catch((loadError: unknown) => {
        if (isCancelled) {
          return
        }

        setError(
          loadError instanceof Error
            ? loadError.message
            : 'Failed to load project branches.',
        )
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoadingRefs(false)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [isOpen, loadProjectRefs, project, project?.defaultBranch])

  useEffect(() => {
    if (!project || worktreeDirty) {
      return
    }

    setWorktreePath(buildDefaultWorktreePath(project.repoRoot, branchName))
  }, [branchName, project, worktreeDirty])

  const isNameInvalid = name.trim().length === 0
  const isBranchInvalid = branchName.trim().length === 0
  const isBaseBranchInvalid = baseBranch.trim().length === 0
  const isWorktreeInvalid = worktreePath.trim().length === 0

  if (!project) {
    return null
  }

  const resolvedProject = project

  async function handleSubmit(): Promise<void> {
    if (
      isNameInvalid ||
      isBranchInvalid ||
      isBaseBranchInvalid ||
      isWorktreeInvalid
    ) {
      setError('Name, branch, base branch, and worktree path are required.')
      return
    }

    setIsSubmitting(true)

    const submitError = await onSubmit({
      baseBranch: baseBranch.trim(),
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
                    Create or check out this branch in a real Git worktree.
                  </Description>
                  <FieldError>Branch name is required.</FieldError>
                </TextField>

                <TextField isInvalid={isBaseBranchInvalid}>
                  <Label>Base branch</Label>
                  <Input
                    list={baseBranchOptionsId}
                    onChange={(event) => setBaseBranch(event.target.value)}
                    value={baseBranch}
                    variant="secondary"
                  />
                  <datalist id={baseBranchOptionsId}>
                    {refOptions.map((candidate) => (
                      <option
                        key={`${candidate.source}:${candidate.name}`}
                        value={candidate.name}
                      >
                        {candidate.displayName}
                      </option>
                    ))}
                  </datalist>
                  <Description>
                    Search or type a branch/ref to branch from.
                  </Description>
                  <FieldError>Base branch is required.</FieldError>
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

                {isLoadingRefs ? (
                  <Surface
                    className="rounded-2xl border border-border/70 p-3 text-sm text-muted-foreground"
                    variant="secondary"
                  >
                    Loading branches…
                  </Surface>
                ) : null}

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
                isDisabled={isLoadingRefs || isSubmitting}
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

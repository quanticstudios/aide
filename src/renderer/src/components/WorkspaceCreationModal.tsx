import {
  Button,
  ComboBox,
  Description,
  FieldError,
  Input,
  Label,
  ListBox,
  Modal,
  Surface,
  TextField,
} from '@heroui/react'
import { ChevronsUpDown } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import type { ProjectRefRecord } from '../../../shared/git'
import type { ProjectRecord } from '../../../shared/persistence'
import { cn } from '../lib/utils'
import {
  buildDefaultWorktreePath,
  createWorkspaceDraftValues,
} from '../lib/workspace-draft'

type Mode = 'create' | 'attach'

interface WorkspaceCreationModalProps {
  readonly existingRootWorkspaceName: string | null
  readonly isOpen: boolean
  readonly loadProjectRefs: (projectId: string) => Promise<ProjectRefRecord[]>
  readonly onAttach: (input: {
    name: string
    projectId: string
    worktreePath: string
  }) => Promise<string | null>
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

function basenameOf(folderPath: string): string {
  const trimmed = folderPath.replace(/[\\/]+$/, '')
  const segments = trimmed.split(/[\\/]/)
  return segments[segments.length - 1] ?? trimmed
}

export default function WorkspaceCreationModal({
  existingRootWorkspaceName,
  isOpen,
  loadProjectRefs,
  onAttach,
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
  const [mode, setMode] = useState<Mode>('create')
  const [name, setName] = useState(defaults?.name ?? '')
  const [branchName, setBranchName] = useState(defaults?.branchName ?? '')
  const [baseBranch, setBaseBranch] = useState(project?.defaultBranch ?? 'main')
  const [worktreePath, setWorktreePath] = useState(defaults?.worktreePath ?? '')
  const [error, setError] = useState<string | null>(null)
  const [refOptions, setRefOptions] = useState<ProjectRefRecord[]>([])
  const [isLoadingRefs, setIsLoadingRefs] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [worktreeDirty, setWorktreeDirty] = useState(false)

  const [rootName, setRootName] = useState('')
  const [rootBranch, setRootBranch] = useState<string | null>(null)
  const [isDetectingRoot, setIsDetectingRoot] = useState(false)

  useEffect(() => {
    if (!defaults || !isOpen || !project) {
      return
    }

    setMode('create')
    setName(defaults.name)
    setBranchName(defaults.branchName)
    setBaseBranch(project.defaultBranch ?? 'main')
    setWorktreePath(defaults.worktreePath)
    setError(null)
    setRefOptions([])
    setWorktreeDirty(false)
    setRootName(basenameOf(project.repoRoot))
    setRootBranch(null)
  }, [defaults, isOpen, project])

  useEffect(() => {
    if (!isOpen || !project || mode !== 'create') {
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
  }, [isOpen, loadProjectRefs, project, project?.defaultBranch, mode])

  useEffect(() => {
    if (
      !isOpen ||
      !project ||
      mode !== 'attach' ||
      existingRootWorkspaceName !== null
    ) {
      return
    }

    const api = typeof window === 'undefined' ? null : (window.aide ?? null)

    if (!api) {
      return
    }

    let isCancelled = false
    setIsDetectingRoot(true)

    void api
      .detectWorktreeBranch(project.repoRoot)
      .then((result) => {
        if (isCancelled) {
          return
        }
        setRootBranch(result.branchName ?? project.defaultBranch ?? null)
      })
      .catch(() => {
        if (isCancelled) {
          return
        }
        setRootBranch(project.defaultBranch ?? null)
      })
      .finally(() => {
        if (!isCancelled) {
          setIsDetectingRoot(false)
        }
      })

    return () => {
      isCancelled = true
    }
  }, [
    existingRootWorkspaceName,
    isOpen,
    mode,
    project,
    project?.repoRoot,
    project?.defaultBranch,
  ])

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
  const isRootNameInvalid = rootName.trim().length === 0

  if (!project) {
    return null
  }

  const resolvedProject = project
  const isRootAlreadyAttached = existingRootWorkspaceName !== null

  async function handleSubmit(): Promise<void> {
    if (mode === 'create') {
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
      return
    }

    if (isRootAlreadyAttached || isRootNameInvalid) {
      setError('Workspace name is required.')
      return
    }

    setIsSubmitting(true)

    const submitError = await onAttach({
      name: rootName.trim(),
      projectId: resolvedProject.id,
      worktreePath: resolvedProject.repoRoot,
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
          <Modal.Dialog className="rounded-xl border border-border bg-surface shadow-[0_20px_60px_rgba(0,0,0,0.4)]">
            <Modal.Header>
              <Modal.Heading>
                {mode === 'create' ? 'Create workspace' : 'Open project root'}
              </Modal.Heading>
            </Modal.Header>

            <Modal.Body>
              <div className="space-y-4">
                <div className="flex gap-1 rounded-md border border-border bg-surface-secondary p-1">
                  <button
                    className={cn(
                      'flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors',
                      mode === 'create'
                        ? 'bg-surface text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => {
                      setMode('create')
                      setError(null)
                    }}
                    type="button"
                  >
                    Create new
                  </button>
                  <button
                    className={cn(
                      'flex-1 rounded-sm px-3 py-1.5 text-sm font-medium transition-colors',
                      mode === 'attach'
                        ? 'bg-surface text-foreground shadow-sm'
                        : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => {
                      setMode('attach')
                      setError(null)
                    }}
                    type="button"
                  >
                    Open root
                  </button>
                </div>

                <Surface
                  className="rounded-md border border-border p-4"
                  variant="secondary"
                >
                  <p className="eyebrow">Project</p>
                  <p className="mt-2 text-sm font-semibold text-foreground">
                    {resolvedProject.name}
                  </p>
                  <p className="mt-1 font-mono text-xs text-muted-foreground">
                    {resolvedProject.repoRoot}
                  </p>
                </Surface>

                {mode === 'create' ? (
                  <>
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

                    <ComboBox
                      allowsCustomValue
                      inputValue={baseBranch}
                      isInvalid={isBaseBranchInvalid}
                      onInputChange={setBaseBranch}
                      onSelectionChange={(key) => {
                        if (key !== null) {
                          setBaseBranch(String(key))
                        }
                      }}
                      variant="secondary"
                    >
                      <Label>Base branch</Label>
                      <ComboBox.InputGroup>
                        <Input placeholder="Search branches…" />
                        <ComboBox.Trigger>
                          <ChevronsUpDown className="size-3.5" />
                        </ComboBox.Trigger>
                      </ComboBox.InputGroup>
                      <Description>
                        Search or type a branch/ref to branch from.
                      </Description>
                      <FieldError>Base branch is required.</FieldError>
                      <ComboBox.Popover>
                        <ListBox className="max-h-48 overflow-y-auto">
                          {refOptions.map((candidate) => (
                            <ListBox.Item
                              id={candidate.name}
                              key={`${candidate.source}:${candidate.name}`}
                              textValue={candidate.name}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="truncate text-sm">
                                  {candidate.name}
                                </span>
                                <span className="eyebrow shrink-0 text-[10px]">
                                  {candidate.source}
                                </span>
                              </div>
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </ComboBox.Popover>
                    </ComboBox>

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
                        className="rounded-md border border-border p-3 text-sm text-muted-foreground"
                        variant="secondary"
                      >
                        Loading branches…
                      </Surface>
                    ) : null}
                  </>
                ) : isRootAlreadyAttached ? (
                  <Surface
                    className="rounded-md border border-border p-4"
                    variant="secondary"
                  >
                    <p className="text-sm text-foreground">
                      Already open as{' '}
                      <span className="font-semibold">
                        {existingRootWorkspaceName}
                      </span>
                      .
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Switch to it from the sidebar.
                    </p>
                  </Surface>
                ) : (
                  <>
                    <TextField isInvalid={isRootNameInvalid}>
                      <Label>Workspace name</Label>
                      <Input
                        onChange={(event) => setRootName(event.target.value)}
                        value={rootName}
                        variant="secondary"
                      />
                      <Description>
                        Used in navigation and switcher surfaces.
                      </Description>
                      <FieldError>Name is required.</FieldError>
                    </TextField>

                    <div className="space-y-1">
                      <p className="text-sm font-medium text-foreground">
                        Detected branch
                      </p>
                      <p className="rounded-md border border-border bg-surface-secondary px-3 py-2 font-mono text-xs text-muted-foreground">
                        {isDetectingRoot
                          ? 'Reading…'
                          : (rootBranch ?? 'Unknown')}
                      </p>
                    </div>

                    <p className="text-xs text-muted-foreground">
                      Registers{' '}
                      <span className="font-mono">
                        {resolvedProject.repoRoot}
                      </span>{' '}
                      as a workspace on its current branch. Worktrees you create
                      later sit alongside it.
                    </p>
                  </>
                )}

                {error ? (
                  <Surface
                    className="rounded-md border border-accent-red bg-accent-red-soft p-3 text-sm text-accent-red"
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
                className="rounded-pill px-[22px] py-[11px]"
                isDisabled={
                  isLoadingRefs ||
                  isSubmitting ||
                  isDetectingRoot ||
                  (mode === 'attach' && isRootAlreadyAttached)
                }
                onPress={() => void handleSubmit()}
                variant="primary"
              >
                {mode === 'create' ? 'Create workspace' : 'Open root'}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

import { Button } from '@heroui/react'
import { FolderOpen, Plus } from 'lucide-react'

import { getWorkspaceScene, resolveWorkspacePaneId } from '@/lib/navigation-poc'
import { getPaneSlideWidth, getPaneTrackStyle } from '@/lib/pane-camera'
import {
  getWorkspaceSlideHeight,
  getWorkspaceTrackStyle,
} from '@/lib/workspace-camera'
import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'
import PlaceholderWorkspaceView from './PlaceholderWorkspaceView'
import PreviewPane from './PreviewPane'
import TerminalPane from './TerminalPane'

interface WorkspaceCanvasProps {
  readonly activePaneId: string | null
  readonly activeProject: ProjectRecord | null
  readonly activeWorkspace: WorkspaceRecord | null
  readonly onCreateProject: () => void
  readonly onCreateWorkspace: () => void
  readonly projectWorkspaces: readonly WorkspaceRecord[]
  readonly shellError: string | null
}

function EmptyState({
  actionLabel,
  description,
  onAction,
  title,
}: {
  readonly actionLabel: string
  readonly description: string
  readonly onAction: () => void
  readonly title: string
}) {
  return (
    <section className="flex h-full items-center justify-center p-8">
      <div className="flex max-w-xl flex-col items-center gap-4 text-center">
        <div className="rounded-full border border-border bg-card p-4 text-muted-foreground">
          <FolderOpen className="size-6" />
        </div>
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">
            Navigation shell
          </p>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <Button onPress={onAction} size="sm" variant="primary">
          <Plus className="size-4" />
          {actionLabel}
        </Button>
      </div>
    </section>
  )
}

export default function WorkspaceCanvas({
  activePaneId,
  activeProject,
  activeWorkspace,
  onCreateProject,
  onCreateWorkspace,
  projectWorkspaces,
  shellError,
}: WorkspaceCanvasProps) {
  const workspaceCount = Math.max(projectWorkspaces.length, 1)
  const activeWorkspaceIndex = Math.max(
    projectWorkspaces.findIndex(
      (workspace) => workspace.id === activeWorkspace?.id,
    ),
    0,
  )
  const workspaceTrackStyle = getWorkspaceTrackStyle(
    workspaceCount,
    activeWorkspaceIndex,
  )
  const workspaceSlideHeight = getWorkspaceSlideHeight(workspaceCount)
  const activeWorkspaceScene = getWorkspaceScene(activeWorkspace?.id ?? null)
  const activePaneLabel =
    activeWorkspaceScene.panes.find((pane) => pane.id === activePaneId)
      ?.label ??
    activeWorkspaceScene.panes[0]?.label ??
    ''

  if (shellError) {
    return (
      <section className="flex h-full items-center justify-center p-8">
        <div className="max-w-xl rounded-xl border border-destructive/40 bg-card p-6 text-center shadow-sm">
          <p className="text-xs uppercase tracking-[0.2em] text-destructive">
            Shell error
          </p>
          <h1 className="mt-3 text-xl font-semibold">
            Workspace shell failed to load
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">{shellError}</p>
        </div>
      </section>
    )
  }

  if (!activeProject) {
    return (
      <EmptyState
        actionLabel="Create project"
        description="Start by creating a project. Projects group the workspaces you will switch between."
        onAction={onCreateProject}
        title="No project selected"
      />
    )
  }

  if (!activeWorkspace) {
    return (
      <EmptyState
        actionLabel="Create workspace"
        description="This project is tracked, but it does not have a workspace yet. Create one to make the main region yours."
        onAction={onCreateWorkspace}
        title={`No workspace in ${activeProject.name}`}
      />
    )
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="sr-only">
        <span data-testid="active-workspace-name">{activeWorkspace.name}</span>
        <span data-testid="active-pane-name">{activePaneLabel}</span>
      </div>
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div
          className="workspace-slider flex min-h-0 shrink-0 flex-col items-stretch transition-transform duration-200 ease-out"
          style={workspaceTrackStyle}
        >
          {projectWorkspaces.map((workspace) => {
            const workspaceScene = getWorkspaceScene(workspace.id)
            const isActiveWorkspace = workspace.id === activeWorkspace.id
            const resolvedPaneId = resolveWorkspacePaneId(
              workspace.id,
              isActiveWorkspace ? activePaneId : null,
            )
            const paneCount = Math.max(workspaceScene.panes.length, 1)
            const activePaneIndex = Math.max(
              workspaceScene.panes.findIndex(
                (pane) => pane.id === resolvedPaneId,
              ),
              0,
            )
            const paneTrackStyle = getPaneTrackStyle(paneCount, activePaneIndex)
            const paneSlideWidth = getPaneSlideWidth(paneCount)

            return (
              <section
                className="workspace-slide flex min-h-0 shrink-0 flex-col overflow-hidden"
                key={workspace.id}
                style={{ height: workspaceSlideHeight }}
              >
                <div className="flex min-h-0 flex-1 items-stretch overflow-hidden">
                  <div
                    className="pane-slider-track flex min-h-0 shrink-0 items-stretch transition-transform duration-200 ease-out"
                    style={paneTrackStyle}
                  >
                    {workspaceScene.panes.map((pane) => {
                      const isActive = pane.id === resolvedPaneId

                      if (pane.type === 'Terminal') {
                        return (
                          <article
                            className="pane-slide flex h-full min-h-0 shrink-0 self-stretch p-4"
                            key={pane.id}
                            style={{ width: paneSlideWidth }}
                          >
                            {isActiveWorkspace && isActive ? (
                              <TerminalPane
                                paneId={pane.id}
                                workspace={workspace}
                              />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center rounded-xl border border-border/50 bg-[#0f131b] text-sm text-muted-foreground">
                                Terminal session hidden until this pane is
                                focused.
                              </div>
                            )}
                          </article>
                        )
                      }

                      return (
                        <article
                          className="pane-slide flex h-full min-h-0 shrink-0 self-stretch p-4"
                          key={pane.id}
                          style={{ width: paneSlideWidth }}
                        >
                          {pane.type === 'Preview' &&
                          isActive &&
                          isActiveWorkspace ? (
                            <PreviewPane />
                          ) : (
                            <PlaceholderWorkspaceView
                              pane={pane}
                              project={activeProject}
                              scene={workspaceScene}
                              workspace={workspace}
                            />
                          )}
                        </article>
                      )
                    })}
                  </div>
                </div>
              </section>
            )
          })}
        </div>
      </div>
    </section>
  )
}

import type { WorkspaceRecord } from '../shared/persistence'
import type { WorkspaceWindowContext } from '../shared/workspace-window'

export interface WorkspaceOwnershipStore {
  compareAndSetWorkspaceWindowId: (
    workspaceId: string,
    expectedWindowId: string | null,
    nextWindowId: string | null,
  ) => WorkspaceRecord | null
  clearWorkspaceWindowIds: () => number
  getWorkspace: (workspaceId: string) => WorkspaceRecord | null
}

export interface WorkspaceWindowController {
  createWorkspaceWindow: (
    context: Extract<WorkspaceWindowContext, { kind: 'workspace' }>,
    onClosed: () => void,
  ) => void
  focusWorkspaceWindow: (windowId: string) => boolean
}

export interface WorkspaceWindowManagerDependencies {
  createWindowId: () => string
  onOwnershipChanged: () => void
  store: WorkspaceOwnershipStore
  windows: WorkspaceWindowController
}

export interface WorkspaceDetachOutcome {
  outcome: 'detached' | 'focused-existing'
  windowId: string
  workspaceId: string
}

export class WorkspaceWindowManager {
  private acceptsCloseRepairs = true

  public constructor(
    private readonly dependencies: WorkspaceWindowManagerDependencies,
  ) {}

  public detachWorkspace(workspaceId: string): WorkspaceDetachOutcome {
    const workspace = this.dependencies.store.getWorkspace(workspaceId)

    if (!workspace) {
      throw new Error('Workspace does not exist.')
    }

    if (workspace.windowId !== null) {
      if (this.dependencies.windows.focusWorkspaceWindow(workspace.windowId)) {
        return {
          outcome: 'focused-existing',
          windowId: workspace.windowId,
          workspaceId,
        }
      }

      this.repairClosedWorkspaceOwnership(workspaceId, workspace.windowId)
    }

    const windowId = this.dependencies.createWindowId()
    const context: Extract<WorkspaceWindowContext, { kind: 'workspace' }> = {
      kind: 'workspace',
      windowId,
      workspaceId,
    }

    const claimedWorkspace =
      this.dependencies.store.compareAndSetWorkspaceWindowId(
        workspaceId,
        null,
        windowId,
      )

    if (!claimedWorkspace) {
      const currentWorkspace = this.dependencies.store.getWorkspace(workspaceId)

      if (
        currentWorkspace?.windowId &&
        this.dependencies.windows.focusWorkspaceWindow(
          currentWorkspace.windowId,
        )
      ) {
        return {
          outcome: 'focused-existing',
          windowId: currentWorkspace.windowId,
          workspaceId,
        }
      }

      throw new Error('Could not claim workspace window ownership.')
    }

    this.dependencies.onOwnershipChanged()

    try {
      this.dependencies.windows.createWorkspaceWindow(context, () => {
        this.repairClosedWorkspaceOwnership(workspaceId, windowId)
      })

      if (
        this.dependencies.store.getWorkspace(workspaceId)?.windowId !== windowId
      ) {
        throw new Error('Workspace window closed before it could be shown.')
      }
    } catch (error) {
      this.repairClosedWorkspaceOwnership(workspaceId, windowId)
      throw error
    }

    return { outcome: 'detached', windowId, workspaceId }
  }

  public prepareForShutdown(): void {
    this.acceptsCloseRepairs = false
    this.repairStaleOwnership()
  }

  public repairStaleOwnership(): number {
    return this.dependencies.store.clearWorkspaceWindowIds()
  }

  private repairClosedWorkspaceOwnership(
    workspaceId: string,
    windowId: string,
  ): void {
    if (!this.acceptsCloseRepairs) {
      return
    }

    const repaired = this.dependencies.store.compareAndSetWorkspaceWindowId(
      workspaceId,
      windowId,
      null,
    )

    if (repaired) {
      this.dependencies.onOwnershipChanged()
    }
  }
}

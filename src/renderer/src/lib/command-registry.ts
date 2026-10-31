import type { LucideIcon } from 'lucide-react'
import {
  CloudDownload,
  Expand,
  Eye,
  FolderKanban,
  GitBranch,
  Layers,
  PanelLeft,
  Plus,
  Shrink,
  SquareTerminal,
  Wrench,
  X,
} from 'lucide-react'

import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'

export interface PaletteCommand {
  readonly group: 'create' | 'navigation' | 'view'
  readonly icon: LucideIcon
  readonly id: string
  readonly keywords?: readonly string[]
  readonly label: string
  readonly onSelect: () => void
  readonly shortcut?: string
}

export interface CommandContext {
  readonly activePaneId: string | null
  readonly canCreateWorkspace?: boolean
  readonly onClosePane: (paneId: string) => void
  readonly onCreatePane: () => void
  readonly onCreateWorkspace: () => void
  readonly onOpenOverview: () => void
  readonly onOpenProject: () => void
  readonly onOpenSoftwareUpdate: () => void
  readonly onResizePane: (paneId: string, delta: number) => void
  readonly onSelectProject: (projectId: string) => void
  readonly onSelectWorkspace: (workspaceId: string) => void
  readonly onToggleSidebar: () => void
  readonly projects: readonly ProjectRecord[]
  readonly updateAction?: {
    readonly id:
      | 'check-for-updates'
      | 'download-update'
      | 'restart-to-update'
      | 'retry-update'
    readonly label: string
    readonly onSelect: () => void
  }
  readonly workspaces: readonly WorkspaceRecord[]
}

export function buildCommandList(context: CommandContext): PaletteCommand[] {
  const commands: PaletteCommand[] = []
  const activePaneId = context.activePaneId

  commands.push({
    group: 'view',
    icon: PanelLeft,
    id: 'toggle-sidebar',
    keywords: ['projects', 'workspaces', 'navigation'],
    label: 'Toggle left sidebar',
    onSelect: context.onToggleSidebar,
    shortcut: 'Ctrl B',
  })

  if (activePaneId) {
    commands.push(
      {
        group: 'view',
        icon: X,
        id: 'close-pane',
        keywords: ['tab', 'dismiss'],
        label: 'Close pane',
        onSelect: () => context.onClosePane(activePaneId),
      },
      {
        group: 'view',
        icon: Expand,
        id: 'grow-pane',
        keywords: ['resize', 'widen'],
        label: 'Grow pane',
        onSelect: () => context.onResizePane(activePaneId, 0.25),
      },
      {
        group: 'view',
        icon: Shrink,
        id: 'shrink-pane',
        keywords: ['resize', 'narrow'],
        label: 'Shrink pane',
        onSelect: () => context.onResizePane(activePaneId, -0.25),
      },
    )
  }

  for (const workspace of context.workspaces) {
    commands.push({
      group: 'navigation',
      icon: GitBranch,
      id: `go-workspace-${workspace.id}`,
      keywords: [workspace.branchName],
      label: workspace.name,
      onSelect: () => context.onSelectWorkspace(workspace.id),
    })
  }

  for (const project of context.projects) {
    commands.push({
      group: 'navigation',
      icon: FolderKanban,
      id: `go-project-${project.id}`,
      label: project.name,
      onSelect: () => context.onSelectProject(project.id),
    })
  }

  commands.push({
    group: 'create',
    icon: Plus,
    id: 'create-pane',
    label: 'New pane...',
    onSelect: context.onCreatePane,
    shortcut: 'Alt N',
  })

  if (context.updateAction) {
    commands.push({
      group: 'view',
      icon: CloudDownload,
      id: context.updateAction.id,
      keywords: ['ota', 'release', 'upgrade'],
      label: context.updateAction.label,
      onSelect: context.updateAction.onSelect,
    })
  }

  commands.push({
    group: 'view',
    icon: Wrench,
    id: 'open-software-update',
    keywords: ['ota', 'release', 'upgrade', 'settings'],
    label: 'Software update settings',
    onSelect: context.onOpenSoftwareUpdate,
  })

  if (context.canCreateWorkspace !== false) {
    commands.push({
      group: 'create',
      icon: SquareTerminal,
      id: 'create-workspace',
      label: 'New workspace...',
      onSelect: context.onCreateWorkspace,
    })
  }

  commands.push({
    group: 'create',
    icon: FolderKanban,
    id: 'open-project',
    label: 'Open project...',
    onSelect: context.onOpenProject,
  })

  commands.push({
    group: 'view',
    icon: Layers,
    id: 'open-overview',
    label: 'Open overview',
    onSelect: context.onOpenOverview,
    shortcut: 'Ctrl Tab',
  })

  commands.push({
    group: 'view',
    icon: Eye,
    id: 'toggle-workspace-switcher',
    label: 'Workspace switcher',
    onSelect: () => {},
    shortcut: 'Alt Space',
  })

  return commands
}

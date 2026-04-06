import type { ReactNode } from 'react'

import type { PreviewTarget } from '../../../shared/domain'
import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'
import GitPane from '../components/GitPane'
import PlaceholderWorkspaceView from '../components/PlaceholderWorkspaceView'
import PreviewPane from '../components/PreviewPane'
import TerminalPane from '../components/TerminalPane'
import {
  type ResolvedPaneMetadata,
  createFallbackPaneMetadata,
  getPaneCatalogEntry,
  listPaneCatalogEntries,
  resolvePaneMetadata,
  resolvePaneType,
} from './pane-catalog'

interface PaneRenderArgs {
  activePaneId: string | null
  activePreviewTarget: PreviewTarget | null
  onClosePane: (paneId: string) => void
  onLoadPreviewTarget: (workspace: WorkspaceRecord, url: string) => void
  onSelectPreviewTarget: (workspace: WorkspaceRecord, targetId: string) => void
  pane: ResolvedPaneMetadata
  project: ProjectRecord
  previewTargets: readonly PreviewTarget[]
  workspace: WorkspaceRecord
}

export interface PaneRegistryEntry {
  readonly type: ReturnType<typeof listPaneCatalogEntries>[number]['type']
  render: (args: PaneRenderArgs) => ReactNode
}

const placeholderRenderer = (args: PaneRenderArgs): ReactNode => (
  <PlaceholderWorkspaceView
    pane={args.pane}
    project={args.project}
    workspace={args.workspace}
  />
)

const terminalRenderer = (args: PaneRenderArgs): ReactNode => (
  <TerminalPane
    onClose={() => args.onClosePane(args.pane.id)}
    paneId={args.pane.id}
    workspace={args.workspace}
  />
)

const previewRenderer = (args: PaneRenderArgs): ReactNode =>
  args.pane.id === args.activePaneId ? (
    <PreviewPane
      activeTarget={args.activePreviewTarget}
      onLoadTarget={(url) => args.onLoadPreviewTarget(args.workspace, url)}
      onSelectTarget={(targetId) =>
        args.onSelectPreviewTarget(args.workspace, targetId)
      }
      targets={args.previewTargets}
    />
  ) : (
    placeholderRenderer(args)
  )

const gitRenderer = (args: PaneRenderArgs): ReactNode => (
  <GitPane
    isActive={args.pane.id === args.activePaneId}
    workspace={args.workspace}
  />
)

const paneRegistryEntries = listPaneCatalogEntries().map((entry) => ({
  render:
    entry.type === 'terminal'
      ? terminalRenderer
      : entry.type === 'git'
        ? gitRenderer
        : entry.type === 'preview'
          ? previewRenderer
          : placeholderRenderer,
  type: entry.type,
})) satisfies readonly PaneRegistryEntry[]

const paneRegistry = Object.fromEntries(
  paneRegistryEntries.map((entry) => [entry.type, entry]),
) as Record<PaneRegistryEntry['type'], PaneRegistryEntry>

export function getPaneRegistryEntry(
  paneType: PaneRegistryEntry['type'],
): PaneRegistryEntry {
  return paneRegistry[paneType]
}

export function createFallbackPane(paneId: string): ResolvedPaneMetadata {
  const { resolvedType } = createFallbackPaneMetadata(paneId)
  const registryEntry =
    resolvedType !== null ? getPaneCatalogEntry(resolvedType) : null

  return {
    ...resolvePaneMetadata(paneId),
    description:
      registryEntry?.defaultMetadata.description ??
      'Placeholder pane metadata is missing for this layout node.',
    label: registryEntry ? resolvePaneMetadata(paneId).label : paneId,
  }
}

export function renderPaneFromRegistry(args: PaneRenderArgs): ReactNode {
  const paneType = resolvePaneType(args.pane.type) ?? 'chat'

  return getPaneRegistryEntry(paneType).render(args)
}

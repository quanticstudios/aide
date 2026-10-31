import { lazy, type ReactNode } from 'react'

import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'
import type { WorkspacePreviewSnapshot } from '../../../shared/preview'
import { PaneLoadBoundary } from '../components/PaneLoadBoundary'
import SessionLayer from '../components/SessionLayer'
import type {
  PreviewBrowserControl,
  PreviewPresentation,
} from '../components/PreviewBrowserHost'
import {
  type ResolvedPaneMetadata,
  createFallbackPaneMetadata,
  getPaneCatalogEntry,
  listAllPaneCatalogEntries,
  resolvePaneMetadata,
  resolvePaneType,
  resolveTerminalLaunchModeForPaneId,
} from './pane-catalog'

const LazyGitPane = lazy(() => import('../components/GitPane'))
const LazyManagedAgentPane = lazy(
  () => import('../components/ManagedAgentPane'),
)
const LazyPreviewPane = lazy(() => import('../components/PreviewPane'))
const LazyTerminalPane = lazy(() => import('../components/TerminalPane'))

interface PaneRenderArgs {
  activePaneId: string | null
  onClosePane: (
    paneId: string,
    shouldCloseViewOnly?: boolean,
    workspaceId?: string,
  ) => void
  onOpenJevSettings: (trigger: HTMLElement) => void
  onPreviewBrowserControl: (control: PreviewBrowserControl) => void
  onPreviewCloseTab: (workspace: WorkspaceRecord, tabId: string) => void
  onPreviewNavigate: (
    workspace: WorkspaceRecord,
    tabId: string,
    url: string,
  ) => void
  onPreviewOpenTab: (workspace: WorkspaceRecord, url: string) => void
  onPreviewPresentationChange: (
    presentation: PreviewPresentation | null,
  ) => void
  onPreviewSelectTab: (workspace: WorkspaceRecord, tabId: string) => void
  pane: ResolvedPaneMetadata
  project: ProjectRecord
  previewSnapshot: WorkspacePreviewSnapshot | null
  workspace: WorkspaceRecord
}

export interface PaneRegistryEntry {
  readonly type: ReturnType<typeof listAllPaneCatalogEntries>[number]['type']
  render: (args: PaneRenderArgs) => ReactNode
}

const paneNoticeRenderer = (args: PaneRenderArgs): ReactNode => (
  <div className="flex min-h-0 flex-1 items-center justify-center text-sm text-muted-foreground">
    {args.pane.description}
  </div>
)

const terminalRenderer = (args: PaneRenderArgs): ReactNode =>
  resolveTerminalLaunchModeForPaneId(args.pane.id) === 'shell' ? (
    <PaneLoadBoundary
      key={args.pane.id}
      paneId={args.pane.id}
      paneName={args.pane.label}
    >
      <LazyTerminalPane
        onShellExit={() =>
          args.onClosePane(args.pane.id, true, args.workspace.id)
        }
        paneId={args.pane.id}
        workspace={args.workspace}
      />
    </PaneLoadBoundary>
  ) : (
    <PaneLoadBoundary
      key={args.pane.id}
      paneId={args.pane.id}
      paneName={args.pane.label}
    >
      <SessionLayer>
        <LazyManagedAgentPane
          isActive={args.pane.id === args.activePaneId}
          onOpenJevSettings={args.onOpenJevSettings}
          paneId={args.pane.id}
          workspace={args.workspace}
        />
      </SessionLayer>
    </PaneLoadBoundary>
  )

const previewRenderer = (args: PaneRenderArgs): ReactNode =>
  args.pane.id === args.activePaneId ? (
    <PaneLoadBoundary
      key={args.pane.id}
      paneId={args.pane.id}
      paneName={args.pane.label}
    >
      <LazyPreviewPane
        onBrowserControl={args.onPreviewBrowserControl}
        onCloseTab={(tabId) => args.onPreviewCloseTab(args.workspace, tabId)}
        onNavigate={(tabId, url) =>
          args.onPreviewNavigate(args.workspace, tabId, url)
        }
        onOpenTab={(url) => args.onPreviewOpenTab(args.workspace, url)}
        onPresentationChange={args.onPreviewPresentationChange}
        onSelectTab={(tabId) => args.onPreviewSelectTab(args.workspace, tabId)}
        snapshot={args.previewSnapshot}
      />
    </PaneLoadBoundary>
  ) : (
    paneNoticeRenderer(args)
  )

const gitRenderer = (args: PaneRenderArgs): ReactNode => (
  <PaneLoadBoundary
    key={args.pane.id}
    paneId={args.pane.id}
    paneName={args.pane.label}
  >
    <LazyGitPane
      isActive={args.pane.id === args.activePaneId}
      workspace={args.workspace}
    />
  </PaneLoadBoundary>
)

const paneRegistryEntries = listAllPaneCatalogEntries().map((entry) => ({
  render:
    entry.type === 'terminal'
      ? terminalRenderer
      : entry.type === 'git'
        ? gitRenderer
        : previewRenderer,
  type: entry.type,
})) satisfies readonly PaneRegistryEntry[]

const paneRegistry = Object.fromEntries(
  paneRegistryEntries.map((entry) => [entry.type, entry]),
) as Partial<Record<PaneRegistryEntry['type'], PaneRegistryEntry>>

export function createFallbackPane(paneId: string): ResolvedPaneMetadata {
  const { resolvedType } = createFallbackPaneMetadata(paneId)
  const registryEntry =
    resolvedType !== null ? getPaneCatalogEntry(resolvedType) : null

  return {
    ...resolvePaneMetadata(paneId),
    description:
      registryEntry?.defaultMetadata.description ??
      'This pane type is no longer available.',
    label: registryEntry ? resolvePaneMetadata(paneId).label : paneId,
  }
}

export function renderPaneFromRegistry(args: PaneRenderArgs): ReactNode {
  const paneType = resolvePaneType(args.pane.type)
  const entry = paneType ? paneRegistry[paneType] : undefined

  return entry ? entry.render(args) : paneNoticeRenderer(args)
}

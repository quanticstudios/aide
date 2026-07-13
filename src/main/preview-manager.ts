import { randomUUID } from 'node:crypto'

import type {
  PreviewNavigationReport,
  PreviewTabSnapshot,
  WorkspacePreviewEvent,
  WorkspacePreviewSnapshot,
} from '../shared/preview'
import {
  DEFAULT_PREVIEW_URL,
  normalizeAllowedPreviewUrl,
} from '../shared/preview'
import type { AideDatabase } from './database'

interface PreviewManagerOptions {
  getNow?: () => string
  onUpdate?: (event: WorkspacePreviewEvent) => void
}

export class PreviewManager {
  public constructor(
    private readonly database: AideDatabase,
    private readonly options: PreviewManagerOptions = {},
  ) {}

  public list(): Record<string, WorkspacePreviewSnapshot> {
    return this.database.getWorkspacePreviewStates()
  }

  public ensure(workspaceId: string): WorkspacePreviewSnapshot {
    const stored = this.database.getWorkspacePreviewState(workspaceId)

    if (stored) {
      return stored
    }

    const defaultTab = this.createTab(
      workspaceId,
      DEFAULT_PREVIEW_URL,
      'Preview',
    )
    return this.persist({
      activeTabId: defaultTab.id,
      initialized: true,
      revision: 1,
      tabs: [defaultTab],
      workspaceId,
    })
  }

  public openTab(workspaceId: string, url: string): WorkspacePreviewSnapshot {
    const snapshot = this.ensure(workspaceId)
    const normalizedUrl = normalizeAllowedPreviewUrl(url)
    const existingTab = snapshot.tabs.find((tab) => tab.url === normalizedUrl)

    if (existingTab) {
      return this.update(snapshot, {
        activeTabId: existingTab.id,
      })
    }

    const tab = this.createTab(workspaceId, normalizedUrl, 'Preview')
    return this.update(snapshot, {
      activeTabId: tab.id,
      tabs: [...snapshot.tabs, tab],
    })
  }

  public selectTab(
    workspaceId: string,
    tabId: string,
  ): WorkspacePreviewSnapshot {
    const snapshot = this.ensure(workspaceId)
    this.requireTab(snapshot, tabId)
    return this.update(snapshot, { activeTabId: tabId })
  }

  public closeTab(
    workspaceId: string,
    tabId: string,
  ): WorkspacePreviewSnapshot {
    const snapshot = this.ensure(workspaceId)
    const removedIndex = snapshot.tabs.findIndex((tab) => tab.id === tabId)

    if (removedIndex === -1) {
      return snapshot
    }

    const tabs = snapshot.tabs.filter((tab) => tab.id !== tabId)
    const activeTabId =
      snapshot.activeTabId === tabId
        ? (tabs[Math.max(0, removedIndex - 1)]?.id ?? null)
        : snapshot.activeTabId

    return this.update(snapshot, { activeTabId, tabs })
  }

  public navigate(
    workspaceId: string,
    tabId: string,
    url: string,
  ): WorkspacePreviewSnapshot {
    const snapshot = this.ensure(workspaceId)
    const normalizedUrl = normalizeAllowedPreviewUrl(url)

    return this.updateTab(snapshot, tabId, (tab) => ({
      ...tab,
      error: null,
      navStatus: 'loading',
      title: null,
      updatedAt: this.getNow(),
      url: normalizedUrl,
    }))
  }

  public reportNavigation(
    report: PreviewNavigationReport,
  ): WorkspacePreviewSnapshot {
    const snapshot = this.ensure(report.workspaceId)
    const normalizedUrl = normalizeAllowedPreviewUrl(report.url)
    const tab = this.requireTab(snapshot, report.tabId)

    if (
      report.expectedRevision > snapshot.revision ||
      (report.expectedRevision < snapshot.revision && tab.url !== normalizedUrl)
    ) {
      return snapshot
    }

    return this.updateTab(snapshot, report.tabId, (tab) => ({
      ...tab,
      canGoBack: report.canGoBack,
      canGoForward: report.canGoForward,
      error: report.error ?? null,
      navStatus: report.status,
      title: report.title ?? tab.title,
      updatedAt: this.getNow(),
      url: normalizedUrl,
    }))
  }

  private createTab(
    workspaceId: string,
    url: string,
    label: string,
  ): PreviewTabSnapshot {
    return {
      canGoBack: false,
      canGoForward: false,
      error: null,
      id: randomUUID(),
      label,
      navStatus: 'idle',
      title: null,
      updatedAt: this.getNow(),
      url,
      workspaceId,
    }
  }

  private persist(
    snapshot: WorkspacePreviewSnapshot,
  ): WorkspacePreviewSnapshot {
    const persisted = this.database.saveWorkspacePreviewState(snapshot)

    if (!persisted) {
      throw new Error(`Workspace ${snapshot.workspaceId} does not exist.`)
    }

    this.options.onUpdate?.({
      revision: persisted.revision,
      snapshot: persisted,
    })
    return persisted
  }

  private requireTab(
    snapshot: WorkspacePreviewSnapshot,
    tabId: string,
  ): PreviewTabSnapshot {
    const tab = snapshot.tabs.find((candidate) => candidate.id === tabId)
    if (!tab) {
      throw new Error(`Preview tab ${tabId} does not exist.`)
    }
    return tab
  }

  private update(
    snapshot: WorkspacePreviewSnapshot,
    update: Partial<Pick<WorkspacePreviewSnapshot, 'activeTabId' | 'tabs'>>,
  ): WorkspacePreviewSnapshot {
    return this.persist({
      ...snapshot,
      ...update,
      revision: snapshot.revision + 1,
    })
  }

  private updateTab(
    snapshot: WorkspacePreviewSnapshot,
    tabId: string,
    update: (tab: PreviewTabSnapshot) => PreviewTabSnapshot,
  ): WorkspacePreviewSnapshot {
    this.requireTab(snapshot, tabId)
    return this.update(snapshot, {
      tabs: snapshot.tabs.map((tab) => (tab.id === tabId ? update(tab) : tab)),
    })
  }

  private getNow(): string {
    return this.options.getNow?.() ?? new Date().toISOString()
  }
}

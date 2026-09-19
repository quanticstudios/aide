import { Button, Chip, Input } from '@heroui/react'
import { ChevronLeft, ChevronRight, Plus, RefreshCw, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { isAllowedPreviewUrl, normalizePreviewUrl } from '@/lib/preview-target'
import type { WorkspacePreviewSnapshot } from '../../../shared/preview'
import type {
  PreviewBrowserControl,
  PreviewPresentation,
} from './PreviewBrowserHost'

interface PreviewPaneProps {
  readonly onBrowserControl: (control: PreviewBrowserControl) => void
  readonly onCloseTab: (tabId: string) => void
  readonly onNavigate: (tabId: string, url: string) => void
  readonly onOpenTab: (url: string) => void
  readonly onPresentationChange: (
    presentation: PreviewPresentation | null,
  ) => void
  readonly onSelectTab: (tabId: string) => void
  readonly snapshot: WorkspacePreviewSnapshot | null
}

export default function PreviewPane({
  onBrowserControl,
  onCloseTab,
  onNavigate,
  onOpenTab,
  onPresentationChange,
  onSelectTab,
  snapshot,
}: PreviewPaneProps) {
  const browserSlotRef = useRef<HTMLDivElement | null>(null)
  const activeTab = snapshot?.tabs.find(
    (tab) => tab.id === snapshot.activeTabId,
  )
  const [draftTarget, setDraftTarget] = useState(activeTab?.url ?? '')

  useEffect(() => {
    setDraftTarget(activeTab?.url ?? '')
  }, [activeTab?.url])

  useEffect(() => {
    const browserSlot = browserSlotRef.current
    if (!browserSlot || !snapshot || !activeTab) {
      onPresentationChange(null)
      return
    }

    const updatePresentation = () => {
      const rect = browserSlot.getBoundingClientRect()
      onPresentationChange({
        height: rect.height,
        tabId: activeTab.id,
        width: rect.width,
        workspaceId: snapshot.workspaceId,
        x: rect.x,
        y: rect.y,
      })
    }
    const observer = new ResizeObserver(updatePresentation)
    observer.observe(browserSlot)
    window.addEventListener('scroll', updatePresentation, true)
    updatePresentation()

    return () => {
      observer.disconnect()
      window.removeEventListener('scroll', updatePresentation, true)
      onPresentationChange(null)
    }
  }, [activeTab, onPresentationChange, snapshot])

  const normalizedDraftTarget = useMemo(
    () => normalizePreviewUrl(draftTarget),
    [draftTarget],
  )
  const isAllowedTarget = isAllowedPreviewUrl(normalizedDraftTarget)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border bg-surface p-4">
      <div className="flex h-[var(--pane-header-h)] shrink-0 items-center justify-between gap-3">
        <p className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
          Local preview
        </p>
        <Chip size="sm" variant="secondary">
          loopback only
        </Chip>
      </div>

      <p className="mb-3 text-sm text-muted-foreground">
        Persistent local tabs are restricted to loopback http(s) targets.
      </p>

      <div className="mb-3 flex flex-wrap items-end gap-2">
        <Input
          aria-label="Preview target"
          className="min-w-[18rem] flex-1"
          onChange={(event) => setDraftTarget(event.target.value)}
          placeholder="localhost:3000"
          value={draftTarget}
          variant="secondary"
        />
        <Button
          className="rounded-pill px-[22px] py-[11px]"
          isDisabled={!isAllowedTarget}
          onPress={() => {
            if (activeTab?.url === normalizedDraftTarget) {
              onNavigate(activeTab.id, normalizedDraftTarget)
            } else {
              onOpenTab(normalizedDraftTarget)
            }
          }}
          variant="primary"
        >
          Load preview
        </Button>
        <Button
          aria-label="Open preview tab"
          isIconOnly
          isDisabled={!isAllowedTarget}
          onPress={() => onOpenTab(normalizedDraftTarget)}
          variant="ghost"
        >
          <Plus className="size-4" />
        </Button>
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {snapshot?.tabs.map((tab) => (
          <div
            className="flex overflow-hidden rounded-md border border-border"
            key={tab.id}
          >
            <Button
              data-testid={`preview-target-${tab.id}`}
              onPress={() => onSelectTab(tab.id)}
              size="sm"
              variant={tab.id === snapshot.activeTabId ? 'secondary' : 'ghost'}
            >
              {tab.title || tab.label}
            </Button>
            <Button
              aria-label={`Close ${tab.label}`}
              isIconOnly
              onPress={() => onCloseTab(tab.id)}
              size="sm"
              variant="ghost"
            >
              <X className="size-3" />
            </Button>
          </div>
        ))}
      </div>

      <div className="mb-3 flex items-center gap-1">
        <Button
          aria-label="Back"
          isDisabled={!activeTab?.canGoBack}
          isIconOnly
          onPress={() => onBrowserControl('back')}
          size="sm"
          variant="ghost"
        >
          <ChevronLeft className="size-4" />
        </Button>
        <Button
          aria-label="Forward"
          isDisabled={!activeTab?.canGoForward}
          isIconOnly
          onPress={() => onBrowserControl('forward')}
          size="sm"
          variant="ghost"
        >
          <ChevronRight className="size-4" />
        </Button>
        <Button
          aria-label="Reload preview"
          isIconOnly
          onPress={() => onBrowserControl('reload')}
          size="sm"
          variant="ghost"
        >
          <RefreshCw className="size-4" />
        </Button>
        <span
          className="ml-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground"
          data-testid="preview-active-target"
        >
          {activeTab?.url ?? 'No active preview target'}
        </span>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border border-border bg-background">
        <div className="h-full w-full" ref={browserSlotRef} />
        {activeTab?.navStatus === 'loading' ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 h-0.5 animate-pulse bg-accent-blue" />
        ) : null}
        {activeTab?.navStatus === 'load-failed' ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/90 p-6 text-center text-sm text-muted-foreground">
            <p>{activeTab.error || 'The local preview could not be loaded.'}</p>
            <Button onPress={() => onBrowserControl('reload')} size="sm">
              Retry
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

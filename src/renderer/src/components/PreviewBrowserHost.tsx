import { useCallback, useEffect, useRef } from 'react'

import type {
  PreviewNavStatus,
  WorkspacePreviewSnapshot,
} from '../../../shared/preview'
import { isAllowedPreviewUrl } from '../../../shared/preview'

export interface PreviewPresentation {
  height: number
  tabId: string
  width: number
  workspaceId: string
  x: number
  y: number
}

export type PreviewBrowserControl = 'back' | 'forward' | 'reload'

interface PreviewBrowserHostProps {
  readonly action: { id: number; type: PreviewBrowserControl } | null
  readonly presentation: PreviewPresentation | null
  readonly snapshots: Record<string, WorkspacePreviewSnapshot>
}

interface PreviewWebviewElement extends HTMLElement {
  canGoBack: () => boolean
  canGoForward: () => boolean
  getTitle: () => string
  getURL: () => string
  goBack: () => void
  goForward: () => void
  reload: () => void
}

interface PreviewGuestProps {
  readonly isVisible: boolean
  readonly presentation: PreviewPresentation | null
  readonly revision: number
  readonly setWebview: (webview: PreviewWebviewElement | null) => void
  readonly tab: WorkspacePreviewSnapshot['tabs'][number]
  readonly workspaceId: string
}

function getPresentationStyle(
  isVisible: boolean,
  presentation: PreviewPresentation | null,
): Record<string, string | number> {
  if (!isVisible || !presentation) {
    return {
      height: 1,
      left: -10_000,
      position: 'fixed',
      top: -10_000,
      width: 1,
    }
  }

  return {
    height: presentation.height,
    left: presentation.x,
    position: 'fixed',
    top: presentation.y,
    width: presentation.width,
    zIndex: 20,
  }
}

function PreviewGuest({
  isVisible,
  presentation,
  revision,
  setWebview,
  tab,
  workspaceId,
}: PreviewGuestProps) {
  const webviewRef = useRef<PreviewWebviewElement | null>(null)
  const report = useCallback(
    (status: PreviewNavStatus, error: string | null = null) => {
      const webview = webviewRef.current
      const url = webview?.getURL() || tab.url

      if (!isAllowedPreviewUrl(url)) {
        return
      }

      void window.aide.reportPreviewNavigation({
        canGoBack: webview?.canGoBack() ?? false,
        canGoForward: webview?.canGoForward() ?? false,
        error,
        expectedRevision: revision,
        status,
        tabId: tab.id,
        title: webview?.getTitle() || null,
        url,
        workspaceId,
      })
    },
    [revision, tab.id, tab.url, workspaceId],
  )

  useEffect(() => {
    const webview = webviewRef.current
    if (!webview) return

    const reportFailure = (event: Event) => {
      const detail = event as Event & {
        errorCode?: number
        errorDescription?: string
      }
      if (detail.errorCode !== -3) {
        report(
          'load-failed',
          detail.errorDescription ?? 'Preview failed to load.',
        )
      }
    }
    const reportReady = () => report('success')
    const reportLoading = () => report('loading')

    webview.addEventListener('did-fail-load', reportFailure)
    webview.addEventListener('did-navigate', reportReady)
    webview.addEventListener('did-navigate-in-page', reportReady)
    webview.addEventListener('did-start-loading', reportLoading)
    webview.addEventListener('did-stop-loading', reportReady)
    webview.addEventListener('page-title-updated', reportReady)

    return () => {
      webview.removeEventListener('did-fail-load', reportFailure)
      webview.removeEventListener('did-navigate', reportReady)
      webview.removeEventListener('did-navigate-in-page', reportReady)
      webview.removeEventListener('did-start-loading', reportLoading)
      webview.removeEventListener('did-stop-loading', reportReady)
      webview.removeEventListener('page-title-updated', reportReady)
    }
  }, [report])

  return (
    <webview
      aria-label={`Preview ${tab.label}`}
      partition="persist:aide-preview"
      ref={(node: PreviewWebviewElement | null) => {
        webviewRef.current = node
        setWebview(node)
      }}
      src={tab.url}
      style={getPresentationStyle(isVisible, presentation)}
    />
  )
}

export default function PreviewBrowserHost({
  action,
  presentation,
  snapshots,
}: PreviewBrowserHostProps) {
  const webviewsRef = useRef(new Map<string, PreviewWebviewElement>())

  useEffect(() => {
    if (!action || !presentation) {
      return
    }

    const webview = webviewsRef.current.get(
      `${presentation.workspaceId}:${presentation.tabId}`,
    )

    if (!webview) {
      return
    }

    if (action.type === 'back' && webview.canGoBack()) {
      webview.goBack()
    }
    if (action.type === 'forward' && webview.canGoForward()) {
      webview.goForward()
    }
    if (action.type === 'reload') {
      webview.reload()
    }
  }, [action, presentation])

  return (
    <>
      {Object.values(snapshots).flatMap((snapshot) =>
        snapshot.tabs.map((tab) => {
          const key = `${snapshot.workspaceId}:${tab.id}`
          const isVisible =
            presentation?.workspaceId === snapshot.workspaceId &&
            presentation.tabId === tab.id

          return (
            <PreviewGuest
              key={key}
              isVisible={isVisible}
              presentation={presentation}
              revision={snapshot.revision}
              setWebview={(node) => {
                if (node) {
                  webviewsRef.current.set(key, node)
                } else {
                  webviewsRef.current.delete(key)
                }
              }}
              tab={tab}
              workspaceId={snapshot.workspaceId}
            />
          )
        }),
      )}
    </>
  )
}

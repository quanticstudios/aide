export type PreviewNavStatus = 'idle' | 'loading' | 'success' | 'load-failed'

export interface PreviewTabSnapshot {
  canGoBack: boolean
  canGoForward: boolean
  error: string | null
  id: string
  label: string
  navStatus: PreviewNavStatus
  title: string | null
  updatedAt: string
  url: string
  workspaceId: string
}

export interface WorkspacePreviewSnapshot {
  activeTabId: string | null
  initialized: boolean
  revision: number
  tabs: PreviewTabSnapshot[]
  workspaceId: string
}

export interface WorkspacePreviewEvent {
  revision: number
  snapshot: WorkspacePreviewSnapshot
}

export interface PreviewNavigationReport {
  canGoBack: boolean
  canGoForward: boolean
  error?: string | null
  expectedRevision: number
  status: PreviewNavStatus
  tabId: string
  title?: string | null
  url: string
  workspaceId: string
}

export const DEFAULT_PREVIEW_URL = 'http://127.0.0.1:4173'

export function normalizePreviewUrl(value: string): string {
  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return DEFAULT_PREVIEW_URL
  }

  const candidate = /^https?:\/\//i.test(trimmedValue)
    ? trimmedValue
    : `http://${trimmedValue}`
  const url = new URL(candidate)

  return `${url.protocol}//${url.host}${url.pathname === '/' ? '' : url.pathname}${url.search}${url.hash}`
}

export function isAllowedPreviewUrl(value: string): boolean {
  if (value.length > 2048) {
    return false
  }

  try {
    const url = new URL(value)

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return false
    }

    if (url.username || url.password) {
      return false
    }

    return ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname)
  } catch {
    return false
  }
}

export function normalizeAllowedPreviewUrl(value: string): string {
  if (value.length > 2048) {
    throw new Error('Preview URLs cannot exceed 2,048 characters.')
  }

  const normalizedUrl = normalizePreviewUrl(value)

  if (!isAllowedPreviewUrl(normalizedUrl)) {
    throw new Error('Preview URLs must be local http(s) loopback targets.')
  }

  return normalizedUrl
}

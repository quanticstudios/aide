import { useEffect, useState } from 'react'

import type { AideApi } from '../../../shared/ipc'

const DEFAULT_POLL_INTERVAL_MS = 15_000

export interface WorkspaceGitInfo {
  readonly aheadCount: number | null
  readonly behindCount: number | null
  readonly branchName: string | null
  readonly dirtyCount: number | null
  readonly error: string | null
}

interface UseWorkspaceGitStatusOptions {
  readonly pollIntervalMs?: number
}

function getAideApi(): AideApi | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.aide ?? null
}

const EMPTY_INFO: WorkspaceGitInfo = {
  aheadCount: null,
  behindCount: null,
  branchName: null,
  dirtyCount: null,
  error: null,
}

export function useWorkspaceGitStatus(
  workspaceId: string | null,
  options: UseWorkspaceGitStatusOptions = {},
): WorkspaceGitInfo {
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS
  const [info, setInfo] = useState<WorkspaceGitInfo>(EMPTY_INFO)

  useEffect(() => {
    if (!workspaceId) {
      setInfo(EMPTY_INFO)
      return
    }

    const api = getAideApi()
    if (!api) {
      return
    }

    let cancelled = false

    const fetchOnce = async () => {
      try {
        const [status, stats] = await Promise.all([
          api.getWorkspaceGitStatus(workspaceId),
          api.getWorktreeBranchStats(workspaceId),
        ])

        if (cancelled) {
          return
        }

        const branchName = status.ok ? status.status.branchName : null
        const dirtyCount = status.ok ? status.status.files.length : null
        const aheadCount = stats.ok ? stats.stats.aheadCount : null
        const behindCount = stats.ok ? stats.stats.behindCount : null

        const error = status.ok ? (stats.ok ? null : stats.error) : status.error

        setInfo({
          aheadCount,
          behindCount,
          branchName,
          dirtyCount,
          error,
        })
      } catch (unknownError) {
        if (!cancelled) {
          setInfo({
            ...EMPTY_INFO,
            error:
              unknownError instanceof Error
                ? unknownError.message
                : 'Failed to read git status',
          })
        }
      }
    }

    void fetchOnce()

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void fetchOnce()
      }
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        void fetchOnce()
      }
    }, pollIntervalMs)

    return () => {
      cancelled = true
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [workspaceId, pollIntervalMs])

  return info
}

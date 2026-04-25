import { useEffect, useState } from 'react'

import type { AideApi } from '../../../shared/ipc'
import type { ManagedProviderRuntimeSessionState } from '../../../shared/provider-runtime'

function getAideApi(): AideApi | null {
  if (typeof window === 'undefined') {
    return null
  }

  return window.aide ?? null
}

export function useManagedSessionState(
  sessionId: string | null,
): ManagedProviderRuntimeSessionState | null {
  const [state, setState] = useState<ManagedProviderRuntimeSessionState | null>(
    null,
  )

  useEffect(() => {
    if (!sessionId) return

    const api = getAideApi()
    if (!api) return

    void (async () => {
      try {
        const snapshots = await api.getManagedSessionSnapshots()
        const existing = snapshots[sessionId]
        if (existing) {
          setState(existing.sessionState)
        }
      } catch {
        /* no session yet */
      }
    })()

    return api.onManagedSessionEvent((event) => {
      if (event.type === 'removed') {
        if (event.sessionId === sessionId) {
          setState(null)
        }
        return
      }

      if (event.snapshot.sessionId === sessionId) {
        setState(event.snapshot.sessionState)
      }
    })
  }, [sessionId])

  return state
}

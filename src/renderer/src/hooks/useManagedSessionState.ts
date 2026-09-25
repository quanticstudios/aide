import { useEffect, useRef, useState } from 'react'

import type { AideApi } from '../../../shared/ipc'
import type { ManagedProviderRuntimeSessionState } from '../../../shared/provider-runtime'
import { subscribeManagedSession } from '../lib/managed-session-events'

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
  const revisionRef = useRef({ revision: -1, runtimeGeneration: -1 })

  useEffect(() => {
    if (!sessionId) return

    const api = getAideApi()
    if (!api) return

    const applySnapshot = (snapshot: {
      revision: number
      runtimeGeneration: number
      sessionState: ManagedProviderRuntimeSessionState
    }) => {
      const current = revisionRef.current
      if (
        snapshot.runtimeGeneration < current.runtimeGeneration ||
        (snapshot.runtimeGeneration === current.runtimeGeneration &&
          snapshot.revision <= current.revision)
      ) {
        return
      }
      revisionRef.current = {
        revision: snapshot.revision,
        runtimeGeneration: snapshot.runtimeGeneration,
      }
      setState(snapshot.sessionState)
    }

    const unsubscribe = subscribeManagedSession(api, sessionId, (update) => {
      if (update.type === 'removed') {
        revisionRef.current = { revision: -1, runtimeGeneration: -1 }
        setState(null)
        return
      }

      applySnapshot(update.snapshot)
    })

    void api.getManagedSessionSnapshots().then((snapshots) => {
      const existing = snapshots[sessionId]
      if (existing) {
        applySnapshot(existing)
      }
    })

    return unsubscribe
  }, [sessionId])

  return state
}

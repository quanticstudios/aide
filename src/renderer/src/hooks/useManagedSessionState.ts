import { useEffect, useRef, useState } from 'react'

import type { ManagedProviderRuntimeSessionState } from '../../../shared/provider-runtime'
import { getSessionTransport } from '../lib/session-transport'

export function useManagedSessionState(
  sessionId: string | null,
): ManagedProviderRuntimeSessionState | null {
  const [state, setState] = useState<ManagedProviderRuntimeSessionState | null>(
    null,
  )
  const revisionRef = useRef({ revision: -1, runtimeGeneration: -1 })

  useEffect(() => {
    if (!sessionId) return
    revisionRef.current = { revision: -1, runtimeGeneration: -1 }

    const transport = getSessionTransport()
    if (!transport) return

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

    const unsubscribe = transport.subscribeSession(sessionId, (update) => {
      if (update.type === 'removed') {
        revisionRef.current = { revision: -1, runtimeGeneration: -1 }
        setState(null)
        return
      }

      applySnapshot(update.snapshot)
    })

    void transport.getSessions().then((snapshots) => {
      const existing = snapshots[sessionId]
      if (existing) {
        applySnapshot(existing)
      }
    })

    return unsubscribe
  }, [sessionId])

  return state
}

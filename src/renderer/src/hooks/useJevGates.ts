import { useCallback, useEffect, useState } from 'react'

import type {
  JevGateOverrides,
  JevGateScope,
  JevGateSnapshot,
} from '../../../shared/jev-gates'

export interface JevGatesState {
  readonly gates: JevGateSnapshot | null
  readonly updateGates: (
    scope: JevGateScope,
    overrides: JevGateOverrides,
  ) => void
}

/** Holds the merged gate layers for one workspace so every gate surface reads the same snapshot. */
export function useJevGates(workspaceId: string | null): JevGatesState {
  const [gates, setGates] = useState<JevGateSnapshot | null>(null)

  useEffect(() => {
    let isCurrent = true
    void window.aide
      ?.getJevGates(workspaceId)
      .then((snapshot) => {
        if (isCurrent) setGates(snapshot)
      })
      .catch(() => {
        if (isCurrent) setGates(null)
      })

    return () => {
      isCurrent = false
    }
  }, [workspaceId])

  const updateGates = useCallback(
    (scope: JevGateScope, overrides: JevGateOverrides) => {
      void window.aide
        ?.updateJevGates(scope, workspaceId, overrides)
        .then(setGates)
        .catch(() => undefined)
    },
    [workspaceId],
  )

  return { gates, updateGates }
}

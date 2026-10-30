import { describe, expect, it } from 'vitest'

import { PersistenceOperationGate } from './persistence-operation-gate'

describe('PersistenceOperationGate', () => {
  it('rejects new work after quiescing and drains an in-flight async operation', async () => {
    const gate = new PersistenceOperationGate()
    let finishOperation: (() => void) | undefined
    const operation = gate.run(
      () =>
        new Promise<void>((resolve) => {
          finishOperation = resolve
        }),
    )
    const drained = gate.quiesce()

    await expect(gate.run(() => undefined)).rejects.toThrow(
      'Aide is shutting down',
    )

    let drainedBeforeOperation = false
    void drained.then(() => {
      drainedBeforeOperation = true
    })
    await Promise.resolve()
    expect(drainedBeforeOperation).toBe(false)

    finishOperation?.()
    await operation
    await drained
    expect(drainedBeforeOperation).toBe(true)
  })

  it('starts admitted synchronous work before a concurrent quiesce can close sessions', async () => {
    const gate = new PersistenceOperationGate()
    const events: string[] = []

    const operation = gate.run(() => {
      events.push('session opened')
    })
    const drained = gate.quiesce()

    expect(events).toEqual(['session opened'])
    await operation
    await drained
  })
})

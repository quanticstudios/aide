import { describe, expect, it } from 'vitest'

import {
  anyJevGateEnabled,
  JEV_GATE_DEFAULTS,
  JevGateOverridesSchema,
  resolveJevGates,
} from './jev-gates'

describe('resolveJevGates', () => {
  it('returns defaults with no layers and keeps them untouched', () => {
    const resolved = resolveJevGates()
    expect(resolved).toEqual(JEV_GATE_DEFAULTS)
    expect(resolved).not.toBe(JEV_GATE_DEFAULTS)
    expect(anyJevGateEnabled(resolved)).toBe(false)
  })

  it('lets later layers override earlier ones per field', () => {
    const resolved = resolveJevGates(
      { toolGate: { enabled: true, allowBelow: 0.2 } },
      undefined,
      { toolGate: { denyAbove: 0.8 }, completionCheck: { enabled: true } },
    )
    expect(resolved.toolGate).toEqual({
      enabled: true,
      allowBelow: 0.2,
      denyAbove: 0.8,
    })
    expect(resolved.completionCheck.enabled).toBe(true)
    expect(resolved.laneRouting).toEqual(JEV_GATE_DEFAULTS.laneRouting)
  })

  it('clamps an allow bar that crosses the deny bar', () => {
    const resolved = resolveJevGates({
      toolGate: { allowBelow: 0.95, denyAbove: 0.5 },
      laneRouting: { highAbove: 0.9, criticalAbove: 0.7 },
    })
    expect(resolved.toolGate.allowBelow).toBe(0.5)
    expect(resolved.laneRouting.highAbove).toBe(0.7)
  })

  it('rejects unknown fields and out-of-range probabilities', () => {
    expect(
      JevGateOverridesSchema.safeParse({ toolGate: { allowBelow: 1.5 } })
        .success,
    ).toBe(false)
    expect(JevGateOverridesSchema.safeParse({ other: {} }).success).toBe(false)
    expect(JevGateOverridesSchema.safeParse({}).success).toBe(true)
  })
})

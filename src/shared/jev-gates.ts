import { z } from 'zod'

/** Effective Jev gate settings after global, workspace, and chat layers are merged. */
export interface JevGateSettings {
  /** Auto-resolves tool approvals when Jev is confident; the middle band still prompts. */
  toolGate: { enabled: boolean; allowBelow: number; denyAbove: number }
  /** Raises the fleet risk class from Jev risk judgments before an agent is dispatched. */
  laneRouting: { enabled: boolean; highAbove: number; criticalAbove: number }
  /** Flags an agent result that fails Jev completion checks before the orchestrator reads it. */
  completionCheck: { enabled: boolean; minPass: number }
}

/** One layer of overrides; an omitted field inherits the layer below. */
export type JevGateOverrides = {
  readonly [Section in keyof JevGateSettings]?: Partial<
    JevGateSettings[Section]
  >
}

export type JevGateScope = 'global' | 'workspace'

export interface JevGateSnapshot {
  effective: JevGateSettings
  global: JevGateOverrides
  workspace: JevGateOverrides
}

export const JEV_GATE_DEFAULTS: JevGateSettings = {
  toolGate: { enabled: false, allowBelow: 0.1, denyAbove: 0.9 },
  laneRouting: { enabled: false, highAbove: 0.6, criticalAbove: 0.85 },
  completionCheck: { enabled: false, minPass: 0.5 },
}

const probability = z.number().min(0).max(1)

export const JevGateOverridesSchema = z
  .object({
    toolGate: z
      .object({
        enabled: z.boolean().optional(),
        allowBelow: probability.optional(),
        denyAbove: probability.optional(),
      })
      .strict()
      .optional(),
    laneRouting: z
      .object({
        enabled: z.boolean().optional(),
        highAbove: probability.optional(),
        criticalAbove: probability.optional(),
      })
      .strict()
      .optional(),
    completionCheck: z
      .object({
        enabled: z.boolean().optional(),
        minPass: probability.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()

/** Merges override layers onto the defaults; later layers win and a low bar never crosses its high bar. */
export function resolveJevGates(
  ...layers: readonly (JevGateOverrides | undefined)[]
): JevGateSettings {
  const merged = structuredClone(JEV_GATE_DEFAULTS)
  for (const layer of layers) {
    if (!layer) continue
    Object.assign(merged.toolGate, layer.toolGate)
    Object.assign(merged.laneRouting, layer.laneRouting)
    Object.assign(merged.completionCheck, layer.completionCheck)
  }
  if (merged.toolGate.allowBelow > merged.toolGate.denyAbove)
    merged.toolGate.allowBelow = merged.toolGate.denyAbove
  if (merged.laneRouting.highAbove > merged.laneRouting.criticalAbove)
    merged.laneRouting.highAbove = merged.laneRouting.criticalAbove
  return merged
}

export function anyJevGateEnabled(settings: JevGateSettings): boolean {
  return (
    settings.toolGate.enabled ||
    settings.laneRouting.enabled ||
    settings.completionCheck.enabled
  )
}

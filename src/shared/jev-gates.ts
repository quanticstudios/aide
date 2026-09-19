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

export type JevGateSection = keyof JevGateSettings

interface JevGateThresholdField {
  /** Field on the gate section. */
  readonly field: string
  /** Label beside the threshold input. */
  readonly label: string
  /** Prefix and comparator used in the one-line threshold summary. */
  readonly summary: string
}

interface JevGateRow {
  readonly description: string
  readonly label: string
  readonly section: JevGateSection
  readonly thresholds: readonly JevGateThresholdField[]
}

/** The three gates in pipeline order, with the labels every gate surface renders. */
export const JEV_GATE_ROWS: readonly JevGateRow[] = [
  {
    section: 'laneRouting',
    label: 'Lane routing',
    description:
      'Raise the fleet risk class from Jev risk judgments before an agent is consulted.',
    thresholds: [
      { field: 'highAbove', label: 'High risk at or above', summary: 'high ≥' },
      {
        field: 'criticalAbove',
        label: 'Critical at or above',
        summary: 'critical ≥',
      },
    ],
  },
  {
    section: 'toolGate',
    label: 'Tool call gate',
    description:
      'Auto-allow or deny tool approvals when Jev is confident. The middle band still asks you.',
    thresholds: [
      { field: 'allowBelow', label: 'Allow below', summary: 'allow <' },
      { field: 'denyAbove', label: 'Deny at or above', summary: 'deny ≥' },
    ],
  },
  {
    section: 'completionCheck',
    label: 'Completion check',
    description:
      'Flag an agent result that misses the request, claims unverified work, or leaks a secret.',
    thresholds: [
      { field: 'minPass', label: 'Minimum pass', summary: 'pass ≥' },
    ],
  },
]

/** Renders one gate's effective thresholds as "allow < 0.10, deny ≥ 0.90". */
export function formatJevGateThresholds(
  settings: JevGateSettings,
  section: JevGateSection,
): string {
  const row = JEV_GATE_ROWS.find((candidate) => candidate.section === section)
  const values = settings[section] as unknown as Record<string, number>
  return (row?.thresholds ?? [])
    .map(
      (threshold) =>
        `${threshold.summary} ${values[threshold.field].toFixed(2)}`,
    )
    .join(', ')
}

/** Sets one override field on a layer; an undefined value drops the field and any section it empties. */
export function withJevGateOverride(
  layer: JevGateOverrides,
  section: JevGateSection,
  field: string,
  next: boolean | number | undefined,
): JevGateOverrides {
  const current: Record<string, boolean | number> = {
    ...(layer[section] as Record<string, boolean | number> | undefined),
  }
  if (next === undefined) delete current[field]
  else current[field] = next
  const updated: Record<string, unknown> = { ...layer }
  if (Object.keys(current).length > 0) updated[section] = current
  else delete updated[section]
  return updated as JevGateOverrides
}

import { Input, ListBox, Select } from '@heroui/react'
import { useId } from 'react'
import type {
  JevGateOverrides,
  JevGateSettings,
} from '../../../shared/jev-gates'

type Section = keyof JevGateSettings

interface ThresholdField {
  readonly field: string
  readonly label: string
}

interface GateRow {
  readonly description: string
  readonly label: string
  readonly section: Section
  readonly thresholds: readonly ThresholdField[]
}

export const JEV_GATE_ROWS: readonly GateRow[] = [
  {
    section: 'toolGate',
    label: 'Tool call gate',
    description:
      'Auto-allow or deny tool approvals when Jev is confident. The middle band still asks you.',
    thresholds: [
      { field: 'allowBelow', label: 'Allow below' },
      { field: 'denyAbove', label: 'Deny at or above' },
    ],
  },
  {
    section: 'laneRouting',
    label: 'Lane routing',
    description:
      'Raise the fleet risk class from Jev risk judgments before an agent is consulted.',
    thresholds: [
      { field: 'highAbove', label: 'High risk at or above' },
      { field: 'criticalAbove', label: 'Critical at or above' },
    ],
  },
  {
    section: 'completionCheck',
    label: 'Completion check',
    description:
      'Flag an agent result that misses the request, claims unverified work, or leaks a secret.',
    thresholds: [{ field: 'minPass', label: 'Minimum pass' }],
  },
]

interface JevGateControlsProps {
  readonly effective: JevGateSettings
  readonly inheritLabel: string
  readonly isDisabled?: boolean
  readonly onChange: (next: JevGateOverrides) => void
  readonly value: JevGateOverrides
}

function withField(
  value: JevGateOverrides,
  section: Section,
  field: string,
  next: boolean | number | undefined,
): JevGateOverrides {
  const current: Record<string, boolean | number> = {
    ...(value[section] as Record<string, boolean | number> | undefined),
  }
  if (next === undefined) delete current[field]
  else current[field] = next
  const copy: Record<string, unknown> = { ...value }
  if (Object.keys(current).length) copy[section] = current
  else delete copy[section]
  return copy as JevGateOverrides
}

/** Edits one layer of Jev gate overrides; blank fields inherit the layer below. */
export default function JevGateControls({
  effective,
  inheritLabel,
  isDisabled = false,
  onChange,
  value,
}: JevGateControlsProps) {
  const idBase = useId()
  return (
    <div className="divide-y divide-border rounded-lg border border-border bg-surface-2">
      {JEV_GATE_ROWS.map((row) => {
        const section = value[row.section] as
          | Record<string, boolean | number>
          | undefined
        const enabled = section?.enabled
        const enabledId =
          enabled === undefined ? 'inherit' : enabled ? 'on' : 'off'
        const effectiveSection = effective[row.section] as unknown as Record<
          string,
          boolean | number
        >
        return (
          <div className="flex flex-col gap-3 px-4 py-3" key={row.section}>
            <div className="flex items-center justify-between gap-4">
              <span className="min-w-0">
                <span className="block text-[13px] font-medium leading-5">
                  {row.label}
                </span>
                <span className="block text-[12px] leading-4 text-muted-foreground">
                  {row.description}
                </span>
              </span>
              <Select
                aria-label={`${row.label} enabled`}
                className="w-44 shrink-0"
                isDisabled={isDisabled}
                onChange={(id) => {
                  if (id !== 'inherit' && id !== 'on' && id !== 'off') return
                  onChange(
                    withField(
                      value,
                      row.section,
                      'enabled',
                      id === 'inherit' ? undefined : id === 'on',
                    ),
                  )
                }}
                value={enabledId}
              >
                <Select.Trigger className="h-8 min-h-8 rounded-lg bg-surface-3 text-[13px]">
                  <Select.Value />
                  <Select.Indicator />
                </Select.Trigger>
                <Select.Popover className="z-[70] min-w-44">
                  <ListBox aria-label={`${row.label} options`}>
                    <ListBox.Item
                      id="inherit"
                      textValue={`${inheritLabel} (${effectiveSection.enabled ? 'on' : 'off'})`}
                    >
                      {inheritLabel} ({effectiveSection.enabled ? 'on' : 'off'}
                      )
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item id="on" textValue="On">
                      On
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                    <ListBox.Item id="off" textValue="Off">
                      Off
                      <ListBox.ItemIndicator />
                    </ListBox.Item>
                  </ListBox>
                </Select.Popover>
              </Select>
            </div>
            <div className="flex flex-wrap gap-3">
              {row.thresholds.map((threshold) => (
                <label
                  className="flex items-center gap-2 text-[12px] text-muted-foreground"
                  htmlFor={`${idBase}-${row.section}-${threshold.field}`}
                  key={threshold.field}
                >
                  {threshold.label}
                  <Input
                    aria-label={`${row.label}: ${threshold.label}`}
                    id={`${idBase}-${row.section}-${threshold.field}`}
                    className="w-20 rounded border border-border bg-surface px-2 py-1 text-[13px] text-foreground"
                    disabled={isDisabled}
                    max={1}
                    min={0}
                    onChange={(event) => {
                      const raw = event.target.value.trim()
                      const parsed = raw === '' ? Number.NaN : Number(raw)
                      onChange(
                        withField(
                          value,
                          row.section,
                          threshold.field,
                          Number.isFinite(parsed)
                            ? Math.min(1, Math.max(0, parsed))
                            : undefined,
                        ),
                      )
                    }}
                    placeholder={String(effectiveSection[threshold.field])}
                    step={0.05}
                    type="number"
                    value={
                      section?.[threshold.field] === undefined
                        ? ''
                        : String(section[threshold.field])
                    }
                  />
                </label>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

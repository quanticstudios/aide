import { Tooltip } from '@heroui/react'
import type { ReactNode } from 'react'

interface IconTooltipProps {
  readonly children: ReactNode
  readonly label: ReactNode
  readonly placement?: 'bottom' | 'left' | 'right' | 'top'
}

export default function IconTooltip({
  children,
  label,
  placement = 'bottom',
}: IconTooltipProps) {
  return (
    <Tooltip closeDelay={0} delay={350}>
      <Tooltip.Trigger className="flex shrink-0" role="none" tabIndex={-1}>
        {children}
      </Tooltip.Trigger>
      <Tooltip.Content
        className="rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs font-medium text-foreground shadow-md"
        placement={placement}
      >
        {label}
      </Tooltip.Content>
    </Tooltip>
  )
}

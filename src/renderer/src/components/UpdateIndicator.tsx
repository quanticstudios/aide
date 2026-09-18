import { Button } from '@heroui/react'
import {
  AlertTriangle,
  Download,
  LoaderCircle,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react'

import type { UpdatePresentation } from '../lib/update-presentation'
import { cn } from '../lib/utils'

interface UpdateIndicatorProps {
  readonly onOpen: () => void
  readonly presentation: UpdatePresentation
}

const TONE_CLASSES: Record<UpdatePresentation['tone'], string> = {
  critical:
    'border-accent-red/50 bg-accent-red-soft text-accent-red hover:bg-accent-red-soft/80',
  danger:
    'border-accent-red/50 bg-accent-red-soft text-accent-red hover:bg-accent-red-soft/80',
  info: 'border-accent-blue/45 bg-accent-blue-soft text-accent-blue hover:bg-accent-blue-soft/80',
  neutral:
    'border-border bg-surface-secondary text-foreground hover:bg-surface-tertiary',
  success:
    'border-accent-green/45 bg-accent-green-soft text-accent-green hover:bg-accent-green-soft/80',
  warning:
    'border-accent-yellow/45 bg-accent-yellow-soft text-accent-yellow hover:bg-accent-yellow-soft/80',
}

function IndicatorIcon({
  presentation,
}: {
  readonly presentation: UpdatePresentation
}) {
  const className = 'size-4 shrink-0'

  switch (presentation.icon) {
    case 'critical':
      return <ShieldAlert aria-hidden="true" className={className} />
    case 'failed':
      return <AlertTriangle aria-hidden="true" className={className} />
    case 'ready':
      return <RefreshCw aria-hidden="true" className={className} />
    case 'downloading':
      return (
        <LoaderCircle
          aria-hidden="true"
          className={`${className} animate-spin`}
        />
      )
    case 'available':
      return <Download aria-hidden="true" className={className} />
    case 'privacy':
      return <ShieldCheck aria-hidden="true" className={className} />
    case 'idle':
      return <RefreshCw aria-hidden="true" className={className} />
  }
}

export default function UpdateIndicator({
  onOpen,
  presentation,
}: UpdateIndicatorProps) {
  if (!presentation.indicatorVisible) return null

  return (
    <div
      aria-atomic="true"
      aria-live={presentation.isCritical ? 'assertive' : 'polite'}
      role={presentation.isCritical ? 'alert' : 'status'}
    >
      <Button
        aria-label={`${presentation.indicatorLabel}. Open software update`}
        className={cn(
          'min-h-10 shrink-0 rounded-md border px-3 text-xs font-semibold',
          TONE_CLASSES[presentation.tone],
        )}
        data-testid="update-indicator"
        onPress={onOpen}
        size="sm"
        variant="ghost"
      >
        <IndicatorIcon presentation={presentation} />
        <span>{presentation.indicatorLabel}</span>
      </Button>
    </div>
  )
}

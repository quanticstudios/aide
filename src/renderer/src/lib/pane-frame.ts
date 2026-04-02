import { cn } from './utils'

export function getPaneFrameClassName(isActive: boolean): string {
  return cn(
    'flex min-h-0 min-w-0 flex-1 overflow-visible rounded-2xl border p-4',
    isActive
      ? 'border-primary/45 bg-surface shadow-[var(--surface-shadow)]'
      : 'border-border/70 bg-surface/70',
  )
}

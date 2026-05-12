import { cn } from './utils'

/**
 * Returns the className for a pane's outer frame.
 *
 * When the pane is the only pane on the surface (`isSole`), the frame drops
 * its border/radius/padding so the content fills the viewport edge-to-edge.
 * Split panes keep the chromed frame so the user can tell them apart.
 */
export function getPaneFrameClassName(
  isActive: boolean,
  isSole = false,
): string {
  if (isSole) {
    return 'flex min-h-0 min-w-0 w-full flex-1 overflow-visible bg-surface'
  }

  return cn(
    'flex min-h-0 min-w-0 w-full flex-1 overflow-visible rounded-lg border p-4 bg-surface',
    isActive ? 'border-[var(--border-strong)]' : 'border-border',
  )
}

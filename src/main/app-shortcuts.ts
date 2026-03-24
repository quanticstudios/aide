import type { Input } from 'electron'

import type { AppShortcutEvent } from '../shared/shortcuts'

export function mapInputToShortcutEvent(
  input: Pick<Input, 'alt' | 'code' | 'control' | 'key' | 'meta'>,
): AppShortcutEvent | null {
  const normalizedKey = input.key.toLowerCase()
  const normalizedCode = input.code?.toLowerCase() ?? ''
  const isAltOnly = input.alt && !input.control && !input.meta
  const isCtrlOnly = input.control && !input.alt && !input.meta

  if (
    isAltOnly &&
    (input.key === 'ArrowLeft' ||
      input.key === 'Left' ||
      normalizedCode === 'keyh' ||
      normalizedKey === 'h')
  ) {
    return { type: 'pane-previous' }
  }

  if (
    isAltOnly &&
    (input.key === 'ArrowRight' ||
      input.key === 'Right' ||
      normalizedCode === 'keyl' ||
      normalizedKey === 'l')
  ) {
    return { type: 'pane-next' }
  }

  if (
    isAltOnly &&
    (input.key === 'ArrowUp' ||
      input.key === 'Up' ||
      normalizedCode === 'keyk' ||
      normalizedKey === 'k')
  ) {
    return { type: 'workspace-previous' }
  }

  if (
    isAltOnly &&
    (input.key === 'ArrowDown' ||
      input.key === 'Down' ||
      normalizedCode === 'keyj' ||
      normalizedKey === 'j')
  ) {
    return { type: 'workspace-next' }
  }

  if (isCtrlOnly && /^[1-9]$/.test(input.key)) {
    return {
      projectIndex: Number(input.key) - 1,
      type: 'project-jump',
    }
  }

  return null
}

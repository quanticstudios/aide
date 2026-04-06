export type AppShortcutEvent =
  | { type: 'command-palette-open' }
  | { type: 'overview-open' }
  | { type: 'pane-create' }
  | { type: 'pane-next' }
  | { type: 'pane-previous' }
  | { type: 'workspace-next' }
  | { type: 'workspace-previous' }
  | { type: 'workspace-switcher-toggle' }
  | { projectIndex: number; type: 'project-jump' }

export interface ShortcutInput {
  alt: boolean
  code?: string | null
  control: boolean
  key: string
  meta: boolean
}

function matchesDirectionalShortcut(
  input: ShortcutInput,
  direction: 'left' | 'right' | 'up' | 'down',
): boolean {
  const normalizedKey = input.key.toLowerCase()
  const normalizedCode = input.code?.toLowerCase() ?? ''

  if (direction === 'left') {
    return (
      input.key === 'ArrowLeft' ||
      input.key === 'Left' ||
      normalizedCode === 'keyh' ||
      normalizedKey === 'h'
    )
  }

  if (direction === 'right') {
    return (
      input.key === 'ArrowRight' ||
      input.key === 'Right' ||
      normalizedCode === 'keyl' ||
      normalizedKey === 'l'
    )
  }

  if (direction === 'up') {
    return (
      input.key === 'ArrowUp' ||
      input.key === 'Up' ||
      normalizedCode === 'keyk' ||
      normalizedKey === 'k'
    )
  }

  return (
    input.key === 'ArrowDown' ||
    input.key === 'Down' ||
    normalizedCode === 'keyj' ||
    normalizedKey === 'j'
  )
}

function isMetaNavigationAlias(input: ShortcutInput): boolean {
  return (
    input.meta &&
    !input.alt &&
    !input.control &&
    (matchesDirectionalShortcut(input, 'left') ||
      matchesDirectionalShortcut(input, 'right') ||
      matchesDirectionalShortcut(input, 'up') ||
      matchesDirectionalShortcut(input, 'down'))
  )
}

export function mapShortcutInputToAppEvent(
  input: ShortcutInput,
): AppShortcutEvent | null {
  const normalizedKey = input.key.toLowerCase()
  const isAltOnly = input.alt && !input.control && !input.meta
  const isCtrlOnly = input.control && !input.alt && !input.meta
  const isOverviewChord =
    normalizedKey === 'tab' && !input.alt && (input.control || input.meta)

  if (isOverviewChord) {
    return { type: 'overview-open' }
  }

  if (isAltOnly && normalizedKey === ' ') {
    return { type: 'workspace-switcher-toggle' }
  }

  if (isCtrlOnly && normalizedKey === 'k') {
    return { type: 'command-palette-open' }
  }

  if (isAltOnly && normalizedKey === 'n') {
    return { type: 'pane-create' }
  }

  if (isAltOnly && matchesDirectionalShortcut(input, 'left')) {
    return { type: 'pane-previous' }
  }

  if (isAltOnly && matchesDirectionalShortcut(input, 'right')) {
    return { type: 'pane-next' }
  }

  if (isAltOnly && matchesDirectionalShortcut(input, 'up')) {
    return { type: 'workspace-previous' }
  }

  if (isAltOnly && matchesDirectionalShortcut(input, 'down')) {
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

export function shouldBlockTerminalShortcutInput(
  input: ShortcutInput,
): boolean {
  return (
    mapShortcutInputToAppEvent(input) !== null || isMetaNavigationAlias(input)
  )
}

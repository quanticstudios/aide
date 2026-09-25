export type AgentHotkeyAction =
  | 'interrupt'
  | 'open-effort-menu'
  | 'open-model-menu'
  | 'open-permission-menu'

export interface AgentHotkeyEvent {
  readonly altKey: boolean
  readonly ctrlKey: boolean
  readonly key: string
  readonly metaKey: boolean
  readonly shiftKey: boolean
}

export interface AgentHotkeyContext {
  readonly isMac: boolean
  readonly isMenuOpen: boolean
  readonly isTurnRunning: boolean
}

const MENU_KEYS: Record<string, AgentHotkeyAction> = {
  a: 'open-permission-menu',
  e: 'open-effort-menu',
  m: 'open-model-menu',
}

/** Maps an Agent-pane composer key event to the pane action it triggers. */
export function resolveAgentHotkey(
  event: AgentHotkeyEvent,
  context: AgentHotkeyContext,
): AgentHotkeyAction | null {
  if (event.key === 'Escape') {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) {
      return null
    }

    // why: the slash and mention menus own Escape before the running turn does.
    return !context.isMenuOpen && context.isTurnRunning ? 'interrupt' : null
  }

  const hasChordModifier = context.isMac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey

  // invariant: Alt stays free for the App-level workspace and pane navigation.
  if (!hasChordModifier || !event.shiftKey || event.altKey) {
    return null
  }

  return MENU_KEYS[event.key.toLowerCase()] ?? null
}

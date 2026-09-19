/**
 * Detect whether the host is macOS.
 *
 * `navigator.platform` is deprecated but still reliable on Electron renderers
 * where the user-agent / userAgentData detection paths can be unreliable.
 */
export function isMac(): boolean {
  if (typeof navigator === 'undefined') {
    return false
  }

  const platform = navigator.platform?.toLowerCase() ?? ''
  return platform.includes('mac') || platform.includes('iphone')
}

/**
 * Returns the keyboard shortcut label for the Nth workspace jump (1-based),
 * formatted for the current platform: `⌘N` on macOS, `Ctrl+N` elsewhere.
 *
 * The underlying shortcut handler in `App.tsx` listens to `event.ctrlKey`, but
 * macOS users expect a Command-key label.
 */
export function formatWorkspaceShortcutLabel(index1Based: number): string {
  if (index1Based < 1 || index1Based > 9) {
    return ''
  }

  return isMac() ? `⌘${index1Based}` : `Ctrl+${index1Based}`
}

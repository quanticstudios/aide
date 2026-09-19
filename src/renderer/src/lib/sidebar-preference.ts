const SIDEBAR_PIN_STORAGE_KEY = 'aide.sidebar.pinned'

/** Reads the app-wide sidebar state used when no workspace is selected. */
export function readGlobalSidebarOpen(): boolean {
  return window.localStorage.getItem(SIDEBAR_PIN_STORAGE_KEY) === 'true'
}

/** Stores the app-wide sidebar state. */
export function writeGlobalSidebarOpen(isOpen: boolean): void {
  window.localStorage.setItem(
    SIDEBAR_PIN_STORAGE_KEY,
    isOpen ? 'true' : 'false',
  )
}

/** Resolves the sidebar state a workspace should show. */
export function resolveSidebarOpen(
  workspaceSidebarOpen: boolean | null | undefined,
  globalSidebarOpen: boolean,
): boolean {
  return workspaceSidebarOpen ?? globalSidebarOpen
}

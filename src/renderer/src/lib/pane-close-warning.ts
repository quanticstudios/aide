export interface PaneCloseRequest {
  readonly paneId: string
  readonly shouldCloseViewOnly: boolean
  readonly workspaceId: string
}

export interface PaneCloseWarning {
  readonly detail: string
  readonly title: string
}

export type PaneCloseDecision =
  | { readonly kind: 'close'; readonly request: PaneCloseRequest }
  | {
      readonly kind: 'confirm'
      readonly request: PaneCloseRequest
      readonly warnings: readonly PaneCloseWarning[]
    }

const paneWarnings = new Map<string, PaneCloseWarning>()
const terminalPanesBySessionId = new Map<
  string,
  { readonly paneId: string; readonly workspaceId: string }
>()

function getPaneWarningKey(workspaceId: string, paneId: string): string {
  return `${workspaceId}\u0000${paneId}`
}

export function setPaneCloseWarning(
  workspaceId: string,
  paneId: string,
  warning: PaneCloseWarning | null,
): void {
  const key = getPaneWarningKey(workspaceId, paneId)

  if (warning) {
    paneWarnings.set(key, warning)
    return
  }

  paneWarnings.delete(key)
  for (const [sessionId, terminalPane] of terminalPanesBySessionId) {
    if (
      terminalPane.workspaceId === workspaceId &&
      terminalPane.paneId === paneId
    ) {
      terminalPanesBySessionId.delete(sessionId)
    }
  }
}

export function setTerminalPaneRunning(
  sessionId: string,
  workspaceId: string,
  paneId: string,
  isRunning: boolean,
): void {
  if (!isRunning) {
    setPaneCloseWarning(workspaceId, paneId, null)
    return
  }

  terminalPanesBySessionId.set(sessionId, { paneId, workspaceId })
  setPaneCloseWarning(workspaceId, paneId, {
    detail:
      'Closing this pane stops the terminal session and discards its output.',
    title: 'Close running terminal?',
  })
}

export function clearTerminalPaneRunning(sessionId: string): void {
  const terminalPane = terminalPanesBySessionId.get(sessionId)
  if (!terminalPane) return

  terminalPanesBySessionId.delete(sessionId)
  setPaneCloseWarning(terminalPane.workspaceId, terminalPane.paneId, null)
}

export function decidePaneClose(
  request: PaneCloseRequest,
  removedViewIds: readonly string[],
): PaneCloseDecision {
  const warnings = getPaneCloseWarnings(request.workspaceId, removedViewIds)

  return warnings.length > 0
    ? { kind: 'confirm', request, warnings }
    : { kind: 'close', request }
}

export function getPaneCloseWarnings(
  workspaceId: string,
  removedViewIds: readonly string[],
): readonly PaneCloseWarning[] {
  return removedViewIds.flatMap((paneId) => {
    const warning = paneWarnings.get(getPaneWarningKey(workspaceId, paneId))
    return warning ? [warning] : []
  })
}

export function resolvePaneCloseConfirmation(
  decision: PaneCloseDecision,
  confirmed: boolean,
): PaneCloseRequest | null {
  return confirmed ? decision.request : null
}

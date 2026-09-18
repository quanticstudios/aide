import { afterEach, describe, expect, it } from 'vitest'

import {
  clearTerminalPaneRunning,
  decidePaneClose,
  getPaneCloseWarnings,
  resolvePaneCloseConfirmation,
  setPaneCloseWarning,
  setTerminalPaneRunning,
  type PaneCloseRequest,
} from './pane-close-warning'

const request: PaneCloseRequest = {
  paneId: 'terminal-1',
  shouldCloseViewOnly: false,
  workspaceId: 'workspace-1',
}

afterEach(() => {
  setPaneCloseWarning('workspace-1', 'terminal-1', null)
})

describe('pane close warnings', () => {
  it('closes a clean pane without asking for confirmation', () => {
    expect(decidePaneClose(request, ['terminal-1'])).toEqual({
      kind: 'close',
      request,
    })
  })

  it('keeps a pane open when its data-loss warning is cancelled', () => {
    setPaneCloseWarning('workspace-1', 'terminal-1', {
      detail: 'Closing this pane stops the terminal session.',
      title: 'Close running terminal?',
    })

    const decision = decidePaneClose(request, ['terminal-1'])

    expect(decision.kind).toBe('confirm')
    expect(resolvePaneCloseConfirmation(decision, false)).toBeNull()
  })

  it('returns the requested close after confirmation', () => {
    setPaneCloseWarning('workspace-1', 'terminal-1', {
      detail: 'Closing this pane stops the terminal session.',
      title: 'Close running terminal?',
    })

    const decision = decidePaneClose(request, ['terminal-1'])

    expect(resolvePaneCloseConfirmation(decision, true)).toEqual(request)
  })

  it('checks every view removed by a pane close', () => {
    setPaneCloseWarning('workspace-1', 'terminal-1', {
      detail: 'Closing this pane stops the terminal session.',
      title: 'Close running terminal?',
    })

    expect(
      decidePaneClose({ ...request, paneId: 'pane-with-tabs' }, [
        'saved-agent',
        'terminal-1',
      ]).kind,
    ).toBe('confirm')
  })

  it('finds terminal loss when a surface closes all of its panes', () => {
    setPaneCloseWarning('workspace-1', 'terminal-1', {
      detail: 'Closing this pane stops the terminal session.',
      title: 'Close running terminal?',
    })

    expect(
      getPaneCloseWarnings('workspace-1', ['saved-agent', 'terminal-1']),
    ).toHaveLength(1)
  })

  it('clears a background terminal warning when its session exits', () => {
    setTerminalPaneRunning(
      'workspace-1:terminal-1',
      'workspace-1',
      'terminal-1',
      true,
    )
    clearTerminalPaneRunning('workspace-1:terminal-1')

    expect(decidePaneClose(request, ['terminal-1']).kind).toBe('close')
  })
})

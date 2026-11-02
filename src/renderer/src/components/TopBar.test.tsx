// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'

import { PaneActionBar } from './TopBar'

describe('PaneActionBar', () => {
  it('opens the split menu outside the clipped top bar and splits with the picked pane type', async () => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const onSplitPane = vi.fn()

    await act(async () =>
      root.render(
        <PaneActionBar
          activePaneId="pane-1"
          onClosePane={vi.fn()}
          onResizePane={vi.fn()}
          onSplitPane={onSplitPane}
          projectKind="git"
        />,
      ),
    )

    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Split horizontally"]')
        ?.click(),
    )
    const menu = document.querySelector('[role="menu"]')
    expect(menu?.getAttribute('aria-label')).toBe('Split horizontal with')
    expect(container.contains(menu)).toBe(false)

    const agentItem = [
      ...document.querySelectorAll<HTMLElement>('[role="menuitem"]'),
    ].find((item) => item.textContent === 'Agent')
    await act(async () => agentItem?.click())
    expect(onSplitPane).toHaveBeenCalledWith(
      'pane-1',
      'split-horizontal',
      'agent',
    )

    await act(async () => root.unmount())
    container.remove()
  })
})

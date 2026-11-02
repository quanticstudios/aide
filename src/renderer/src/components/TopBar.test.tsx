// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ProjectRecord,
  WorkspaceRecord,
  WorkspaceSurfaceRecord,
} from '../../../shared/persistence'
import type { UpdatePresentation } from '../lib/update-presentation'
import TopBar, { PaneActionBar, paneStripScrollLeft } from './TopBar'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const project = { id: 'project-1', kind: 'git', name: 'alpha' } as ProjectRecord
const workspace = {
  id: 'workspace-1',
  name: 'main',
  projectId: 'project-1',
} as WorkspaceRecord
const surfaces = ['Agent', 'Terminal', 'Preview target'].map(
  (title, orderIndex): WorkspaceSurfaceRecord => ({
    id: `surface-${orderIndex}`,
    orderIndex,
    rootNodeId: `root-${orderIndex}`,
    title,
    workspaceId: workspace.id,
  }),
)
const updatePresentation = {
  indicatorVisible: false,
} as UpdatePresentation

let root: Root | null = null

async function renderTopBar(
  props: Partial<Parameters<typeof TopBar>[0]> = {},
): Promise<void> {
  if (!root) {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
  }
  const target = root
  await act(async () => {
    target.render(
      <TopBar
        activePaneId="pane-1"
        activeProject={project}
        activeSurfaceId="surface-0"
        activeWorkspace={workspace}
        canResizePane={false}
        isSidebarOpen
        isTerminalAvailable
        isTerminalOpen={false}
        onClosePane={() => undefined}
        onCloseSurface={() => undefined}
        onCreatePane={() => undefined}
        onOpenDiagnostics={() => undefined}
        onOpenTask={async () => undefined}
        onOpenUpdate={() => undefined}
        onResizePane={() => undefined}
        onSelectPane={() => undefined}
        onSplitPane={() => undefined}
        onToggleSidebar={() => undefined}
        onToggleTerminal={() => undefined}
        showProjectName={false}
        sidebarToggleRef={{ current: null }}
        surfaceManagedSessionIds={{}}
        surfaces={surfaces}
        updatePresentation={updatePresentation}
        {...props}
      />,
    )
  })
}

function isDisabled(label: string): boolean {
  const button = document.querySelector(`button[aria-label="${label}"]`)
  if (!button) throw new Error(`No button ${label}`)
  return button.hasAttribute('disabled')
}

afterEach(async () => {
  await act(async () => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

describe('TopBar', () => {
  it('disables Shrink and Grow until the active pane shares its surface', async () => {
    await renderTopBar({ canResizePane: false })
    expect(isDisabled('Shrink pane')).toBe(true)
    expect(isDisabled('Grow pane')).toBe(true)
    expect(isDisabled('Close pane')).toBe(false)

    await renderTopBar({ canResizePane: true })
    expect(isDisabled('Shrink pane')).toBe(false)
    expect(isDisabled('Grow pane')).toBe(false)
  })

  it('names the project before the workspace when asked', async () => {
    await renderTopBar({ showProjectName: true })
    const heading = document.querySelector('[data-testid="workspace-heading"]')
    expect(heading?.textContent).toBe('alpha/main')

    await renderTopBar({ showProjectName: false })
    expect(heading?.textContent).toBe('main')
  })
})

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
          canResizePane
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

  it('closes an open split menu when the active pane goes away', async () => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const render = (activePaneId: string | null) =>
      root.render(
        <PaneActionBar
          activePaneId={activePaneId}
          canResizePane
          onClosePane={vi.fn()}
          onResizePane={vi.fn()}
          onSplitPane={vi.fn()}
          projectKind="git"
        />,
      )

    await act(async () => render('pane-1'))
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[aria-label="Split vertically"]')
        ?.click(),
    )
    expect(document.querySelector('[role="menu"]')).not.toBeNull()

    await act(async () => render(null))
    expect(document.querySelector('[role="menu"]')).toBeNull()

    await act(async () => render('pane-2'))
    expect(document.querySelector('[role="menu"]')).toBeNull()

    await act(async () => root.unmount())
    container.remove()
  })
})

describe('paneStripScrollLeft', () => {
  // Six 100px tabs 4px apart, starting after the strip's 16px start inset, in a 300px strip.
  const tabs = [0, 1, 2, 3, 4, 5].map((index) => ({
    left: 16 + index * 104,
    width: 100,
  }))
  const reveal = (activeIndex: number, scrollLeft: number) =>
    paneStripScrollLeft(tabs, activeIndex, {
      endInset: 24,
      scrollLeft,
      startInset: 16,
      viewWidth: 300,
    })

  it('starts the strip on a tab when revealing a tab on the right', () => {
    const left = reveal(5, 0)
    expect(tabs.some((tab) => tab.left - 16 === left)).toBe(true)
    expect(tabs[5].left + tabs[5].width).toBeLessThanOrEqual(left + 300 - 24)
  })

  it('clears the start fade when revealing a tab on the left', () => {
    expect(reveal(1, 400)).toBe(tabs[1].left - 16)
  })

  it('realigns a strip that rests mid-tab even when the active tab shows', () => {
    const left = reveal(4, 300)
    expect(left).toBe(tabs[3].left - 16)
  })
})

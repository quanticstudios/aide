// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'
import SidebarTree, { ArchivedWorkspacesMenu } from './SidebarTree'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const project = { id: 'project-1', kind: 'git', name: 'alpha' } as ProjectRecord
const archived = {
  id: 'workspace-2',
  name: 'Workspace 2',
  projectId: 'project-1',
} as WorkspaceRecord

function button(label: string): HTMLElement {
  const match = [
    ...document.querySelectorAll<HTMLElement>('button, [role="button"]'),
  ].find(
    (element) =>
      element.textContent === label ||
      element.getAttribute('aria-label') === label,
  )
  if (!match) throw new Error(`No button ${label}`)
  return match
}

async function press(element: HTMLElement) {
  await act(async () => {
    for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup']) {
      element.dispatchEvent(
        new PointerEvent(type, { bubbles: true, button: 0, pointerId: 1 }),
      )
    }
    element.click()
  })
}

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ArchivedWorkspacesMenu', () => {
  it('closes after the last archived workspace is restored', async () => {
    const archiveWorkspace = vi.fn(async () => undefined)
    Object.assign(window, { aide: { archiveWorkspace } })
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)

    await act(async () => {
      root.render(
        <ArchivedWorkspacesMenu
          archivedWorkspaces={[archived]}
          onDelete={() => undefined}
          projects={[project]}
        />,
      )
    })
    await press(button('Archived workspaces'))
    expect(document.body.textContent).toContain('Workspace 2')

    await press(button('Restore'))
    await act(async () => {
      root.render(
        <ArchivedWorkspacesMenu
          archivedWorkspaces={[]}
          onDelete={() => undefined}
          projects={[project]}
        />,
      )
    })

    expect(archiveWorkspace).toHaveBeenCalledWith('workspace-2', false)
    expect(document.body.textContent).not.toContain('No archived workspaces')
    await act(async () => root.unmount())
  })
})

describe('SidebarTree', () => {
  it('marks the active workspace row as current', async () => {
    const workspaces = ['workspace-1', 'workspace-3'].map(
      (id) =>
        ({
          branchName: id,
          id,
          name: id,
          projectId: 'project-1',
        }) as WorkspaceRecord,
    )
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const noop = () => undefined
    await act(async () => {
      root.render(
        <SidebarTree
          activeProjectId="project-1"
          activeWorkspaceId="workspace-3"
          archivedWorkspaces={[]}
          isExpanded
          jevGates={null}
          onConfigureProjectSetup={noop}
          onCreateChat={noop}
          onCreateProject={noop}
          onCreateWorkspace={noop}
          onOpenSettings={noop}
          onRenameWorkspace={async () => null}
          onSelectPane={noop}
          onSelectProject={noop}
          onSelectWorkspace={noop}
          onUpdateJevGates={noop}
          onUpdateProjectAppearance={async () => null}
          projects={[project]}
          showProjectHints={false}
          summaries={{}}
          workspaces={workspaces}
        />,
      )
    })
    const current = (id: string) =>
      document
        .querySelector(`[data-testid="workspace-row-${id}"]`)
        ?.getAttribute('aria-current')
    expect(current('workspace-3')).toBe('true')
    expect(current('workspace-1')).toBeNull()
    await act(async () => root.unmount())
  })
})

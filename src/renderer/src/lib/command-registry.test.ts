import { describe, expect, it, vi } from 'vitest'

import { buildCommandList, type CommandContext } from './command-registry'

function createContext(
  overrides: Partial<CommandContext> = {},
): CommandContext {
  return {
    activePaneId: null,
    onClosePane: vi.fn(),
    onCreatePane: vi.fn(),
    onCreateWorkspace: vi.fn(),
    onOpenOverview: vi.fn(),
    onOpenProject: vi.fn(),
    onOpenSoftwareUpdate: vi.fn(),
    onResizePane: vi.fn(),
    onSelectProject: vi.fn(),
    onSelectWorkspace: vi.fn(),
    onToggleFleet: vi.fn(),
    onToggleSidebar: vi.fn(),
    projects: [],
    workspaces: [],
    ...overrides,
  }
}

describe('buildCommandList', () => {
  it('offers close and resize actions only for an active pane', () => {
    const context = createContext({ activePaneId: 'active-pane' })
    const commands = buildCommandList(context)
    const emptyCommands = buildCommandList(createContext())
    for (const id of ['close-pane', 'grow-pane', 'shrink-pane']) {
      const command = commands.find((candidate) => candidate.id === id)
      expect(command).toBeDefined()
      command?.onSelect()
      expect(emptyCommands.some((candidate) => candidate.id === id)).toBe(false)
    }
    expect(context.onClosePane).toHaveBeenCalledWith('active-pane')
    expect(context.onResizePane).toHaveBeenNthCalledWith(1, 'active-pane', 0.25)
    expect(context.onResizePane).toHaveBeenNthCalledWith(
      2,
      'active-pane',
      -0.25,
    )
  })

  it('includes static commands when there are no workspaces or projects', () => {
    const commands = buildCommandList(createContext())
    const ids = commands.map((cmd) => cmd.id)

    expect(ids).toContain('create-pane')
    expect(ids).toContain('create-workspace')
    expect(ids).toContain('open-project')
    expect(ids).toContain('open-overview')
    expect(ids).toContain('open-software-update')
    expect(ids).toContain('toggle-fleet')
  })

  it('omits Git workspace creation for folder projects', () => {
    const commands = buildCommandList(
      createContext({ canCreateWorkspace: false }),
    )

    expect(commands.map((command) => command.id)).not.toContain(
      'create-workspace',
    )
  })

  it('includes only the update action relevant to the current state', () => {
    const onSelect = vi.fn()
    const commands = buildCommandList(
      createContext({
        updateAction: {
          id: 'download-update',
          label: 'Download update',
          onSelect,
        },
      }),
    )

    expect(commands.filter((command) => command.id.includes('update'))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'download-update' }),
        expect.objectContaining({ id: 'open-software-update' }),
      ]),
    )
    expect(commands.some((command) => command.id === 'check-for-updates')).toBe(
      false,
    )
  })

  it('generates navigation commands for workspaces', () => {
    const commands = buildCommandList(
      createContext({
        workspaces: [
          {
            id: 'ws-1',
            projectId: 'p-1',
            name: 'Feature A',
            branchName: 'feature-a',
            worktreePath: '/repo/.worktrees/ws-1',
            windowId: null,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
          },
        ],
      }),
    )

    const wsCmd = commands.find((cmd) => cmd.id === 'go-workspace-ws-1')

    expect(wsCmd).toBeDefined()
    expect(wsCmd?.label).toBe('Feature A')
    expect(wsCmd?.group).toBe('navigation')
  })

  it('generates navigation commands for projects', () => {
    const commands = buildCommandList(
      createContext({
        projects: [
          {
            id: 'p-1',
            kind: 'git',
            name: 'aide',
            repoRoot: '/repo/aide',
            remoteUrl: null,
            defaultBranch: 'main',
            setupCommand: null,
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
            worktreeSetupRevision: 0,
          },
        ],
      }),
    )

    const projCmd = commands.find((cmd) => cmd.id === 'go-project-p-1')

    expect(projCmd).toBeDefined()
    expect(projCmd?.label).toBe('aide')
    expect(projCmd?.group).toBe('navigation')
  })
})

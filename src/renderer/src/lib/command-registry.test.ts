import { describe, expect, it, vi } from 'vitest'

import { type CommandContext, buildCommandList } from './command-registry'

function createContext(
  overrides: Partial<CommandContext> = {},
): CommandContext {
  return {
    onCreatePane: vi.fn(),
    onCreateWorkspace: vi.fn(),
    onOpenOverview: vi.fn(),
    onOpenProject: vi.fn(),
    onSelectProject: vi.fn(),
    onSelectWorkspace: vi.fn(),
    projects: [],
    workspaces: [],
    ...overrides,
  }
}

describe('buildCommandList', () => {
  it('includes static commands when there are no workspaces or projects', () => {
    const commands = buildCommandList(createContext())
    const ids = commands.map((cmd) => cmd.id)

    expect(ids).toContain('create-pane')
    expect(ids).toContain('create-workspace')
    expect(ids).toContain('open-project')
    expect(ids).toContain('open-overview')
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
            name: 'aide',
            repoRoot: '/repo/aide',
            remoteUrl: null,
            defaultBranch: 'main',
            createdAt: '2026-01-01T00:00:00Z',
            updatedAt: '2026-01-01T00:00:00Z',
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

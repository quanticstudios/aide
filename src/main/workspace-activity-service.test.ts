import { describe, expect, it } from 'vitest'

import type { TerminalSessionConfig } from '../shared/terminal'
import { WorkspaceActivityService } from './workspace-activity-service'

function createConfig(
  sessionId: string,
  workspaceId = 'workspace-1',
): TerminalSessionConfig {
  return {
    cols: 120,
    cwd: '/tmp/workspace-1',
    paneId: `${workspaceId}:pane-terminal`,
    rows: 40,
    sessionId,
    workspaceId,
  }
}

describe('WorkspaceActivityService', () => {
  it('marks Claude sessions as working after a submitted prompt', () => {
    const service = new WorkspaceActivityService({
      getNow: () => '2026-04-06T12:00:00.000Z',
      onUpdate: () => undefined,
    })

    service.trackSession(createConfig('workspace-1:terminal'))
    service.handleTerminalEvent({
      data: 'Claude Code v2.1.92\n> ',
      sessionId: 'workspace-1:terminal',
      type: 'data',
    })
    service.handleTerminalInput('workspace-1:terminal', 'build preview\n')

    expect(service.getSnapshot()['workspace-1']).toMatchObject({
      provider: 'claude',
      state: 'working',
    })
  })

  it('marks Claude sessions as ready when the prompt returns', () => {
    const service = new WorkspaceActivityService({
      getNow: () => '2026-04-06T12:05:00.000Z',
      onUpdate: () => undefined,
    })

    service.trackSession(createConfig('workspace-1:terminal'))
    service.handleTerminalEvent({
      data: 'Claude Code v2.1.92\n> ',
      sessionId: 'workspace-1:terminal',
      type: 'data',
    })

    expect(service.getSnapshot()['workspace-1']).toMatchObject({
      provider: 'claude',
      state: 'ready',
    })
  })

  it('surfaces Claude attention states from transcript cues', () => {
    const service = new WorkspaceActivityService({
      getNow: () => '2026-04-06T12:10:00.000Z',
      onUpdate: () => undefined,
    })

    service.trackSession(createConfig('workspace-1:terminal'))
    service.handleTerminalEvent({
      data: 'Claude Code v2.1.92\n1 MCP server failed\n> ',
      sessionId: 'workspace-1:terminal',
      type: 'data',
    })

    expect(service.getSnapshot()['workspace-1']).toMatchObject({
      detail: '1 MCP server failed',
      provider: 'claude',
      state: 'attention',
    })
  })

  it('marks Codex prompts as ready when idle at the prompt', () => {
    const service = new WorkspaceActivityService({
      getNow: () => '2026-04-06T12:15:00.000Z',
      onUpdate: () => undefined,
    })

    service.trackSession(createConfig('workspace-1:terminal'))
    service.handleTerminalEvent({
      data: 'OpenAI Codex v0.1\n› ',
      sessionId: 'workspace-1:terminal',
      type: 'data',
    })

    expect(service.getSnapshot()['workspace-1']).toMatchObject({
      provider: 'codex',
      state: 'ready',
    })
  })

  it('keeps a generic terminal idle until a command is submitted', () => {
    const service = new WorkspaceActivityService({
      getNow: () => '2026-04-06T12:20:00.000Z',
      onUpdate: () => undefined,
    })

    service.trackSession(createConfig('workspace-1:terminal'))
    service.handleTerminalEvent({
      data: 'portalumrlice on main\n$ ',
      sessionId: 'workspace-1:terminal',
      type: 'data',
    })

    expect(service.getSnapshot()['workspace-1']).toBeUndefined()

    service.handleTerminalInput('workspace-1:terminal', 'npm run dev\n')

    expect(service.getSnapshot()['workspace-1']).toMatchObject({
      provider: 'terminal',
      state: 'working',
    })
  })

  it('preserves non-zero exits as sticky workspace errors until visited', () => {
    const service = new WorkspaceActivityService({
      getNow: () => '2026-04-06T12:25:00.000Z',
      onUpdate: () => undefined,
    })

    service.trackSession(createConfig('workspace-1:terminal'))
    service.handleTerminalEvent({
      data: 'OpenAI Codex v0.1\n› ',
      sessionId: 'workspace-1:terminal',
      type: 'data',
    })
    service.handleTerminalEvent({
      exitCode: 1,
      sessionId: 'workspace-1:terminal',
      type: 'exit',
    })

    expect(service.getSnapshot()['workspace-1']).toMatchObject({
      provider: 'codex',
      state: 'error',
    })

    service.markWorkspaceVisited('workspace-1')

    expect(service.getSnapshot()['workspace-1']).toBeUndefined()
  })

  it('aggregates multiple sessions in one workspace by priority', () => {
    const service = new WorkspaceActivityService({
      getNow: () => '2026-04-06T12:30:00.000Z',
      onUpdate: () => undefined,
    })

    service.trackSession(createConfig('workspace-1:terminal-a'))
    service.trackSession({
      ...createConfig('workspace-1:terminal-b'),
      paneId: 'workspace-1:pane-b',
      sessionId: 'workspace-1:terminal-b',
    })
    service.handleTerminalEvent({
      data: 'Claude Code v2.1.92\n> ',
      sessionId: 'workspace-1:terminal-a',
      type: 'data',
    })
    service.handleTerminalInput('workspace-1:terminal-a', 'run tests\n')
    service.handleTerminalEvent({
      data: 'OpenAI Codex v0.1\nPermission required to continue\n› ',
      sessionId: 'workspace-1:terminal-b',
      type: 'data',
    })

    expect(service.getSnapshot()['workspace-1']).toMatchObject({
      provider: 'codex',
      state: 'attention',
    })
  })
})

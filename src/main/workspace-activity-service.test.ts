import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { TerminalSessionConfig } from '../shared/terminal'
import { WorkspaceActivityService } from './workspace-activity-service'

function createConfig(
  sessionId: string,
  workspaceId = 'workspace-1',
  mode: TerminalSessionConfig['mode'] = 'shell',
): TerminalSessionConfig {
  return {
    cols: 120,
    cwd: '/tmp/workspace-1',
    mode,
    paneId: `${workspaceId}:pane-terminal`,
    rows: 40,
    sessionId,
    workspaceId,
  }
}

describe('WorkspaceActivityService', () => {
  const getNow = vi.fn(() => '2026-04-06T12:00:00.000Z')

  beforeEach(() => {
    getNow.mockReset()
    getNow.mockReturnValue('2026-04-06T12:00:00.000Z')
  })

  it('marks managed Claude sessions as connecting before the prompt appears', () => {
    const service = new WorkspaceActivityService({
      getNow,
      onUpdate: () => undefined,
    })

    service.trackSession(
      createConfig('workspace-1:claude', 'workspace-1', 'claude'),
    )

    expect(service.getSnapshot()['workspace-1']).toMatchObject({
      provider: 'claude',
      source: 'managed',
      state: 'connecting',
    })
  })

  it('marks managed Claude sessions as working after a submitted prompt', () => {
    const service = new WorkspaceActivityService({
      getNow,
      onUpdate: () => undefined,
    })

    service.trackSession(
      createConfig('workspace-1:claude', 'workspace-1', 'claude'),
    )
    service.handleTerminalEvent({
      data: 'Claude Code v2.1.92\n> ',
      sessionId: 'workspace-1:claude',
      type: 'data',
    })

    getNow.mockReturnValue('2026-04-06T12:01:00.000Z')
    service.handleTerminalInput('workspace-1:claude', 'build preview\n')

    expect(service.getSnapshot()['workspace-1']).toMatchObject({
      provider: 'claude',
      source: 'managed',
      state: 'working',
    })
  })

  it('surfaces managed Codex approval states above other activity', () => {
    const service = new WorkspaceActivityService({
      getNow,
      onUpdate: () => undefined,
    })

    service.trackSession(
      createConfig('workspace-1:codex', 'workspace-1', 'codex'),
    )
    service.handleTerminalEvent({
      data: 'OpenAI Codex v0.1\nApproval required to continue\n› ',
      sessionId: 'workspace-1:codex',
      type: 'data',
    })

    expect(service.getSnapshot()['workspace-1']).toMatchObject({
      detail: 'Approval required to continue',
      provider: 'codex',
      source: 'managed',
      state: 'pending-approval',
    })
  })

  it('does not treat Claude permission mode hints as pending approval', () => {
    const service = new WorkspaceActivityService({
      getNow,
      onUpdate: () => undefined,
    })

    service.trackSession(
      createConfig('workspace-1:claude', 'workspace-1', 'claude'),
    )
    service.handleTerminalEvent({
      data: [
        'Claude Code v2.1.92',
        '> hello',
        'Hello! How can I help you today?',
        'bypass permissions on (shift+tab to cycle)',
        '',
        '> ',
      ].join('\n'),
      sessionId: 'workspace-1:claude',
      type: 'data',
    })

    expect(service.getSnapshot()['workspace-1']).toBeUndefined()
  })

  it('surfaces managed Claude input requests separately from approvals', () => {
    const service = new WorkspaceActivityService({
      getNow,
      onUpdate: () => undefined,
    })

    service.trackSession(
      createConfig('workspace-1:claude', 'workspace-1', 'claude'),
    )
    service.handleTerminalEvent({
      data: 'Claude Code v2.1.92\nSelect an option to continue\n> ',
      sessionId: 'workspace-1:claude',
      type: 'data',
    })

    expect(service.getSnapshot()['workspace-1']).toMatchObject({
      provider: 'claude',
      source: 'managed',
      state: 'awaiting-input',
    })
  })

  it('keeps generic shell terminals coarse and provider-agnostic', () => {
    const service = new WorkspaceActivityService({
      getNow,
      onUpdate: () => undefined,
    })

    service.trackSession(createConfig('workspace-1:shell'))
    service.handleTerminalEvent({
      data: 'portalumrlice on main\n$ ',
      sessionId: 'workspace-1:shell',
      type: 'data',
    })

    expect(service.getSnapshot()['workspace-1']).toBeUndefined()

    getNow.mockReturnValue('2026-04-06T12:02:00.000Z')
    service.handleTerminalInput('workspace-1:shell', 'npm run dev\n')

    expect(service.getSnapshot()['workspace-1']).toMatchObject({
      provider: 'terminal',
      source: 'fallback',
      state: 'terminal-running',
    })
  })

  it('limits fallback Claude detection to coarse working state only', () => {
    const service = new WorkspaceActivityService({
      getNow,
      onUpdate: () => undefined,
    })

    service.trackSession(createConfig('workspace-1:shell'))
    service.handleTerminalEvent({
      data: 'Claude Code v2.1.92\n> ',
      sessionId: 'workspace-1:shell',
      type: 'data',
    })

    expect(service.getSnapshot()['workspace-1']).toBeUndefined()

    getNow.mockReturnValue('2026-04-06T12:03:00.000Z')
    service.handleTerminalInput('workspace-1:shell', 'run tests\n')

    expect(service.getSnapshot()['workspace-1']).toMatchObject({
      provider: 'claude',
      source: 'fallback',
      state: 'working',
    })
  })

  it('does not elevate fallback shell prompts to approval states', () => {
    const service = new WorkspaceActivityService({
      getNow,
      onUpdate: () => undefined,
    })

    service.trackSession(createConfig('workspace-1:shell'))
    service.handleTerminalEvent({
      data: 'Claude Code v2.1.92\nbypass permissions on (shift+tab to cycle)\n> ',
      sessionId: 'workspace-1:shell',
      type: 'data',
    })

    expect(service.getSnapshot()['workspace-1']).toBeUndefined()
  })

  it('keeps completed managed turns sticky until the workspace is visited', () => {
    const service = new WorkspaceActivityService({
      getNow,
      onUpdate: () => undefined,
    })

    service.trackSession(
      createConfig('workspace-1:claude', 'workspace-1', 'claude'),
    )
    service.handleTerminalEvent({
      data: 'Claude Code v2.1.92\n> ',
      sessionId: 'workspace-1:claude',
      type: 'data',
    })

    getNow.mockReturnValue('2026-04-06T12:04:00.000Z')
    service.handleTerminalInput('workspace-1:claude', 'run tests\n')

    getNow.mockReturnValue('2026-04-06T12:05:00.000Z')
    service.handleTerminalEvent({
      data: '\nDone.\n> ',
      sessionId: 'workspace-1:claude',
      type: 'data',
    })

    expect(service.getSnapshot()['workspace-1']).toMatchObject({
      provider: 'claude',
      state: 'completed',
    })

    getNow.mockReturnValue('2026-04-06T12:06:00.000Z')
    service.markWorkspaceVisited('workspace-1')

    expect(service.getSnapshot()['workspace-1']).toBeUndefined()
  })

  it('aggregates multiple sessions in one workspace by t3code-style priority', () => {
    const service = new WorkspaceActivityService({
      getNow,
      onUpdate: () => undefined,
    })

    service.trackSession(
      createConfig('workspace-1:claude', 'workspace-1', 'claude'),
    )
    service.trackSession({
      ...createConfig('workspace-1:codex', 'workspace-1', 'codex'),
      paneId: 'workspace-1:pane-codex',
    })

    service.handleTerminalEvent({
      data: 'Claude Code v2.1.92\n> ',
      sessionId: 'workspace-1:claude',
      type: 'data',
    })
    getNow.mockReturnValue('2026-04-06T12:01:00.000Z')
    service.handleTerminalInput('workspace-1:claude', 'run tests\n')

    getNow.mockReturnValue('2026-04-06T12:02:00.000Z')
    service.handleTerminalEvent({
      data: 'OpenAI Codex v0.1\nApproval required to continue\n› ',
      sessionId: 'workspace-1:codex',
      type: 'data',
    })

    expect(service.getSnapshot()['workspace-1']).toMatchObject({
      provider: 'codex',
      state: 'pending-approval',
    })
  })

  it('records launch failures as workspace errors', () => {
    const service = new WorkspaceActivityService({
      getNow,
      onUpdate: () => undefined,
    })

    service.handleSessionLaunchFailure(
      createConfig('workspace-1:codex', 'workspace-1', 'codex'),
      new Error('spawn codex ENOENT'),
    )

    expect(service.getSnapshot()['workspace-1']).toMatchObject({
      detail: 'spawn codex ENOENT',
      provider: 'codex',
      state: 'error',
    })
  })
})

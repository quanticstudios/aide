import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ManagedProviderRuntimeEvent } from '../shared/provider-runtime'
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

  function getActivity(
    service: WorkspaceActivityService,
    workspaceId = 'workspace-1',
  ) {
    return service.getSnapshot()[workspaceId]?.[0]
  }

  function emitManagedEvent(
    service: WorkspaceActivityService,
    sessionId: string,
    event: ManagedProviderRuntimeEvent,
  ) {
    service.handleManagedRuntimeEvent(sessionId, event)
  }

  beforeEach(() => {
    getNow.mockReset()
    getNow.mockReturnValue('2026-04-06T12:00:00.000Z')
  })

  it('marks managed Claude sessions as connecting before the prompt appears', () => {
    const service = new WorkspaceActivityService({
      getNow,
      onUpdate: () => undefined,
    })

    service.handleManagedSessionStart(
      createConfig('workspace-1:claude', 'workspace-1', 'claude'),
    )

    expect(getActivity(service)).toMatchObject({
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

    service.handleManagedSessionStart(
      createConfig('workspace-1:claude', 'workspace-1', 'claude'),
    )

    getNow.mockReturnValue('2026-04-06T12:01:00.000Z')
    emitManagedEvent(service, 'workspace-1:claude', {
      createdAt: '2026-04-06T12:01:00.000Z',
      provider: 'claude',
      turnId: 'turn-1',
      type: 'turn.started',
    })

    expect(getActivity(service)).toMatchObject({
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

    service.handleManagedSessionStart(
      createConfig('workspace-1:codex', 'workspace-1', 'codex'),
    )
    emitManagedEvent(service, 'workspace-1:codex', {
      createdAt: '2026-04-06T12:00:00.000Z',
      detail: 'Approval required to continue',
      provider: 'codex',
      requestId: 'approval-1',
      requestType: 'command-execution-approval',
      type: 'request.opened',
    })

    expect(getActivity(service)).toMatchObject({
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

    service.handleManagedSessionStart(
      createConfig('workspace-1:claude', 'workspace-1', 'claude'),
    )
    emitManagedEvent(service, 'workspace-1:claude', {
      createdAt: '2026-04-06T12:00:00.000Z',
      itemId: 'msg-1',
      kind: 'assistant-text',
      provider: 'claude',
      text: 'bypass permissions on (shift+tab to cycle)',
      type: 'content.delta',
    })

    expect(getActivity(service)).toMatchObject({
      provider: 'claude',
      source: 'managed',
      state: 'connecting',
    })
  })

  it('surfaces managed Claude input requests separately from approvals', () => {
    const service = new WorkspaceActivityService({
      getNow,
      onUpdate: () => undefined,
    })

    service.handleManagedSessionStart(
      createConfig('workspace-1:claude', 'workspace-1', 'claude'),
    )
    emitManagedEvent(service, 'workspace-1:claude', {
      createdAt: '2026-04-06T12:00:00.000Z',
      detail: 'Select an option to continue',
      provider: 'claude',
      questions: [],
      requestId: 'input-1',
      type: 'user-input.requested',
    })

    expect(getActivity(service)).toMatchObject({
      provider: 'claude',
      source: 'managed',
      state: 'awaiting-input',
    })
  })

  it('treats Claude startup task picker prompts as awaiting input', () => {
    const service = new WorkspaceActivityService({
      getNow,
      onUpdate: () => undefined,
    })

    service.handleManagedSessionStart(
      createConfig('workspace-1:claude', 'workspace-1', 'claude'),
    )
    emitManagedEvent(service, 'workspace-1:claude', {
      createdAt: '2026-04-06T12:00:00.000Z',
      detail: 'Enter to select · ↑/↓ to navigate · Esc to cancel',
      provider: 'claude',
      questions: [
        {
          id: 'task',
          options: [{ id: 'bug', label: 'Fix a bug' }],
          prompt: 'What would you like to work on today?',
        },
      ],
      requestId: 'input-1',
      type: 'user-input.requested',
    })

    expect(getActivity(service)).toMatchObject({
      detail: 'Enter to select · ↑/↓ to navigate · Esc to cancel',
      provider: 'claude',
      source: 'managed',
      state: 'awaiting-input',
    })
  })

  it('keeps managed Claude input requests sticky across passive output', () => {
    const service = new WorkspaceActivityService({
      getNow,
      onUpdate: () => undefined,
    })

    service.handleManagedSessionStart(
      createConfig('workspace-1:claude', 'workspace-1', 'claude'),
    )
    emitManagedEvent(service, 'workspace-1:claude', {
      createdAt: '2026-04-06T12:01:00.000Z',
      provider: 'claude',
      turnId: 'turn-1',
      type: 'turn.started',
    })
    emitManagedEvent(service, 'workspace-1:claude', {
      createdAt: '2026-04-06T12:02:00.000Z',
      detail: 'Enter to select · ↑/↓ to navigate · Esc to cancel',
      provider: 'claude',
      questions: [
        {
          id: 'task',
          options: [{ id: 'chat', label: 'Chat about this' }],
          prompt: 'What would you like to work on today?',
        },
      ],
      requestId: 'input-1',
      type: 'user-input.requested',
    })
    emitManagedEvent(service, 'workspace-1:claude', {
      createdAt: '2026-04-06T12:03:00.000Z',
      itemId: 'progress-1',
      kind: 'assistant-text',
      provider: 'claude',
      text: '[ Task ]\n6. Chat about this\n',
      type: 'content.delta',
    })

    expect(getActivity(service)).toMatchObject({
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

    expect(getActivity(service)).toBeUndefined()

    getNow.mockReturnValue('2026-04-06T12:02:00.000Z')
    service.handleTerminalInput('workspace-1:shell', 'npm run dev\n')

    expect(getActivity(service)).toMatchObject({
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

    expect(getActivity(service)).toBeUndefined()

    getNow.mockReturnValue('2026-04-06T12:03:00.000Z')
    service.handleTerminalInput('workspace-1:shell', 'run tests\n')

    expect(getActivity(service)).toMatchObject({
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

    expect(getActivity(service)).toBeUndefined()
  })

  it('keeps completed managed turns sticky until the workspace is visited', () => {
    const service = new WorkspaceActivityService({
      getNow,
      onUpdate: () => undefined,
    })

    service.handleManagedSessionStart(
      createConfig('workspace-1:claude', 'workspace-1', 'claude'),
    )
    emitManagedEvent(service, 'workspace-1:claude', {
      createdAt: '2026-04-06T12:04:00.000Z',
      provider: 'claude',
      turnId: 'turn-1',
      type: 'turn.started',
    })
    emitManagedEvent(service, 'workspace-1:claude', {
      createdAt: '2026-04-06T12:05:00.000Z',
      provider: 'claude',
      state: 'completed',
      turnId: 'turn-1',
      type: 'turn.completed',
    })

    expect(getActivity(service)).toMatchObject({
      provider: 'claude',
      state: 'completed',
    })

    getNow.mockReturnValue('2026-04-06T12:06:00.000Z')
    service.markWorkspaceVisited('workspace-1')

    expect(getActivity(service)).toBeUndefined()
  })

  it('aggregates multiple sessions in one workspace by t3code-style priority', () => {
    const service = new WorkspaceActivityService({
      getNow,
      onUpdate: () => undefined,
    })

    service.handleManagedSessionStart(
      createConfig('workspace-1:claude', 'workspace-1', 'claude'),
    )
    service.handleManagedSessionStart({
      ...createConfig('workspace-1:codex', 'workspace-1', 'codex'),
      paneId: 'workspace-1:pane-codex',
    })

    emitManagedEvent(service, 'workspace-1:claude', {
      createdAt: '2026-04-06T12:01:00.000Z',
      provider: 'claude',
      turnId: 'turn-1',
      type: 'turn.started',
    })
    emitManagedEvent(service, 'workspace-1:codex', {
      createdAt: '2026-04-06T12:02:00.000Z',
      detail: 'Approval required to continue',
      provider: 'codex',
      requestId: 'approval-1',
      requestType: 'command-execution-approval',
      type: 'request.opened',
    })

    expect(getActivity(service)).toMatchObject({
      provider: 'codex',
      state: 'pending-approval',
    })
  })

  it('retains multiple live workspace activities ordered by priority', () => {
    const service = new WorkspaceActivityService({
      getNow,
      onUpdate: () => undefined,
    })

    service.handleManagedSessionStart(
      createConfig('workspace-1:claude', 'workspace-1', 'claude'),
    )
    service.handleManagedSessionStart({
      ...createConfig('workspace-1:codex', 'workspace-1', 'codex'),
      paneId: 'workspace-1:pane-codex',
    })

    emitManagedEvent(service, 'workspace-1:claude', {
      createdAt: '2026-04-06T12:01:00.000Z',
      detail: 'Enter to select',
      provider: 'claude',
      questions: [],
      requestId: 'input-1',
      type: 'user-input.requested',
    })
    emitManagedEvent(service, 'workspace-1:codex', {
      createdAt: '2026-04-06T12:02:00.000Z',
      detail: 'Approval required to continue',
      provider: 'codex',
      requestId: 'approval-1',
      requestType: 'command-execution-approval',
      type: 'request.opened',
    })

    expect(service.getSnapshot()['workspace-1']).toHaveLength(2)
    expect(service.getSnapshot()['workspace-1']?.[0]).toMatchObject({
      provider: 'codex',
      state: 'pending-approval',
    })
    expect(service.getSnapshot()['workspace-1']?.[1]).toMatchObject({
      provider: 'claude',
      state: 'awaiting-input',
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

    expect(getActivity(service)).toMatchObject({
      detail: 'spawn codex ENOENT',
      provider: 'codex',
      state: 'error',
    })
  })
})

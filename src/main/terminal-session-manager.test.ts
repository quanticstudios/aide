import { describe, expect, it, vi } from 'vitest'
import { TerminalSessionManager } from './terminal-session-manager'

const { spawn } = vi.hoisted(() => ({
  spawn: vi.fn(() => ({
    kill: vi.fn(),
    onData: vi.fn(),
    onExit: vi.fn(),
    resize: vi.fn(),
    write: vi.fn(),
  })),
}))
vi.mock('node-pty', () => ({ spawn }))

describe('terminal ownership', () => {
  it('reattaches its pane and rejects reuse by another workspace or pane', () => {
    const manager = new TerminalSessionManager({ onEvent: () => undefined })
    const config = {
      cols: 80,
      rows: 24,
      cwd: '/tmp',
      mode: 'shell' as const,
      sessionId: 'terminal',
      workspaceId: 'workspace',
      paneId: 'pane',
    }
    const first = manager.createSession(config)
    expect(manager.createSession(config)).toEqual(first)
    expect(() =>
      manager.createSession({ ...config, workspaceId: 'other' }),
    ).toThrow('does not belong')
    expect(() => manager.createSession({ ...config, paneId: 'other' })).toThrow(
      'does not belong',
    )
    expect(spawn).toHaveBeenCalledTimes(1)
  })
})

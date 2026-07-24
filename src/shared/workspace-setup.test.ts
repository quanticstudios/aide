import { describe, expect, it } from 'vitest'

import {
  MAX_PROJECT_SETUP_COMMAND_LENGTH,
  formatWorkspaceSetupStatus,
  normalizeProjectSetupCommand,
  type WorkspaceSetupSnapshot,
} from './workspace-setup'

function setup(state: WorkspaceSetupSnapshot['state']): WorkspaceSetupSnapshot {
  return {
    attempt: 0,
    commandRequired: state !== 'not-required',
    endedAt: null,
    errorSummary: null,
    exitCode: null,
    outputByteLength: 0,
    outputLineCount: 0,
    outputTail: '',
    outputTruncated: false,
    projectSetupRevision: 0,
    revision: 0,
    signal: null,
    startedAt: null,
    state,
    updatedAt: '2026-07-24T00:00:00.000Z',
    workspaceId: 'workspace-1',
  }
}

describe('project setup command contract', () => {
  it('normalizes a bounded local command and treats blank text as clear', () => {
    expect(
      normalizeProjectSetupCommand('  bun install && bun run init  '),
    ).toBe('bun install && bun run init')
    expect(normalizeProjectSetupCommand('   ')).toBeNull()
    expect(normalizeProjectSetupCommand(null)).toBeNull()
  })

  it('rejects non-text, control characters, and oversized commands', () => {
    expect(() => normalizeProjectSetupCommand({})).toThrow('must be text')
    expect(() => normalizeProjectSetupCommand('echo ok\nrm -rf /')).toThrow(
      'control characters',
    )
    expect(() =>
      normalizeProjectSetupCommand(
        'x'.repeat(MAX_PROJECT_SETUP_COMMAND_LENGTH + 1),
      ),
    ).toThrow('at most')
  })

  it('formats a textual status without relying on colour', () => {
    expect(formatWorkspaceSetupStatus(setup('not-run'))).toBe('Setup required')
    expect(formatWorkspaceSetupStatus(setup('running'))).toBe('Setup running')
    expect(formatWorkspaceSetupStatus(setup('failed'))).toBe('Setup failed')
  })
})

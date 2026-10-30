import { describe, expect, it } from 'vitest'

import {
  queueTerminalInput,
  takeTerminalInput,
  terminalCommand,
} from './terminal-input'

describe('terminalCommand', () => {
  it('drops the trailing newline so typing it never presses Enter', () => {
    expect(terminalCommand('bun run test\n')).toBe('bun run test')
    expect(terminalCommand('  ls -la  \r\n')).toBe('ls -la')
  })

  it('refuses text with a line break or another control character inside', () => {
    expect(terminalCommand('cd app\nbun install')).toBeNull()
    expect(terminalCommand('echo a\rrm -rf x')).toBeNull()
    expect(terminalCommand('echo\ta')).toBeNull()
    expect(terminalCommand('echo \u0003')).toBeNull()
    expect(terminalCommand('\n  \n')).toBeNull()
  })
})

describe('queued terminal input', () => {
  it('is taken once', () => {
    queueTerminalInput('terminal-1', 'ls')
    expect(takeTerminalInput('terminal-1')).toBe('ls')
    expect(takeTerminalInput('terminal-1')).toBeUndefined()
  })
})

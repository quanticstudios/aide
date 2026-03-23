import { describe, expect, it } from 'vitest'

import { resolveTerminalLaunchConfig } from './terminal-shell'

describe('resolveTerminalLaunchConfig', () => {
  it('prefers SHELL on unix-like platforms', () => {
    expect(
      resolveTerminalLaunchConfig('linux', { SHELL: '/usr/bin/fish' }),
    ).toEqual({
      args: [],
      command: '/usr/bin/fish',
    })
  })

  it('falls back to bash on unix-like platforms', () => {
    expect(resolveTerminalLaunchConfig('linux', {})).toEqual({
      args: [],
      command: '/bin/bash',
    })
  })

  it('prefers ComSpec on Windows', () => {
    expect(
      resolveTerminalLaunchConfig('win32', {
        ComSpec:
          'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
      }),
    ).toEqual({
      args: [],
      command: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    })
  })
})

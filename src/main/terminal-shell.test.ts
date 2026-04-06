import { describe, expect, it } from 'vitest'

import {
  resolveTerminalLaunchConfig,
  resolveTerminalWorkingDirectory,
} from './terminal-shell'

describe('resolveTerminalLaunchConfig', () => {
  it('prefers SHELL on unix-like platforms', () => {
    expect(
      resolveTerminalLaunchConfig('linux', { SHELL: '/usr/bin/fish' }, 'shell'),
    ).toEqual({
      args: [],
      command: '/usr/bin/fish',
    })
  })

  it('falls back to bash on unix-like platforms', () => {
    expect(resolveTerminalLaunchConfig('linux', {}, 'shell')).toEqual({
      args: [],
      command: '/bin/bash',
    })
  })

  it('prefers ComSpec on Windows', () => {
    expect(
      resolveTerminalLaunchConfig(
        'win32',
        {
          ComSpec:
            'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
        },
        'shell',
      ),
    ).toEqual({
      args: [],
      command: 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
    })
  })

  it('resolves managed provider launch commands explicitly', () => {
    expect(resolveTerminalLaunchConfig('linux', {}, 'claude')).toEqual({
      args: [],
      command: 'claude',
    })
    expect(
      resolveTerminalLaunchConfig(
        'linux',
        { AIDE_CODEX_COMMAND: '/custom/codex' },
        'codex',
      ),
    ).toEqual({
      args: [],
      command: '/custom/codex',
    })
  })

  it('falls back to the home directory when the requested cwd is missing', () => {
    expect(
      resolveTerminalWorkingDirectory(
        '/missing/path',
        '/home/pho7on',
        () => false,
      ),
    ).toBe('/home/pho7on')
  })

  it('keeps the requested cwd when it exists', () => {
    expect(
      resolveTerminalWorkingDirectory(
        '/repo/aide',
        '/home/pho7on',
        (pathValue) => pathValue === '/repo/aide',
      ),
    ).toBe('/repo/aide')
  })
})

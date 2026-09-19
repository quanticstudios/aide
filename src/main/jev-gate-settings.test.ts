import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { JEV_GATE_DEFAULTS } from '../shared/jev-gates'
import { JevGateSettings } from './jev-gate-settings'

describe('JevGateSettings', () => {
  let directory = ''
  let filename = ''

  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'jev-gates-'))
    filename = path.join(directory, 'nested', 'jev-gates.json')
  })
  afterEach(() => rmSync(directory, { recursive: true, force: true }))

  it('returns defaults when nothing is saved', () => {
    const settings = new JevGateSettings(filename)
    expect(settings.get('/work/a')).toEqual({
      effective: JEV_GATE_DEFAULTS,
      global: {},
      workspace: {},
    })
  })

  it('layers global, workspace, and chat overrides', () => {
    const settings = new JevGateSettings(filename)
    settings.update('global', null, { toolGate: { enabled: true } })
    settings.update('workspace', '/work/a', { toolGate: { denyAbove: 0.7 } })
    expect(settings.get('/work/a').effective.toolGate).toEqual({
      enabled: true,
      allowBelow: 0.1,
      denyAbove: 0.7,
    })
    expect(settings.get('/work/b').effective.toolGate.denyAbove).toBe(0.9)
    expect(
      settings.resolve('/work/a', { toolGate: { enabled: false } }).toolGate
        .enabled,
    ).toBe(false)
    expect(new JevGateSettings(filename).get('/work/a').workspace).toEqual({
      toolGate: { denyAbove: 0.7 },
    })
  })

  it('rejects invalid input and a workspace update without a root', () => {
    const settings = new JevGateSettings(filename)
    expect(() =>
      settings.update('global', null, { toolGate: { allowBelow: 2 } }),
    ).toThrow('Invalid Jev gate settings.')
    expect(() => settings.update('workspace', null, {})).toThrow(
      'Workspace Jev gate settings need a workspace.',
    )
  })

  it('fails loudly on a corrupt file', () => {
    writeFileSync(path.join(directory, 'bad.json'), '{')
    expect(() =>
      new JevGateSettings(path.join(directory, 'bad.json')).get(null),
    ).toThrow('Jev gate settings could not be read.')
  })
})

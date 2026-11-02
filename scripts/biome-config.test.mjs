import { spawnSync } from 'node:child_process'
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { expect, it } from 'vitest'

it('checks a checkout inside .worktrees while ignoring its nested worktrees', () => {
  const fixtureRoot = mkdtempSync(join(tmpdir(), 'aide-biome-'))
  const checkout = join(fixtureRoot, '.worktrees', 'checkout')
  const config = readFileSync(new URL('../biome.json', import.meta.url))
  const biome = resolve('node_modules/@biomejs/biome/bin/biome')

  try {
    mkdirSync(join(checkout, '.worktrees', 'nested'), { recursive: true })
    writeFileSync(join(checkout, 'biome.json'), config)
    writeFileSync(join(checkout, 'index.js'), 'export const value = 1\n')
    writeFileSync(
      join(checkout, '.worktrees', 'nested', 'index.js'),
      'invalid {',
    )
    const result = spawnSync(
      process.execPath,
      [biome, 'check', '.', '--assist-enabled=false'],
      { cwd: checkout, encoding: 'utf8' },
    )

    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(result.stdout).toMatch(/Checked 2 files/)
  } finally {
    rmSync(fixtureRoot, { recursive: true, force: true })
  }
})

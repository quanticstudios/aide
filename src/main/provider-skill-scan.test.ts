import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'

import {
  resolveProviderSkill,
  scanProviderSkills,
  scanSkillFiles,
} from './provider-skill-scan'

let root: string | null = null

afterEach(() => {
  if (root) rmSync(root, { force: true, recursive: true })
  root = null
})

function writeSkill(directory: string, folder: string, text: string): void {
  mkdirSync(path.join(directory, folder), { recursive: true })
  writeFileSync(path.join(directory, folder, 'SKILL.md'), text)
}

it('reads Claude and Codex skills from their folders, workspace skills overriding the user’s', async () => {
  root = mkdtempSync(path.join(tmpdir(), 'aide-skill-scan-'))
  const home = path.join(root, 'home')
  const cwd = path.join(root, 'workspace')
  const codexHome = path.join(root, 'codex')
  writeSkill(
    path.join(home, '.claude', 'skills'),
    'review',
    '---\nname: review\ndescription: "User review"\n---\nBody\n',
  )
  writeSkill(
    path.join(cwd, '.claude', 'skills'),
    'review',
    '---\nname: review\ndescription: Workspace review\n---\n',
  )
  writeSkill(path.join(cwd, '.claude', 'skills'), 'bare', 'No frontmatter\n')
  mkdirSync(path.join(cwd, '.claude', 'skills', 'empty'), { recursive: true })
  writeSkill(
    path.join(codexHome, 'skills'),
    'migrate',
    '---\nname: migrate\ndescription: Codex migrate\n---\n',
  )

  const snapshot = await scanProviderSkills(cwd, home, codexHome)

  expect(snapshot.errors).toEqual({})
  expect(snapshot.skills).toEqual(
    expect.arrayContaining([
      {
        description: 'Workspace review',
        id: 'claude:skill:review',
        name: 'review',
        owner: 'Claude',
        provider: 'claude',
      },
      {
        description: 'bare',
        id: 'claude:skill:bare',
        name: 'bare',
        owner: 'Claude',
        provider: 'claude',
      },
      expect.objectContaining({
        description: 'Codex migrate',
        id: expect.stringMatching(/^codex:skill:[0-9a-f]{16}$/),
        name: 'migrate',
        provider: 'codex',
      }),
    ]),
  )
  expect(snapshot.skills).toHaveLength(3)
})

it('returns no skills when no folder exists', async () => {
  root = mkdtempSync(path.join(tmpdir(), 'aide-skill-scan-'))
  expect(
    await scanProviderSkills(root, root, path.join(root, 'codex')),
  ).toEqual({ errors: {}, skills: [] })
})

it('resolves a listed skill to its native name, and a Codex skill to its file', async () => {
  root = mkdtempSync(path.join(tmpdir(), 'aide-skill-scan-'))
  const codexHome = path.join(root, 'codex')
  writeSkill(
    path.join(root, '.claude', 'skills'),
    'review',
    '---\nname: review\n---\n',
  )
  writeSkill(
    path.join(codexHome, 'skills'),
    'migrate',
    '---\nname: migrate\n---\n',
  )
  const files = await scanSkillFiles(root, root, codexHome)
  const codex = files.find((file) => file.skill.provider === 'codex')?.skill

  expect(
    resolveProviderSkill(files, {
      provider: 'claude',
      id: 'claude:skill:review',
    }),
  ).toEqual({
    id: 'claude:skill:review',
    nativeName: 'review',
    nativePath: undefined,
    provider: 'claude',
  })
  expect(resolveProviderSkill(files, codex)).toMatchObject({
    nativeName: 'migrate',
    nativePath: path.join(codexHome, 'skills', 'migrate', 'SKILL.md'),
  })
  expect(() =>
    resolveProviderSkill(files, {
      provider: 'codex',
      id: 'claude:skill:review',
    }),
  ).toThrow('Selected provider skill is unavailable.')
})

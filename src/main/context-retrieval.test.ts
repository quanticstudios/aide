import { execFileSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { retrieveContext, validateContextRevisions } from './context-retrieval'

const tempRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    tempRoots
      .splice(0)
      .map((root) => rm(root, { force: true, recursive: true })),
  )
})

function git(root: string, args: string[]): void {
  execFileSync('git', args, { cwd: root, stdio: 'ignore' })
}

async function repository(): Promise<string> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'aide-context-retrieval-'))
  tempRoots.push(root)
  git(root, ['init'])
  git(root, ['config', 'user.email', 'test@example.com'])
  git(root, ['config', 'user.name', 'Test User'])
  return root
}

describe('retrieveContext', () => {
  it('keeps safe instructions and explicit evidence while excluding unsafe Git paths', async () => {
    const root = await repository()
    const outside = await mkdtemp(
      path.join(os.tmpdir(), 'aide-context-escape-'),
    )
    tempRoots.push(outside)
    await mkdir(path.join(root, 'src'), { recursive: true })
    await writeFile(
      path.join(root, 'AGENTS.md'),
      'Use the local conventions.\n',
    )
    await writeFile(path.join(root, 'src', 'CLAUDE.md'), 'Test the parser.\n')
    await writeFile(
      path.join(root, 'src', 'parser.ts'),
      'export const parseTask = () => true\n',
    )
    await writeFile(path.join(root, '.env'), 'API_KEY=hidden\n')
    await writeFile(
      path.join(root, 'ignored.ts'),
      'export const ignored = true\n',
    )
    await writeFile(path.join(root, '.gitignore'), 'ignored.ts\n')
    await writeFile(path.join(root, 'binary.dat'), Buffer.from([0, 1, 2]))
    await writeFile(
      path.join(outside, 'outside.ts'),
      'export const outside = true\n',
    )
    await symlink(
      path.join(outside, 'outside.ts'),
      path.join(root, 'src', 'escape.ts'),
    )
    git(root, [
      'add',
      'AGENTS.md',
      'src',
      '.env',
      'binary.dat',
      '.gitignore',
      '--force',
      'ignored.ts',
    ])
    git(root, ['commit', '-m', 'fixture'])

    const context = await retrieveContext({
      task: 'Fix src/parser.ts and use parser behavior.',
      workspaceRoot: root,
    })

    expect(context.mandatory.map((excerpt) => excerpt.path)).toEqual([
      'AGENTS.md',
      'src/CLAUDE.md',
      'src/parser.ts',
    ])
    expect(context.candidates.map((excerpt) => excerpt.path)).not.toContain(
      '.env',
    )
    expect(context.candidates.map((excerpt) => excerpt.path)).not.toContain(
      'binary.dat',
    )
    expect(context.candidates.map((excerpt) => excerpt.path)).not.toContain(
      'ignored.ts',
    )
    expect(context.candidates.map((excerpt) => excerpt.path)).not.toContain(
      'src/escape.ts',
    )
    expect(context.mandatory[2].contentRevision).toMatch(/^[a-f0-9]{64}$/)
    expect(context.mandatory[2].startLine).toBe(1)
    expect(context.mandatory[2].endLine).toBe(2)

    await writeFile(
      path.join(root, 'src', 'parser.ts'),
      'export const parseTask = () => false\n',
    )
    const changed = await retrieveContext({
      task: 'Fix src/parser.ts',
      workspaceRoot: root,
    })

    expect(
      changed.mandatory.find((excerpt) => excerpt.path === 'src/parser.ts')
        ?.contentRevision,
    ).not.toBe(context.mandatory[2].contentRevision)
    await expect(
      validateContextRevisions(root, context.mandatory),
    ).rejects.toThrow('changed after retrieval')

    await rm(path.join(root, 'src', 'parser.ts'))
    await symlink(
      path.join(outside, 'outside.ts'),
      path.join(root, 'src', 'parser.ts'),
    )
    await expect(
      validateContextRevisions(root, changed.mandatory),
    ).rejects.toThrow('is unavailable')
  })

  it('does not traverse outside a non-Git workspace and respects cancellation', async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), 'aide-context-nongit-'))
    const outside = await mkdtemp(
      path.join(os.tmpdir(), 'aide-context-outside-'),
    )
    tempRoots.push(root, outside)
    await writeFile(path.join(root, 'AGENTS.md'), 'Stay in the workspace.\n')
    await writeFile(
      path.join(outside, 'secret.ts'),
      'export const secret = true\n',
    )

    const context = await retrieveContext({
      task: 'Inspect ../aide-context-outside/secret.ts',
      workspaceRoot: root,
    })

    expect(context.mandatory.map((excerpt) => excerpt.path)).toEqual([
      'AGENTS.md',
    ])
    expect(context.candidates).toEqual([])

    const controller = new AbortController()
    controller.abort()
    await expect(
      retrieveContext({
        task: 'Inspect AGENTS.md',
        signal: controller.signal,
        workspaceRoot: root,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })
})

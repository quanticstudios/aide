import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
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
  it('does not require version numbers as files when preparing a message', async () => {
    const root = await repository()
    await writeFile(path.join(root, 'README.md'), '# Models\n')
    const context = await retrieveContext({
      task: 'The list shows outdated Fable, there is 5.1 now. Update README.md for v0.0.2 and 0.0.3-beta.1.',
      workspaceRoot: root,
    })

    expect(context.mandatory.map((excerpt) => excerpt.path)).toEqual([
      'README.md',
    ])
    await writeFile(path.join(root, '5.1'), 'A file with a numeric name\n')
    const explicit = await retrieveContext({
      task: 'Inspect ./5.1',
      workspaceRoot: root,
    })
    expect(explicit.mandatory.map((excerpt) => excerpt.path)).toEqual(['5.1'])
    await expect(
      retrieveContext({ task: 'Inspect missing.ts', workspaceRoot: root }),
    ).rejects.toThrow('Required context file "missing.ts" is unavailable.')
    const url = await retrieveContext({
      task: 'https://github.com/Graphify-Labs/graphify run graphify here so that we can speed up our process',
      workspaceRoot: root,
    })
    expect(url.mandatory).toEqual([])
  })

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
    await writeFile(path.join(root, '.gitignore'), 'ignored*\n')
    await writeFile(path.join(root, 'binary.dat'), Buffer.from([0, 1, 2]))
    await writeFile(
      path.join(root, 'ignored\ttracked.ts'),
      'export const ignoredName = true\n',
    )
    for (let index = 0; index < 520; index += 1) {
      await writeFile(
        path.join(root, `candidate-${index.toString().padStart(3, '0')}.ts`),
        'export const candidate = true\n',
      )
    }
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
      'ignored\ttracked.ts',
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
    expect(context.candidates.map((excerpt) => excerpt.path)).not.toContain(
      'ignored\ttracked.ts',
    )
    expect(context.candidates).toHaveLength(16)
    expect(context.mandatory[2].contentRevision).toMatch(/^[a-f0-9]{64}$/)
    expect(context.mandatory[2].startLine).toBe(1)
    expect(context.mandatory[2].endLine).toBe(1)

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

    await writeFile(
      path.join(root, 'src', 'large.ts'),
      Array.from(
        { length: 2_000 },
        (_, index) => `export const value${index + 1} = ${index + 1}\n`,
      ).join(''),
    )
    const largeFileContext = await retrieveContext({
      task: 'Fix src/large.ts:1500',
      workspaceRoot: root,
    })
    const largeExcerpt = largeFileContext.mandatory.find(
      (excerpt) => excerpt.path === 'src/large.ts',
    )
    expect(largeExcerpt?.startLine).toBe(1498)
    expect(largeExcerpt?.endLine).toBeGreaterThanOrEqual(1500)
    expect(largeFileContext.omitted).toContainEqual(
      expect.objectContaining({
        path: 'src/large.ts',
        reason: expect.stringContaining('full file exceeds the excerpt budget'),
      }),
    )
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

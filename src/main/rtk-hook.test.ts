import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import { createRtkPreToolUseHook } from './rtk-hook'

const input = {
  cwd: '/tmp',
  hook_event_name: 'PreToolUse' as const,
  session_id: 'session',
  tool_input: { command: 'git status' },
  tool_name: 'Bash',
  tool_use_id: 'call-1',
  transcript_path: '/tmp/transcript',
}
const callOptions = { signal: new AbortController().signal }
const tempDirs: string[] = []

function tempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'aide-rtk-'))
  tempDirs.push(dir)
  return dir
}

function fakeRtkDir(): string {
  const dir = tempDir()
  writeFileSync(
    path.join(dir, 'rtk'),
    `#!/bin/sh
cat >/dev/null
printf '%s' '{"hookSpecificOutput":{"hookEventName":"PreToolUse","updatedInput":{"command":"rtk git status"}}}'
`,
  )
  chmodSync(path.join(dir, 'rtk'), 0o755)
  return dir
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { force: true, recursive: true })
  }
})

describe('createRtkPreToolUseHook', () => {
  it('returns the rewritten input from rtk on PATH', async () => {
    const hook = createRtkPreToolUseHook({
      HOME: '/nonexistent',
      PATH: fakeRtkDir(),
    })

    await expect(hook(input, 'call-1', callOptions)).resolves.toEqual({
      hookSpecificOutput: {
        hookEventName: 'PreToolUse',
        updatedInput: { command: 'rtk git status' },
      },
    })
  })

  it('is a no-op when rtk is not installed', async () => {
    const empty = tempDir()
    const hook = createRtkPreToolUseHook({ HOME: empty, PATH: empty })

    await expect(hook(input, 'call-1', callOptions)).resolves.toEqual({})
  })

  it('ignores tools other than Bash', async () => {
    const hook = createRtkPreToolUseHook({ HOME: '/nonexistent', PATH: '' })

    await expect(
      hook({ ...input, tool_name: 'Read' }, 'call-1', callOptions),
    ).resolves.toEqual({})
  })
})

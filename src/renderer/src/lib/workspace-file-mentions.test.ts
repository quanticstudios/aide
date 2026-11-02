import { describe, expect, it, vi } from 'vitest'

import {
  appendWorkspaceFileAttachment,
  getWorkspaceFileMention,
  removeWorkspaceFileMention,
  resolveMentionMenuSelection,
  WorkspaceFileMentionSearch,
} from './workspace-file-mentions'

function deferred<T>(): {
  promise: Promise<T>
  resolve: (value: T) => void
} {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => {
    resolve = complete
  })
  return { promise, resolve }
}

describe('workspace file mentions', () => {
  it('finds a trailing file query without treating an email as a mention', () => {
    expect(getWorkspaceFileMention('Please inspect @flee', 20)).toEqual({
      endIndex: 20,
      query: 'flee',
      startIndex: 15,
    })
    expect(getWorkspaceFileMention('person@example.com', 18)).toBeNull()
    expect(
      removeWorkspaceFileMention('Please inspect @flee next', {
        endIndex: 20,
        query: 'flee',
        startIndex: 15,
      }),
    ).toBe('Please inspect next')
  })

  it('leaves no trailing space when the mention ends the draft', () => {
    expect(
      removeWorkspaceFileMention('look at @REA', {
        endIndex: 12,
        query: 'REA',
        startIndex: 8,
      }),
    ).toBe('look at')
  })

  it('resolves Enter or Tab to the first file before any skill', () => {
    expect(resolveMentionMenuSelection(0, ['README.md'], 6)).toEqual({
      filePath: 'README.md',
      kind: 'file',
    })
  })

  it('resolves a skill listed after the files', () => {
    expect(resolveMentionMenuSelection(1, ['README.md'], 1)).toEqual({
      kind: 'skill',
      skillIndex: 0,
    })
  })

  it('appends the selected path as a removable workspace attachment', () => {
    expect(
      appendWorkspaceFileAttachment([], 'src/shared/fleet.ts', 'attachment-1'),
    ).toEqual([
      {
        id: 'attachment-1',
        kind: 'workspace-file',
        path: 'src/shared/fleet.ts',
      },
    ])
  })

  it('ignores a stale search response after a newer query resolves', async () => {
    const first = deferred<readonly string[]>()
    const second = deferred<readonly string[]>()
    const accept = vi.fn()
    const reject = vi.fn()
    const search = new WorkspaceFileMentionSearch()

    const firstRun = search.run(() => first.promise, accept, reject)
    const secondRun = search.run(() => second.promise, accept, reject)
    second.resolve(['src/shared/fleet.ts'])
    await secondRun
    first.resolve(['src/shared/file.ts'])
    await firstRun

    expect(accept).toHaveBeenCalledOnce()
    expect(accept).toHaveBeenCalledWith(['src/shared/fleet.ts'])
    expect(reject).not.toHaveBeenCalled()
  })
})

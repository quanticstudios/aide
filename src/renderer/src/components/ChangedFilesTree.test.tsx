// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import type { TurnCheckpointDiffFile } from '../../../shared/checkpoints'
import ChangedFilesTree, { buildChangedFileRows } from './ChangedFilesTree'

function file(
  path: string,
  additions: number,
  deletions: number,
): TurnCheckpointDiffFile {
  return { additions, deletions, patch: '', path, status: 'modified' }
}

const files = [
  file('src/main/git.ts', 3, 1),
  file('src/main/index.ts', 2, 0),
  file('README.md', 1, 1),
  file('src/renderer/app.tsx', 4, 2),
]

describe('buildChangedFileRows', () => {
  it('collapses folders to one row with their totals', () => {
    expect(
      buildChangedFileRows(files, () => false).map((row) => [
        row.name,
        row.additions,
        row.deletions,
      ]),
    ).toEqual([
      ['src', 9, 3],
      ['README.md', 1, 1],
    ])
  })

  it('lists files under open folders and merges single-child folder chains', () => {
    expect(
      buildChangedFileRows(
        [file('a/b/c/one.ts', 1, 0), file('a/b/c/two.ts', 0, 1)],
        () => true,
      ).map((row) => [row.depth, row.name, row.path]),
    ).toEqual([
      [0, 'a/b/c', 'a/b/c'],
      [1, 'one.ts', 'a/b/c/one.ts'],
      [1, 'two.ts', 'a/b/c/two.ts'],
    ])
  })
})

describe('ChangedFilesTree', () => {
  it('expands a folder on click and selects a file', async () => {
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    // why: happy-dom never lays out, so the virtualizer would see a 0px viewport and mount no rows.
    vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(288)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    const onSelect = vi.fn()

    await act(async () =>
      root.render(
        <ChangedFilesTree
          defaultExpanded={false}
          files={files}
          onSelect={onSelect}
        />,
      ),
    )
    expect(container.querySelector('[data-path="src/main"]')).toBeNull()

    await act(async () =>
      container.querySelector<HTMLButtonElement>('[data-path="src"]')?.click(),
    )
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-path="src/main"]')
        ?.click(),
    )
    await act(async () =>
      container
        .querySelector<HTMLButtonElement>('[data-path="src/main/git.ts"]')
        ?.click(),
    )
    expect(onSelect).toHaveBeenCalledWith('src/main/git.ts')

    await act(async () => root.unmount())
    container.remove()
    vi.restoreAllMocks()
  })
})

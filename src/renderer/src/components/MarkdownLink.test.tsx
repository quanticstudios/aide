// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AideApi } from '../../../shared/ipc'
import { WorkspaceIdContext } from '../lib/workspace-id'
import MarkdownContent from './MarkdownContent'

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null

afterEach(() => {
  act(() => root?.unmount())
  root = null
  document.body.innerHTML = ''
})

function render(text: string, workspaceId: string | null = 'workspace-1') {
  const aide = {
    openExternal: vi.fn(async () => undefined),
    openWorkspaceFile: vi.fn(async () => undefined),
  }
  window.aide = aide as unknown as AideApi
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  act(() =>
    root?.render(
      createElement(
        WorkspaceIdContext,
        { value: workspaceId },
        createElement(MarkdownContent, { text }),
      ),
    ),
  )
  return { aide, container }
}

function click(element: Element, init: MouseEventInit = {}, type = 'click') {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    ...init,
  })
  act(() => {
    element.dispatchEvent(event)
  })
  return event
}

describe('MarkdownLink', () => {
  it('opens links through main on click, Ctrl+click and middle-click', () => {
    const { aide, container } = render(
      'Read [the docs](https://example.com/docs).',
    )
    const link = container.querySelector('a')
    if (!link) throw new Error('Link missing.')

    expect(click(link).defaultPrevented).toBe(true)
    expect(click(link, { ctrlKey: true }).defaultPrevented).toBe(true)
    expect(click(link, { button: 1 }, 'auxclick').defaultPrevented).toBe(true)
    click(link, { button: 2 }, 'auxclick')

    expect(aide.openExternal).toHaveBeenCalledTimes(3)
    expect(aide.openExternal).toHaveBeenCalledWith('https://example.com/docs')
  })

  it('turns workspace paths in inline code and links into chips that open the file', () => {
    const { aide, container } = render(
      'Edit `src/foo.ts:42`, see [the test](src/foo.test.ts#L7), not `window.aide`.',
    )
    const chips = container.querySelectorAll('button')

    expect([...chips].map((chip) => chip.textContent)).toEqual([
      'src/foo.ts:42',
      'the test',
    ])
    expect(container.querySelector('code')?.textContent).toBe('window.aide')
    expect(container.querySelector('a')).toBeNull()

    for (const chip of chips) click(chip)
    expect(aide.openWorkspaceFile.mock.calls).toEqual([
      ['workspace-1', 'src/foo.ts', 42],
      ['workspace-1', 'src/foo.test.ts', 7],
    ])
  })

  it('renders links with unsafe schemes as plain text', () => {
    const { container } = render(
      '[bad](javascript:alert(1)) [file](file:///etc/passwd)',
    )

    expect(container.querySelector('a')).toBeNull()
    expect(container.textContent).toBe('bad file')
  })

  it('leaves inline code inside a link alone', () => {
    const { container } = render('[`src/foo.ts`](https://example.com)')

    expect(container.querySelector('a code')?.textContent).toBe('src/foo.ts')
  })

  it('loads remote images lazily with a size cap', () => {
    const { container } = render('![chart](https://example.com/chart.png)')
    const image = container.querySelector('img')

    expect(image?.getAttribute('loading')).toBe('lazy')
    expect(image?.getAttribute('referrerpolicy')).toBe('no-referrer')
    expect(image?.className).toContain('max-h-96')
  })
})

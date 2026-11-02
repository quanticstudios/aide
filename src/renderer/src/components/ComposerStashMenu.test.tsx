// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import ComposerStashMenu from './ComposerStashMenu'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

afterEach(() => {
  document.body.innerHTML = ''
})

describe('ComposerStashMenu', () => {
  it('closes on Escape and returns focus to its button', () => {
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    act(() =>
      root.render(
        <ComposerStashMenu
          onOpen={vi.fn()}
          onRemove={vi.fn()}
          onRestore={vi.fn()}
          stashes={[
            {
              createdAt: new Date().toISOString(),
              draft: { attachments: [], text: 'half a thought' },
              id: 'stash-1',
            },
          ]}
        />,
      ),
    )
    const trigger = container.querySelector('button')
    act(() => trigger?.click())
    container
      .querySelector<HTMLButtonElement>(
        '[data-testid="composer-stash-menu"] button',
      )
      ?.focus()
    expect(
      container.querySelector('[data-testid="composer-stash-menu"]'),
    ).not.toBeNull()

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    })
    expect(
      container.querySelector('[data-testid="composer-stash-menu"]'),
    ).toBeNull()
    expect(document.activeElement).toBe(trigger)
    act(() => root.unmount())
  })
})

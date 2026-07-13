import { lazy } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'

import { PaneLoadBoundary, PaneLoadError } from './PaneLoadBoundary'

describe('PaneLoadBoundary', () => {
  it('keeps a named loading state visible while a pane chunk is pending', () => {
    const PendingPane = lazy(
      () => new Promise<{ default: () => null }>(() => {}),
    )

    const markup = renderToStaticMarkup(
      <PaneLoadBoundary paneId="git" paneName="Git review">
        <PendingPane />
      </PaneLoadBoundary>,
    )

    expect(markup).toContain('data-testid="pane-loading-git"')
    expect(markup).toContain('Loading Git review…')
    expect(markup).toContain(
      'Preparing this pane without blocking workspace navigation.',
    )
  })

  it('uses a named recovery state when a pane chunk cannot load', () => {
    const markup = renderToStaticMarkup(
      <PaneLoadError
        error={new Error('Chunk request failed')}
        paneId="git"
        paneName="Git review"
      />,
    )

    expect(markup).toContain('data-testid="pane-load-error-git"')
    expect(markup).toContain('Git review could not load')
    expect(markup).toContain('Reload the app window and try again.')
  })
})

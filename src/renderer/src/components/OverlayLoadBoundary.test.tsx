import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { OverlayLoadError } from './OverlayLoadBoundary'

describe('OverlayLoadError', () => {
  it('keeps a failed deferred view recoverable', () => {
    const markup = renderToStaticMarkup(
      <OverlayLoadError name="Settings" onClose={vi.fn()} onRetry={vi.fn()} />,
    )

    expect(markup).toContain('Settings could not open')
    expect(markup).toContain('Back to app')
    expect(markup).toContain('Reload app')
  })
})

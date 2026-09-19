import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { UpdatePresentation } from '../lib/update-presentation'
import UpdateIndicator from './UpdateIndicator'

function presentation(
  overrides: Partial<UpdatePresentation> = {},
): UpdatePresentation {
  return {
    canCheck: false,
    canDownload: true,
    canRestart: false,
    canRetry: false,
    canSnooze: false,
    description: 'A critical update is available.',
    icon: 'critical',
    indicatorLabel: 'Critical update available',
    indicatorVisible: true,
    isCritical: true,
    isSnoozed: false,
    needsHealthDisclosure: false,
    tone: 'critical',
    ...overrides,
  }
}

describe('UpdateIndicator', () => {
  it('announces critical state assertively without opening a modal', () => {
    const markup = renderToStaticMarkup(
      <UpdateIndicator onOpen={vi.fn()} presentation={presentation()} />,
    )

    expect(markup).toContain('role="alert"')
    expect(markup).toContain('aria-live="assertive"')
    expect(markup).toContain('Critical update available')
    expect(markup).not.toContain('role="dialog"')
  })

  it('uses a polite status for normal updates', () => {
    const markup = renderToStaticMarkup(
      <UpdateIndicator
        onOpen={vi.fn()}
        presentation={presentation({
          icon: 'available',
          indicatorLabel: 'Update available',
          isCritical: false,
          tone: 'info',
        })}
      />,
    )

    expect(markup).toContain('role="status"')
    expect(markup).toContain('aria-live="polite"')
  })
})

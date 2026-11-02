import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { threadError } from '../../../shared/provider-errors'
import ThreadErrorBanner from './ThreadErrorBanner'

describe('threadError', () => {
  const failed = {
    lastError: 'Fake managed provider error',
    turns: [
      {
        completedAt: '2026-11-02T10:00:01.000Z',
        id: 'turn-1',
        provider: 'claude' as const,
        startedAt: '2026-11-02T10:00:00.000Z',
        state: 'failed' as const,
      },
    ],
  }

  it('reports a failure with no known fix', () => {
    expect(threadError(failed)).toEqual({
      kind: null,
      message: 'Fake managed provider error',
    })
  })

  it('stays quiet about a turn the user stopped', () => {
    const [turn] = failed.turns
    if (!turn) throw new Error('no turn')
    expect(
      threadError({
        lastError: 'Turn interrupted',
        turns: [{ ...turn, state: 'interrupted' }],
      }),
    ).toBeNull()
  })
})

describe('ThreadErrorBanner', () => {
  it('shows an unclassified error with its message and Retry', () => {
    const markup = renderToStaticMarkup(
      <ThreadErrorBanner
        kind={null}
        message="Fake managed provider error"
        onRetry={vi.fn()}
        provider="claude"
      />,
    )
    expect(markup).toContain('Claude stopped with an error')
    expect(markup).toContain('Fake managed provider error')
    expect(markup).toContain('Retry')
  })

  it('renders backticked commands as code, not raw backticks', () => {
    const markup = renderToStaticMarkup(
      <ThreadErrorBanner
        kind="auth"
        message="Not logged in"
        onRetry={vi.fn()}
        provider="claude"
      />,
    )
    expect(markup).not.toContain('`')
    expect(markup).toContain('<code')
  })
})

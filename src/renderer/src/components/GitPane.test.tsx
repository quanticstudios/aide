import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { GitLineFeedback } from './GitPane'

describe('GitLineFeedback', () => {
  it('starts collapsed so the diff keeps the space, and names agent panes readably', () => {
    const markup = renderToStaticMarkup(
      <GitLineFeedback
        feedback=""
        isSendDisabled
        line=""
        onFeedbackChange={vi.fn()}
        onLineChange={vi.fn()}
        onSelectSession={vi.fn()}
        onSend={vi.fn()}
        selectedSessionId="session-a"
        sessions={[
          { provider: 'claude', sessionId: 'session-a' },
          { provider: 'codex', sessionId: 'session-b' },
        ]}
      />,
    )

    expect(markup).toMatch(/<details(?![^>]*\bopen\b)[^>]*>/)
    expect(markup).toContain('Agent 1 · Claude')
    expect(markup).toContain('Agent 2 · Codex')
    expect(markup).not.toContain('copy-instance')
  })
})

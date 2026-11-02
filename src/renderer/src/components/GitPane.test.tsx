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
          { content: [], provider: 'claude', sessionId: 'session-a' },
          {
            content: [
              {
                id: 'prompt',
                kind: 'user-prompt',
                provider: 'codex',
                text: 'fix the **login** flow',
                turnId: 'turn-1',
                updatedAt: '2026-11-02T10:00:00.000Z',
              },
            ],
            provider: 'codex',
            sessionId: 'session-b',
          },
        ]}
      />,
    )

    expect(markup).toMatch(/<details(?![^>]*\bopen\b)[^>]*>/)
    expect(markup).toContain('Agent 1 · Claude')
    expect(markup).toContain('fix the login flow · Codex')
    expect(markup).not.toContain('copy-instance')
  })
})

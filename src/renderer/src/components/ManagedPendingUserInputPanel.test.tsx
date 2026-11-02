import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import ManagedPendingUserInputPanel from './ManagedPendingUserInputPanel'

describe('ManagedPendingUserInputPanel', () => {
  it('never asks to leave the answer blank, since picking an option fills it', () => {
    const markup = renderToStaticMarkup(
      <ManagedPendingUserInputPanel
        answers={{}}
        onAnswerChange={vi.fn()}
        onSubmit={vi.fn()}
        request={{
          detail: null,
          id: 'input-1',
          questions: [
            {
              id: 'q1',
              options: [{ id: 'a', label: 'Yes' }],
              prompt: 'Proceed?',
            },
          ],
        }}
      />,
    )
    expect(markup).not.toContain('leave this blank')
    expect(markup).toContain('Pick an option above or type your own answer')
  })
})

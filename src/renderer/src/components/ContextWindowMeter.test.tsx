import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import ContextWindowMeter from './ContextWindowMeter'

describe('ContextWindowMeter', () => {
  it('does not label cumulative query totals as context occupancy', () => {
    const markup = renderToStaticMarkup(
      <ContextWindowMeter
        usage={{ inputTokens: 100, outputTokens: 20, maxTokens: 200 }}
      />,
    )
    expect(markup).toContain('120 tokens reported')
    expect(markup).not.toContain('60%')
    expect(markup).not.toContain('context used')
  })

  it('uses the latest request context instead of lifetime token totals', () => {
    const markup = renderToStaticMarkup(
      <ContextWindowMeter
        usage={{
          inputTokens: 9000,
          outputTokens: 1000,
          contextTokens: 100,
          maxTokens: 200,
        }}
      />,
    )
    expect(markup).toContain('50%')
    expect(markup).toContain('context used')
  })
})

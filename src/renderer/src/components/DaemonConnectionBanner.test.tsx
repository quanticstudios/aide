import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DaemonConnection } from '../lib/daemon-transport'
import DaemonConnectionBanner from './DaemonConnectionBanner'

function render(connection: DaemonConnection): string {
  return renderToStaticMarkup(
    <DaemonConnectionBanner
      transport={{
        getConnection: () => connection,
        subscribeConnection: () => () => undefined,
      }}
    />,
  )
}

describe('DaemonConnectionBanner', () => {
  it('shows nothing while connected', () => {
    expect(render({ status: 'connected', server: 'pitwall 0.2.0' })).toBe('')
  })

  it('says aide is reconnecting and read-only', () => {
    const markup = render({ status: 'reconnecting', reason: 'daemon exiting' })
    expect(markup).toContain(
      'Reconnecting to pitwall... Read-only until it is back.',
    )
    expect(markup).toContain('role="status"')
  })

  it('shows the version mismatch as an alert', () => {
    const markup = render({
      status: 'incompatible',
      message:
        'Update aide: pitwall speaks web protocol version 2 and this aide speaks 1.',
    })
    expect(markup).toContain(
      'Update aide: pitwall speaks web protocol version 2',
    )
    expect(markup).toContain('role="alert"')
  })
})

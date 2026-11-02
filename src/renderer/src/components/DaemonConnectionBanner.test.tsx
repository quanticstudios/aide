import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { DaemonConnection } from '../lib/daemon-transport'
import DaemonConnectionBanner from './DaemonConnectionBanner'
import PitwallSetupCard from './PitwallSetupCard'

function render(connection: DaemonConnection): string {
  return renderToStaticMarkup(
    <DaemonConnectionBanner
      transport={{
        checkAgain: () => undefined,
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

  it.each([
    [
      { status: 'missing', platform: 'linux' },
      'pitwall is not installed',
      'scripts/get.sh | sh',
    ],
    [
      { status: 'missing', platform: 'win32' },
      'pitwall is not installed',
      'scripts/get.ps1 | iex',
    ],
    [
      { status: 'outdated', required: '0.1.7', version: 'v0.1.6' },
      'aide needs pitwall 0.1.7 or newer, and this one is v0.1.6.',
      'pitwall update',
    ],
    [
      { status: 'noEndpoint' },
      'pitwall is not listening for aide',
      'enabled = true',
    ],
    [
      {
        status: 'failed',
        log: '/state/pitwall/crash.log',
        reason: 'listen unix /run/pitwall.sock: bind: invalid argument',
      },
      'Its full output is in /state/pitwall/crash.log.',
      'listen unix /run/pitwall.sock: bind: invalid argument',
    ],
  ] as const)('tells the user what to run when pitwall is %o', (pitwall, text, command) => {
    const markup = render({ status: 'unavailable', pitwall })
    expect(markup).toContain(text)
    expect(markup).toContain(command)
    expect(markup).toContain('Check again')
    expect(markup).not.toContain('built-in')
    expect(markup).toContain('role="alert"')
  })

  it('offers to turn the web listener on only where the app can write the config', () => {
    const card = (onTurnOn?: () => Promise<unknown>) =>
      renderToStaticMarkup(
        <PitwallSetupCard
          onCheckAgain={() => undefined}
          onTurnOn={onTurnOn}
          pitwall={{ status: 'noEndpoint' }}
        />,
      )
    expect(card(async () => undefined)).toContain('Turn on for aide')
    expect(card()).not.toContain('Turn on for aide')
    expect(
      renderToStaticMarkup(
        <PitwallSetupCard
          onCheckAgain={() => undefined}
          onTurnOn={async () => undefined}
          pitwall={{ status: 'missing', platform: 'linux' }}
        />,
      ),
    ).not.toContain('Turn on for aide')
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

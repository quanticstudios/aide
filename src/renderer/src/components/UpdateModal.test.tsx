// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import UpdateModal from './UpdateModal'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let unmount = () => {}
afterEach(() => unmount())

describe('UpdateModal', () => {
  it('records only the acknowledgement when Acknowledge is pressed', async () => {
    const onUpdatePreferences = vi.fn(async () => {})
    const noop = vi.fn(async () => {})
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() =>
      root.render(
        <UpdateModal
          actionError={null}
          isOpen
          onCheck={noop}
          onClearActionError={vi.fn()}
          onConfirmRestart={noop}
          onDownload={noop}
          onOpenChange={vi.fn()}
          onRequestRestart={noop}
          onRetry={noop}
          onSnooze={noop}
          onUpdatePreferences={onUpdatePreferences}
          preferences={{
            automaticDownloads: true,
            healthDisclosureAcknowledged: false,
            healthReportingEnabled: false,
            revision: 1,
            snoozedUntil: null,
          }}
          presentationNow={new Date('2026-11-02T12:00:00Z')}
          restartStatus={null}
          snapshot={null}
        />,
      ),
    )
    unmount = () => {
      act(() => root.unmount())
      host.remove()
    }

    const button = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Acknowledge health report disclosure"]',
    )
    if (!button) throw new Error('Acknowledge button missing')
    await act(async () => button.click())

    expect(onUpdatePreferences).toHaveBeenCalledWith({
      healthDisclosureAcknowledged: true,
    })
  })
})

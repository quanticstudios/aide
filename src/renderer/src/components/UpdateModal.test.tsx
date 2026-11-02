// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import UpdateModal from './UpdateModal'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let unmount = () => {}
afterEach(() => unmount())

describe('UpdateModal', () => {
  it('leaves health reporting off when Acknowledge is pressed', async () => {
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
            healthReportingEnabled: true,
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
      healthReportingEnabled: false,
    })
  })

  it('keeps the health switch focused and enabled while its change saves', async () => {
    const onUpdatePreferences = vi.fn(() => new Promise<void>(() => {}))
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
            healthDisclosureAcknowledged: true,
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

    const toggle = [
      ...document.querySelectorAll<HTMLInputElement>('input[role="switch"]'),
    ].find((input) =>
      input
        .closest('label')
        ?.textContent?.includes('Share privacy-bounded update health reports'),
    )
    if (!toggle) throw new Error('health switch missing')
    toggle.focus()
    await act(async () => toggle.click())

    expect(onUpdatePreferences).toHaveBeenCalledWith({
      healthReportingEnabled: true,
    })
    expect(toggle.disabled).toBe(false)
    expect(document.activeElement).toBe(toggle)
  })
})

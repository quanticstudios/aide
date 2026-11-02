// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  JEV_CONSENT_REQUIRED_MESSAGE,
  JEV_CREDENTIAL_REQUIRED_MESSAGE,
  type JevSettingsStatus,
} from '../../../shared/jev'
import JevSetup, { getJevFirstRunMessage } from './JevSetup'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

const ready: JevSettingsStatus = {
  allowProcessing: true,
  canStoreCredential: true,
  hasCredential: true,
}

describe('getJevFirstRunMessage', () => {
  it('says before the first send what the send would be refused for', () => {
    expect(getJevFirstRunMessage({ ...ready, hasCredential: false })).toBe(
      JEV_CREDENTIAL_REQUIRED_MESSAGE,
    )
    expect(
      getJevFirstRunMessage({
        ...ready,
        allowProcessing: false,
        hasCredential: false,
      }),
    ).toBe(JEV_CONSENT_REQUIRED_MESSAGE)
  })

  it('says nothing once Jev is ready, or while its settings load', () => {
    expect(getJevFirstRunMessage(ready)).toBeNull()
    expect(getJevFirstRunMessage(null)).toBeNull()
  })
})

let unmount = () => {}
afterEach(() => {
  unmount()
  vi.unstubAllGlobals()
})

async function renderJevSetup() {
  const updateJevSettings = vi.fn(async () => ready)
  vi.stubGlobal('aide', {
    getJevSettings: vi.fn(async () => ready),
    updateJevSettings,
  })
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  await act(async () => root.render(<JevSetup workspaceId="ws-1" />))
  unmount = () => {
    act(() => root.unmount())
    host.remove()
  }
  return { host, updateJevSettings }
}

describe('JevSetup', () => {
  it('confirms a save and clears the confirmation on the next edit', async () => {
    const { host, updateJevSettings } = await renderJevSetup()
    const form = host.querySelector('form')
    if (!form) throw new Error('form missing')
    expect(host.textContent).not.toContain('Saved')

    await act(async () => {
      form.dispatchEvent(
        new Event('submit', { bubbles: true, cancelable: true }),
      )
    })

    expect(updateJevSettings).toHaveBeenCalledOnce()
    expect(host.textContent).toContain('Saved')
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(1)
    expect(host.querySelector('[role="status"]')?.textContent).toBe('Ready')

    const input = host.querySelector<HTMLInputElement>('input[type="password"]')
    if (!input) throw new Error('key input missing')
    const setValue = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )?.set
    act(() => {
      setValue?.call(input, 'sk-new')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(host.textContent).not.toContain('Saved')
  })
})

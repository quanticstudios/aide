// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resolveJevGates } from '../../../shared/jev-gates'

import SettingsPage, {
  filterSettingsShortcutGroups,
  SETTINGS_SHORTCUT_GROUPS,
} from './SettingsPage'

// why: Node's own localStorage global shadows happy-dom's and is undefined without a file.
beforeEach(() => {
  const items = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => items.set(key, value),
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('SettingsPage', () => {
  it('lists shortcuts for workspace, chat, and model controls', () => {
    const shortcuts = SETTINGS_SHORTCUT_GROUPS.flatMap(
      (group) => group.shortcuts,
    )

    expect(shortcuts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: 'Open command palette' }),
        expect.objectContaining({ label: 'Open workspace overview' }),
        expect.objectContaining({ label: 'Send message or submit answers' }),
        expect.objectContaining({ label: 'Choose a visible model' }),
        expect.objectContaining({ label: 'Choose a pane type' }),
      ]),
    )
  })

  it('lists the terminal drawer and the composer menu chords', () => {
    const keys = SETTINGS_SHORTCUT_GROUPS.flatMap((group) =>
      group.shortcuts.map((shortcut) => shortcut.keys.join('+')),
    )

    expect(keys).toEqual(
      expect.arrayContaining([
        'Ctrl+`',
        'Ctrl/Cmd+Shift+M',
        'Ctrl/Cmd+Shift+E',
        'Ctrl/Cmd+Shift+A',
      ]),
    )
  })

  it('filters shortcut labels and descriptions from settings search', () => {
    const groups = filterSettingsShortcutGroups('visible model')

    expect(groups).toHaveLength(1)
    expect(groups[0]?.shortcuts).toEqual([
      expect.objectContaining({ label: 'Choose a visible model' }),
    ])
  })

  it('finds shortcut keys with plus signs and words in either order', () => {
    for (const query of ['Ctrl+B', 'B Ctrl', 'left sidebar']) {
      expect(
        filterSettingsShortcutGroups(query).flatMap((group) => group.shortcuts),
      ).toEqual([expect.objectContaining({ label: 'Toggle left sidebar' })])
    }
  })

  it('renders persisted preferences and searchable shortcut groups', () => {
    const markup = renderToStaticMarkup(
      <SettingsPage
        jevGates={null}
        onClose={vi.fn()}
        onUpdateGlobalJevGates={vi.fn()}
        onOpenUpdate={vi.fn()}
        onUpdatePreferences={vi.fn()}
        updatePreferences={{
          automaticDownloads: true,
          healthDisclosureAcknowledged: true,
          healthReportingEnabled: true,
          revision: 2,
          snoozedUntil: null,
        }}
        updatePreferencesError={null}
        workspaceId={null}
      />,
    )

    expect(markup).toContain('Background task notifications')
    expect(markup).not.toContain('Animations')
    expect(markup).not.toContain('System default')
    expect(markup).not.toContain('Reduced motion')
    expect(markup).not.toContain('Download updates automatically')
    expect(markup).not.toContain('Share update health reports')
    expect(markup).toContain('Search settings')
    expect(markup).toContain('data-slot="input-group"')
    expect(markup).toContain('data-slot="input-group-input"')
    expect(markup).not.toContain('data-slot="input"')
    expect(markup).toContain('Settings categories')
    expect(markup).toContain('Back to app')
    expect(markup).toContain('Appearance')
    expect(markup).not.toContain('Open project by sidebar position')
  })

  it('renders the global gate layer in the Jev gates section', () => {
    const markup = renderToStaticMarkup(
      <SettingsPage
        initialSection="jev-gate-settings"
        jevGates={{
          effective: resolveJevGates({ laneRouting: { enabled: true } }),
          global: { laneRouting: { enabled: true, highAbove: 0.4 } },
          workspace: { laneRouting: { enabled: false } },
        }}
        onClose={vi.fn()}
        onOpenUpdate={vi.fn()}
        onUpdateGlobalJevGates={vi.fn()}
        onUpdatePreferences={vi.fn()}
        updatePreferences={null}
        updatePreferencesError={null}
        workspaceId={null}
      />,
    )

    expect(markup).toContain('Lane routing')
    expect(markup).toContain('Tool call gate')
    expect(markup).toContain('Completion check')
    expect(markup).toContain('high ≥ 0.40, critical ≥ 0.85')
    expect(markup).toContain('data-testid="settings-jev-gate-laneRouting"')
    expect(markup).not.toContain('Background task notifications')
  })
})

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })

let unmount = () => {}
afterEach(() => unmount())

function renderSettings(initialSection: string) {
  const onUpdateGlobalJevGates = vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  const root = createRoot(host)
  act(() =>
    root.render(
      <SettingsPage
        initialSection={initialSection}
        jevGates={{ effective: resolveJevGates(), global: {}, workspace: {} }}
        onClose={vi.fn()}
        onOpenUpdate={vi.fn()}
        onUpdateGlobalJevGates={onUpdateGlobalJevGates}
        onUpdatePreferences={vi.fn()}
        updatePreferences={null}
        updatePreferencesError={null}
        workspaceId={null}
      />,
    ),
  )
  unmount = () => {
    act(() => root.unmount())
    host.remove()
  }
  return { host, onUpdateGlobalJevGates }
}

function typeInto(input: HTMLInputElement, value: string) {
  const setValue = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    'value',
  )?.set
  act(() => {
    setValue?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('SettingsPage Jev gate thresholds', () => {
  it('keeps a contradictory threshold on screen with its reason and saves nothing', () => {
    const { host, onUpdateGlobalJevGates } = renderSettings('jev-gate-settings')
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="Lane routing: High risk at or above"]',
    )
    if (!input) throw new Error('threshold input missing')

    for (const keystrokes of ['0', '0.', '0.9', '0.90', '0.907']) {
      typeInto(input, keystrokes)
    }

    expect(input.value).toBe('0.907')
    expect(input.getAttribute('aria-invalid')).toBe('true')
    expect(host.textContent).toContain('Keep this at or below critical (0.85).')
    expect(onUpdateGlobalJevGates).not.toHaveBeenCalled()

    act(() => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(input.value).toBe('')
    expect(host.textContent).not.toContain('Keep this at or below')
  })

  it('saves a valid threshold once, on blur', () => {
    const { host, onUpdateGlobalJevGates } = renderSettings('jev-gate-settings')
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="Lane routing: High risk at or above"]',
    )
    if (!input) throw new Error('threshold input missing')

    typeInto(input, '0.7')
    expect(onUpdateGlobalJevGates).not.toHaveBeenCalled()

    act(() => {
      input.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
    })
    expect(onUpdateGlobalJevGates).toHaveBeenCalledOnce()
    expect(onUpdateGlobalJevGates).toHaveBeenCalledWith({
      laneRouting: { highAbove: 0.7 },
    })
  })

  it('saves a valid threshold on Enter', () => {
    const { host, onUpdateGlobalJevGates } = renderSettings('jev-gate-settings')
    const input = host.querySelector<HTMLInputElement>(
      'input[aria-label="Tool call gate: Allow below"]',
    )
    if (!input) throw new Error('threshold input missing')

    typeInto(input, '0.2')
    act(() => {
      input.dispatchEvent(
        new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }),
      )
    })

    expect(onUpdateGlobalJevGates).toHaveBeenCalledOnce()
    expect(onUpdateGlobalJevGates).toHaveBeenCalledWith({
      toolGate: { allowBelow: 0.2 },
    })
  })
})

describe('SettingsPage search', () => {
  it('marks no category current while search results are showing', () => {
    const { host } = renderSettings('appearance-settings')
    const current = () =>
      host.querySelector('nav [aria-current="page"]')?.textContent ?? null
    expect(current()).toBe('Appearance')

    const search = host.querySelector<HTMLInputElement>('#settings-search')
    if (!search) throw new Error('search missing')
    typeInto(search, 'font')

    expect(current()).toBeNull()
  })
})

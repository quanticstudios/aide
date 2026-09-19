import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { resolveJevGates } from '../../../shared/jev-gates'

import SettingsPage, {
  filterSettingsShortcutGroups,
  SETTINGS_SHORTCUT_GROUPS,
} from './SettingsPage'

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

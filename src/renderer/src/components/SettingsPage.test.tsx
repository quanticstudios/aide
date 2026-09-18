import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

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

  it('renders persisted preferences and searchable shortcut groups', () => {
    const markup = renderToStaticMarkup(
      <SettingsPage
        onClose={vi.fn()}
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
      />,
    )

    expect(markup).toContain('Background task notifications')
    expect(markup).toContain('Animations')
    expect(markup).toContain('System default')
    expect(markup).toContain('Reduced motion')
    expect(markup).toContain('Download updates automatically')
    expect(markup).toContain('Share update health reports')
    expect(markup).toContain('Search settings')
    expect(markup).toContain('Settings categories')
    expect(markup).toContain('Back to app')
    expect(markup).toContain('Appearance')
    expect(markup).toContain('Open project by sidebar position')
  })
})

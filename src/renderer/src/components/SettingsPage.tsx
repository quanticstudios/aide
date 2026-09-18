import { ArrowLeft, Search, Settings, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import type {
  UpdatePreferencesInput,
  UpdatePreferencesSnapshot,
} from '../../../shared/update'

export interface SettingsShortcut {
  readonly description?: string
  readonly keys: readonly string[]
  readonly label: string
}

export interface SettingsShortcutGroup {
  readonly label: string
  readonly shortcuts: readonly SettingsShortcut[]
}

export const SETTINGS_SHORTCUT_GROUPS: readonly SettingsShortcutGroup[] = [
  {
    label: 'Navigate',
    shortcuts: [
      { keys: ['Ctrl', 'K'], label: 'Open command palette' },
      { keys: ['Ctrl/Cmd', 'Tab'], label: 'Open workspace overview' },
      { keys: ['Alt', 'Space'], label: 'Open workspace switcher' },
      { keys: ['Alt', 'N'], label: 'Create pane' },
      { keys: ['Alt', '←/H'], label: 'Select previous pane' },
      { keys: ['Alt', '→/L'], label: 'Select next pane' },
      { keys: ['Alt', '↑'], label: 'Select previous workspace' },
      { keys: ['Alt', '↓'], label: 'Select next workspace' },
      {
        description: 'While the workspace switcher is open',
        keys: ['Alt', 'K/J'],
        label: 'Move through workspaces',
      },
      {
        keys: ['Ctrl/Cmd', '1–9'],
        label: 'Open project by sidebar position',
      },
    ],
  },
  {
    label: 'Chat',
    shortcuts: [
      { keys: ['Enter'], label: 'Send message or submit answers' },
      { keys: ['Shift', 'Enter'], label: 'Add a new line' },
      {
        description: 'When the composer is empty and a choice is pending',
        keys: ['1–9'],
        label: 'Choose an answer',
      },
      {
        description: 'In recipient and slash menus',
        keys: ['↑/↓'],
        label: 'Move through suggestions',
      },
      {
        description: 'Tab also selects a recipient',
        keys: ['Enter'],
        label: 'Choose a suggestion',
      },
      { keys: ['Esc'], label: 'Close suggestions' },
    ],
  },
  {
    label: 'Models and pane menus',
    shortcuts: [
      {
        description: 'While the model menu is open',
        keys: ['Ctrl/Cmd', '1–9'],
        label: 'Choose a visible model',
      },
      { keys: ['Esc'], label: 'Close the model menu' },
      {
        description: 'While the pane picker is open',
        keys: ['←/↑/→/↓', 'or', 'H/J/K/L'],
        label: 'Move through pane types',
      },
      { keys: ['Enter/Space'], label: 'Choose a pane type' },
    ],
  },
]

interface SettingsPageProps {
  readonly onClose: () => void
  readonly onOpenUpdate: () => void
  readonly onUpdatePreferences: (input: UpdatePreferencesInput) => Promise<void>
  readonly updatePreferences: UpdatePreferencesSnapshot | null
  readonly updatePreferencesError: string | null
}

export default function SettingsPage({
  onClose,
  onOpenUpdate,
  onUpdatePreferences,
  updatePreferences,
  updatePreferencesError,
}: SettingsPageProps) {
  const pageRef = useRef<HTMLElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')
  const [notificationsEnabled, setNotificationsEnabled] = useState<
    boolean | null
  >(null)
  const [pendingPreference, setPendingPreference] = useState<string | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const api = window.aide
    if (!api) return
    let isDisposed = false

    const loadNotifications = () => {
      void api
        .getTaskLibrary()
        .then((snapshot) => {
          if (!isDisposed) {
            setNotificationsEnabled(snapshot.notificationsEnabled)
          }
        })
        .catch(() => {
          if (!isDisposed) {
            setError('Could not load notification preferences.')
          }
        })
    }

    const unsubscribe = api.onTaskLibraryChanged(loadNotifications)
    loadNotifications()
    searchRef.current?.focus()

    return () => {
      isDisposed = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const keepFocusInsideSettings = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const focusableElements = pageRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      )
      if (!focusableElements?.length) return

      const firstElement = focusableElements[0]
      const lastElement = focusableElements[focusableElements.length - 1]
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault()
        lastElement.focus()
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault()
        firstElement.focus()
      }
    }

    document.addEventListener('keydown', keepFocusInsideSettings)
    return () =>
      document.removeEventListener('keydown', keepFocusInsideSettings)
  }, [])

  const filteredShortcutGroups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    if (!normalizedQuery) return SETTINGS_SHORTCUT_GROUPS

    return SETTINGS_SHORTCUT_GROUPS.map((group) => ({
      ...group,
      shortcuts: group.shortcuts.filter((shortcut) =>
        [
          group.label,
          shortcut.label,
          shortcut.description ?? '',
          shortcut.keys.join(' '),
        ].some((value) => value.toLowerCase().includes(normalizedQuery)),
      ),
    })).filter((group) => group.shortcuts.length > 0)
  }, [query])

  async function saveUpdatePreference(
    preferenceName: string,
    input: UpdatePreferencesInput,
  ) {
    setPendingPreference(preferenceName)
    setError(null)
    try {
      await onUpdatePreferences(input)
    } catch {
      setError('Could not save update preferences.')
    } finally {
      setPendingPreference(null)
    }
  }

  async function saveNotifications(isEnabled: boolean) {
    const previousValue = notificationsEnabled
    setNotificationsEnabled(isEnabled)
    setPendingPreference('notifications')
    setError(null)
    try {
      const snapshot = await window.aide.setTaskNotifications(isEnabled)
      setNotificationsEnabled(snapshot.notificationsEnabled)
    } catch {
      setNotificationsEnabled(previousValue)
      setError('Could not save notification preferences.')
    } finally {
      setPendingPreference(null)
    }
  }

  return (
    <section
      aria-labelledby="settings-title"
      aria-modal="true"
      className="absolute inset-0 z-40 flex min-h-0 flex-col bg-surface-1 text-foreground"
      ref={pageRef}
      role="dialog"
    >
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-border px-3 sm:px-5">
        <button
          aria-label="Back to workspace"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onClose}
          type="button"
        >
          <ArrowLeft aria-hidden="true" className="size-4" />
        </button>
        <Settings aria-hidden="true" className="size-4 text-muted-foreground" />
        <h1 className="text-sm font-semibold" id="settings-title">
          Settings
        </h1>
        <button
          aria-label="Close settings"
          className="ml-auto flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onClick={onClose}
          type="button"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-5xl gap-8 px-4 py-6 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-10 lg:py-8">
          <div className="space-y-8">
            <section aria-labelledby="general-settings-heading">
              <h2
                className="text-sm font-semibold"
                id="general-settings-heading"
              >
                General
              </h2>
              <div className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface-2">
                <PreferenceRow
                  checked={notificationsEnabled ?? false}
                  description="Show a desktop notification when a background task needs attention."
                  disabled={
                    notificationsEnabled === null ||
                    pendingPreference === 'notifications'
                  }
                  label="Background task notifications"
                  onChange={(isEnabled) => void saveNotifications(isEnabled)}
                />
              </div>
            </section>

            <section aria-labelledby="update-settings-heading">
              <div className="flex items-center justify-between gap-3">
                <h2
                  className="text-sm font-semibold"
                  id="update-settings-heading"
                >
                  Software updates
                </h2>
                <button
                  className="rounded-md px-2 py-1 text-xs font-medium text-primary-on-dark hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={onOpenUpdate}
                  type="button"
                >
                  Open update details
                </button>
              </div>
              <div className="mt-3 divide-y divide-border rounded-lg border border-border bg-surface-2">
                <PreferenceRow
                  checked={updatePreferences?.automaticDownloads ?? false}
                  description="Download signed updates in the background. Aide still asks before restarting."
                  disabled={
                    !updatePreferences ||
                    pendingPreference === 'automatic-downloads'
                  }
                  label="Download updates automatically"
                  onChange={(isEnabled) =>
                    void saveUpdatePreference('automatic-downloads', {
                      automaticDownloads: isEnabled,
                    })
                  }
                />
                <PreferenceRow
                  checked={
                    (updatePreferences?.healthDisclosureAcknowledged &&
                      updatePreferences.healthReportingEnabled) ??
                    false
                  }
                  description="Share version, platform, timing, and coarse failure codes. Reports exclude projects, paths, prompts, and source code."
                  disabled={
                    !updatePreferences || pendingPreference === 'health-reports'
                  }
                  label="Share update health reports"
                  onChange={(isEnabled) =>
                    void saveUpdatePreference('health-reports', {
                      healthDisclosureAcknowledged: isEnabled,
                      healthReportingEnabled: isEnabled,
                    })
                  }
                />
              </div>
            </section>

            {error || updatePreferencesError ? (
              <p
                className="rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-xs text-danger"
                role="alert"
              >
                {error ?? updatePreferencesError}
              </p>
            ) : null}
          </div>

          <section aria-labelledby="keyboard-shortcuts-heading">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2
                  className="text-sm font-semibold"
                  id="keyboard-shortcuts-heading"
                >
                  Keyboard shortcuts
                </h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  Keys shown here match the shortcuts available in Aide.
                </p>
              </div>
              <label className="flex h-8 min-w-0 items-center gap-2 rounded-md border border-border bg-surface-2 px-2 focus-within:border-ring focus-within:ring-2 focus-within:ring-ring sm:w-56">
                <Search
                  aria-hidden="true"
                  className="size-3.5 text-muted-foreground"
                />
                <span className="sr-only">Search keyboard shortcuts</span>
                <input
                  className="min-w-0 flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search shortcuts"
                  ref={searchRef}
                  type="search"
                  value={query}
                />
              </label>
            </div>

            <div className="mt-4 space-y-5">
              {filteredShortcutGroups.map((group) => (
                <div key={group.label}>
                  <h3 className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                    {group.label}
                  </h3>
                  <div className="divide-y divide-border rounded-lg border border-border bg-surface-2">
                    {group.shortcuts.map((shortcut) => (
                      <div
                        className="flex items-start justify-between gap-4 px-3 py-2.5"
                        key={`${group.label}-${shortcut.label}`}
                      >
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium leading-5">
                            {shortcut.label}
                          </p>
                          {shortcut.description ? (
                            <p className="text-[11px] leading-4 text-muted-foreground">
                              {shortcut.description}
                            </p>
                          ) : null}
                        </div>
                        <span className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                          {shortcut.keys.map((key) =>
                            key === 'or' ? (
                              <span
                                className="px-0.5 text-[10px] text-muted-foreground"
                                key={key}
                              >
                                or
                              </span>
                            ) : (
                              <kbd
                                className="min-w-6 rounded border border-border-strong bg-surface-3 px-1.5 py-0.5 text-center font-mono text-[10px] text-foreground shadow-[inset_0_-1px_0_var(--border)]"
                                key={key}
                              >
                                {key}
                              </kbd>
                            ),
                          )}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {filteredShortcutGroups.length === 0 ? (
                <p className="rounded-lg border border-border px-4 py-8 text-center text-xs text-muted-foreground">
                  No shortcuts match "{query}".
                </p>
              ) : null}
            </div>
          </section>
        </div>
      </div>
    </section>
  )
}

function PreferenceRow({
  checked,
  description,
  disabled,
  label,
  onChange,
}: {
  readonly checked: boolean
  readonly description: string
  readonly disabled: boolean
  readonly label: string
  readonly onChange: (isChecked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 px-3 py-3 has-[:disabled]:cursor-default has-[:disabled]:opacity-50">
      <span className="min-w-0">
        <span className="block text-[13px] font-medium leading-5">{label}</span>
        <span className="block text-[11px] leading-4 text-muted-foreground">
          {description}
        </span>
      </span>
      <span className="relative mt-0.5 h-5 w-9 shrink-0">
        <input
          checked={checked}
          className="peer sr-only"
          disabled={disabled}
          onChange={(event) => onChange(event.target.checked)}
          type="checkbox"
        />
        <span className="absolute inset-0 rounded-full border border-border-strong bg-surface-3 transition-colors peer-checked:border-primary peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background" />
        <span className="absolute left-0.5 top-0.5 size-4 rounded-full bg-muted-foreground transition-transform peer-checked:translate-x-4 peer-checked:bg-primary-foreground" />
      </span>
    </label>
  )
}

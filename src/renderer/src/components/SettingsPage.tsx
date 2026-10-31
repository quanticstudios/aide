import { Button, InputGroup, ListBox, Select, Switch } from '@heroui/react'
import { ArrowLeft, Search, Settings } from 'lucide-react'
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react'
import {
  formatJevGateThresholds,
  JEV_GATE_ROWS,
  type JevGateOverrides,
  type JevGateSnapshot,
  resolveJevGates,
  withJevGateOverride,
} from '../../../shared/jev-gates'
import type {
  UpdatePreferencesInput,
  UpdatePreferencesSnapshot,
} from '../../../shared/update'
import {
  type AnimationPreference,
  getAnimationPreference,
  setAnimationPreference,
} from '../lib/animation-preference'
import {
  DEFAULT_UI_FONT_SIZE,
  FONT_SIZE_RANGE,
  type FontPreference,
  setFontPreference,
  useFontPreference,
} from '../lib/font-preference'
import {
  getSendWhileRunning,
  type SendWhileRunning,
  setSendWhileRunning,
} from '../lib/send-while-running'
import { setSessionBackend, useSessionBackend } from '../lib/session-backend'
import { getSessionTransport } from '../lib/session-transport'
import {
  getThemePreference,
  setThemePreference,
  type ThemePreference,
} from '../lib/theme-preference'
import JevSetup from './JevSetup'
import ThemePicker from './ThemePicker'

const LazyUsageSection = lazy(() => import('./UsageSection'))

const FONT_ROWS = [
  {
    description: 'Menus, labels and transcript text.',
    familyKey: 'uiFamily',
    familyPlaceholder: 'Geist',
    label: 'Interface font',
    sizeKey: 'uiSize',
    sizePlaceholder: String(DEFAULT_UI_FONT_SIZE),
  },
  {
    description: 'Code blocks, diffs and terminals.',
    familyKey: 'codeFamily',
    familyPlaceholder: 'Geist Mono',
    label: 'Code font',
    sizeKey: 'codeSize',
    sizePlaceholder: 'Default',
  },
] as const

function FontSettingRow({
  fonts,
  row,
}: {
  readonly fonts: FontPreference
  readonly row: (typeof FONT_ROWS)[number]
}) {
  const inputClassName =
    'h-8 rounded-md border border-border bg-surface-3 px-2 text-[13px] text-foreground placeholder:text-muted-foreground'
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3">
      <span className="min-w-0">
        <span className="block text-[13px] font-medium leading-5">
          {row.label}
        </span>
        <span className="block text-[12px] leading-4 text-muted-foreground">
          {row.description}
        </span>
      </span>
      <span className="flex shrink-0 gap-2">
        {/* why: uncontrolled, so a family typed with a trailing space is not trimmed mid-word. */}
        <input
          aria-label={`${row.label} family`}
          className={`${inputClassName} w-40`}
          defaultValue={fonts[row.familyKey]}
          onChange={(event) =>
            setFontPreference({ [row.familyKey]: event.target.value })
          }
          placeholder={row.familyPlaceholder}
          spellCheck={false}
          type="text"
        />
        <input
          aria-label={`${row.label} size`}
          className={`${inputClassName} w-20`}
          defaultValue={fonts[row.sizeKey] ?? ''}
          max={FONT_SIZE_RANGE.max}
          min={FONT_SIZE_RANGE.min}
          onChange={(event) =>
            setFontPreference({
              [row.sizeKey]:
                event.target.value === '' ? null : Number(event.target.value),
            })
          }
          placeholder={row.sizePlaceholder}
          step={0.5}
          type="number"
        />
      </span>
    </div>
  )
}

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
      { keys: ['Ctrl', 'B'], label: 'Toggle left sidebar' },
      { keys: ['Ctrl/Cmd', 'Tab'], label: 'Open workspace overview' },
      { keys: ['Alt', 'Space'], label: 'Open workspace switcher' },
      {
        keys: ['Hold Alt'],
        label: 'Peek at workspace switcher',
        description: 'Release Alt to close',
      },
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
      { keys: ['/'], label: 'Open commands and provider skills' },
      { keys: ['@'], label: 'Add agents, files, or skills' },
      { keys: ['Enter'], label: 'Send message or submit answers' },
      { keys: ['Shift', 'Enter'], label: 'Add a new line' },
      {
        keys: ['Ctrl/Cmd', 'Enter'],
        label:
          'While the agent works, queue or steer, whichever Enter does not',
      },
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
    label: 'Command palette',
    shortcuts: [
      { keys: ['↑/↓'], label: 'Move through commands' },
      { keys: ['Enter'], label: 'Run selected command' },
      { keys: ['Esc'], label: 'Close command palette' },
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

export function filterSettingsShortcutGroups(
  query: string,
): readonly SettingsShortcutGroup[] {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return SETTINGS_SHORTCUT_GROUPS
  const queryWords = normalizedQuery.split(/[\s+]+/).filter(Boolean)

  return SETTINGS_SHORTCUT_GROUPS.map((group) => ({
    ...group,
    shortcuts: group.shortcuts.filter((shortcut) => {
      const searchableText = [
        group.label,
        shortcut.label,
        shortcut.description ?? '',
        shortcut.keys.join(' '),
      ]
        .join(' ')
        .toLowerCase()
      return queryWords.every((word) =>
        word.length === 1
          ? searchableText.split(/[^a-z0-9]+/).includes(word)
          : searchableText.includes(word),
      )
    }),
  })).filter((group) => group.shortcuts.length > 0)
}

interface SettingsPageProps {
  readonly initialSection?: string
  readonly jevGates: JevGateSnapshot | null
  readonly onClose: () => void
  readonly onUpdateGlobalJevGates: (overrides: JevGateOverrides) => void
  readonly onOpenUpdate: () => void
  readonly onUpdatePreferences: (input: UpdatePreferencesInput) => Promise<void>
  readonly updatePreferences: UpdatePreferencesSnapshot | null
  readonly updatePreferencesError: string | null
  readonly workspaceId: string | null
}

export default function SettingsPage({
  initialSection,
  jevGates,
  onClose,
  onOpenUpdate,
  onUpdateGlobalJevGates,
  onUpdatePreferences,
  updatePreferences,
  updatePreferencesError,
  workspaceId,
}: SettingsPageProps) {
  const pageRef = useRef<HTMLElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)
  const [query, setQuery] = useState('')
  const [notificationsEnabled, setNotificationsEnabled] = useState<
    boolean | null
  >(null)
  const [soundsEnabled, setSoundsEnabled] = useState<boolean | null>(null)
  const [pendingPreference, setPendingPreference] = useState<string | null>(
    null,
  )
  const [error, setError] = useState<string | null>(null)
  const [selectedSection, setSelectedSection] = useState(
    initialSection ?? 'general-settings',
  )
  const [selectedAnimation, setSelectedAnimation] =
    useState<AnimationPreference>(getAnimationPreference)
  const [selectedTheme, setSelectedTheme] =
    useState<ThemePreference>(getThemePreference)
  const fonts = useFontPreference()
  const sessionBackend = useSessionBackend()
  const [sendWhileRunning, setSendWhileRunningState] =
    useState<SendWhileRunning>(getSendWhileRunning)

  useEffect(() => {
    searchRef.current?.focus()
    const transport = getSessionTransport()
    if (!transport) return
    let isDisposed = false

    const loadNotifications = () => {
      void transport
        .listSessions()
        .then((snapshot) => {
          if (!isDisposed) {
            setNotificationsEnabled(snapshot.notificationsEnabled)
            setSoundsEnabled(snapshot.notificationSoundsEnabled)
          }
        })
        .catch(() => {
          if (!isDisposed) {
            setError('Could not load notification preferences.')
          }
        })
    }

    const unsubscribe = transport.subscribeSessionList(loadNotifications)
    loadNotifications()

    return () => {
      isDisposed = true
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    const keepFocusInsideSettings = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return
      const focusableElements = pageRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
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

  const searchResults = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase()
    const containsQuery = (sectionId: string, ...values: string[]) =>
      normalizedQuery
        ? values.some((value) => value.toLowerCase().includes(normalizedQuery))
        : selectedSection === sectionId
    const matchesKeyboardSection = containsQuery(
      'keyboard-shortcuts',
      'Keyboard shortcuts',
      'Keys available in the workspace, chat, and menus',
    )
    const shortcutGroups = matchesKeyboardSection
      ? SETTINGS_SHORTCUT_GROUPS
      : filterSettingsShortcutGroups(query)

    return {
      shortcutGroups,
      showAppearance: containsQuery(
        'appearance-settings',
        'Appearance',
        'Theme',
        'System',
        'Light',
        'Dark',
        'High contrast',
        'Follow the OS setting, or pick a palette',
        'Fonts',
        ...FONT_ROWS.flatMap((row) => [row.label, row.description]),
        'Animations',
        'System default',
        'On',
        'Reduced motion',
        'Reduce movement while keeping status and feedback visible',
      ),
      showJevGates: containsQuery(
        'jev-gate-settings',
        'Jev gates',
        'Lane routing',
        'Tool call gate',
        'Completion check',
        'Gate defaults for every workspace',
      ),
      showJev: containsQuery(
        'jev-settings',
        'Jev',
        'TypeSafe API key',
        'Allow TypeSafe processing for this workspace',
        'context preparation credential consent',
      ),
      showGeneral: containsQuery(
        'general-settings',
        'General',
        'Background task notifications',
        'Show a desktop notification when a background task needs attention',
        'Notification sounds',
        'Run sessions on the pitwall daemon',
        'Session backend',
        'Queue messages while the agent works',
        'steer',
      ),
      showKeyboard: normalizedQuery
        ? shortcutGroups.length > 0
        : selectedSection === 'keyboard-shortcuts',
      showUsage: containsQuery(
        'usage-settings',
        'Usage',
        'Plan limits',
        'tokens cost sessions reset',
      ),
      showUpdates: containsQuery(
        'update-settings',
        'Software updates',
        'Download updates automatically',
        'Download signed updates in the background',
        'Share update health reports',
        'version platform timing failure codes privacy',
        'Update status',
        'Check download install available update',
        'Open details',
        'Software update downloads diagnostics installation',
      ),
    }
  }, [query, selectedSection])

  const globalOverrides = jevGates?.global ?? {}
  const globalGates = resolveJevGates(globalOverrides)

  function openSection(sectionId: string) {
    setQuery('')
    setSelectedSection(sectionId)
    requestAnimationFrame(() =>
      document.getElementById(sectionId)?.scrollIntoView({ block: 'start' }),
    )
  }

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

  async function saveSounds(isEnabled: boolean) {
    const previousValue = soundsEnabled
    setSoundsEnabled(isEnabled)
    setPendingPreference('sounds')
    setError(null)
    try {
      const snapshot = await window.aide.setTaskNotificationSounds(isEnabled)
      setSoundsEnabled(snapshot.notificationSoundsEnabled)
    } catch {
      setSoundsEnabled(previousValue)
      setError('Could not save notification preferences.')
    } finally {
      setPendingPreference(null)
    }
  }

  return (
    <section
      aria-label="Settings"
      aria-modal="true"
      className="settings-page fixed inset-0 z-50 flex min-h-0 min-w-0 flex-col bg-surface-1 text-foreground min-[740px]:flex-row"
      ref={pageRef}
      role="dialog"
    >
      <aside className="flex w-full shrink-0 flex-col gap-3 border-b border-border bg-background p-3 min-[740px]:h-full min-[740px]:w-72 min-[740px]:gap-4 min-[740px]:border-b-0 min-[740px]:border-r min-[740px]:p-4">
        <div className="flex min-w-0 items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="flex h-8 min-w-0 items-center gap-2 rounded-md px-2 text-[13px] font-medium text-muted-foreground hover:bg-surface-3 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onPress={onClose}
            type="button"
          >
            <ArrowLeft aria-hidden="true" className="size-4 shrink-0" />
            Back to app
          </Button>
          <div className="ml-auto flex items-center gap-1.5 min-[740px]:hidden">
            <Settings
              aria-hidden="true"
              className="size-3.5 text-muted-foreground"
            />
            <h1 className="text-[13px] font-semibold" id="settings-title">
              Settings
            </h1>
          </div>
        </div>

        <div className="hidden items-center gap-2 px-2 min-[740px]:flex">
          <Settings
            aria-hidden="true"
            className="size-4 text-muted-foreground"
          />
          <h1 className="text-sm font-semibold" id="settings-title-wide">
            Settings
          </h1>
        </div>

        <InputGroup
          fullWidth
          className="h-8 min-h-0 min-w-0 rounded-md border border-border bg-surface-3 shadow-none"
        >
          <InputGroup.Prefix className="px-2">
            <Search
              aria-hidden="true"
              className="size-3.5 text-muted-foreground"
            />
          </InputGroup.Prefix>
          <InputGroup.Input
            aria-label="Search settings"
            id="settings-search"
            className="min-w-0 text-[13px] placeholder:text-muted-foreground"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search settings"
            ref={searchRef}
            type="search"
            value={query}
          />
        </InputGroup>

        <nav
          aria-label="Settings categories"
          className="flex min-w-0 gap-1 overflow-x-auto min-[740px]:flex-col min-[740px]:overflow-visible"
        >
          {[
            { id: 'general-settings', label: 'General' },
            { id: 'appearance-settings', label: 'Appearance' },
            { id: 'jev-settings', label: 'Jev' },
            { id: 'jev-gate-settings', label: 'Jev gates' },
            { id: 'keyboard-shortcuts', label: 'Keyboard shortcuts' },
            { id: 'usage-settings', label: 'Usage' },
            { id: 'update-settings', label: 'Updates' },
          ].map((section) => (
            <Button
              variant="ghost"
              size="sm"
              aria-current={selectedSection === section.id ? 'page' : undefined}
              className={`shrink-0 justify-start rounded-md px-2.5 min-[740px]:w-full py-1.5 text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                selectedSection === section.id
                  ? 'bg-surface-4 font-medium text-foreground'
                  : 'text-muted-foreground hover:bg-surface-3 hover:text-foreground'
              }`}
              key={section.id}
              onPress={() => openSection(section.id)}
              type="button"
            >
              {section.label}
            </Button>
          ))}
        </nav>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[800px] px-4 py-6 sm:px-6 min-[740px]:px-8 min-[740px]:py-10">
          {error || updatePreferencesError ? (
            <p
              className="mb-6 rounded-md border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger"
              role="alert"
            >
              {error ?? updatePreferencesError}
            </p>
          ) : null}

          {searchResults.showGeneral ? (
            <section
              aria-labelledby="general-settings-heading"
              className="scroll-mt-6"
              id="general-settings"
            >
              <h2 className="text-xl font-medium" id="general-settings-heading">
                General
              </h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                App behavior and background activity.
              </p>
              <div className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface-2">
                <PreferenceRow
                  checked={notificationsEnabled ?? false}
                  description="Show a desktop notification when a background task needs attention."
                  disabled={
                    notificationsEnabled === null || pendingPreference !== null
                  }
                  label="Background task notifications"
                  onChange={(isEnabled) => void saveNotifications(isEnabled)}
                />
                <PreferenceRow
                  checked={soundsEnabled ?? false}
                  description="Play a short tone for each notification, different for each kind."
                  disabled={
                    soundsEnabled === null || pendingPreference !== null
                  }
                  label="Notification sounds"
                  onChange={(isEnabled) => void saveSounds(isEnabled)}
                />
                <PreferenceRow
                  checked={sessionBackend === 'pitwall'}
                  description="Show pitwall's chats and start new sessions there. Off uses aide's built-in sessions, which stay saved either way."
                  disabled={false}
                  label="Run sessions on the pitwall daemon"
                  onChange={(isPitwall) =>
                    setSessionBackend(isPitwall ? 'pitwall' : 'built-in')
                  }
                />
                <PreferenceRow
                  checked={sendWhileRunning === 'queue'}
                  description="Enter holds a message until the running turn ends, and Ctrl/Cmd+Enter steers it instead. Off swaps the two."
                  disabled={false}
                  label="Queue messages while the agent works"
                  onChange={(isQueue) => {
                    const preference = isQueue ? 'queue' : 'steer'
                    setSendWhileRunning(preference)
                    setSendWhileRunningState(preference)
                  }}
                />
              </div>
            </section>
          ) : null}

          {searchResults.showAppearance ? (
            <section
              aria-labelledby="appearance-settings-heading"
              className="mt-10 scroll-mt-6 first:mt-0"
              id="appearance-settings"
            >
              <h2
                className="text-xl font-medium"
                id="appearance-settings-heading"
              >
                Appearance
              </h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Theme, font and motion preferences for the app interface.
              </p>
              <div className="mt-4 rounded-lg border border-border bg-surface-2">
                <div className="border-b border-border px-4 py-3">
                  <span className="block text-[13px] font-medium leading-5">
                    Theme
                  </span>
                  <span className="mb-3 block text-[12px] leading-4 text-muted-foreground">
                    Follow the OS setting, or pick a palette. Switching applies
                    at once.
                  </span>
                  <ThemePicker
                    onChange={(preference) => {
                      setThemePreference(preference)
                      setSelectedTheme(preference)
                    }}
                    value={selectedTheme}
                  />
                </div>
                {FONT_ROWS.map((row) => (
                  <FontSettingRow fonts={fonts} key={row.label} row={row} />
                ))}
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium leading-5">
                      Animations
                    </span>
                    <span className="block text-[12px] leading-4 text-muted-foreground">
                      Reduce movement while keeping status and feedback visible.
                    </span>
                  </span>
                  <Select
                    aria-label="Animations"
                    className="w-40 shrink-0"
                    value={selectedAnimation}
                    onChange={(preference) => {
                      if (
                        preference !== 'system' &&
                        preference !== 'on' &&
                        preference !== 'reduced'
                      )
                        return
                      setAnimationPreference(preference)
                      setSelectedAnimation(preference)
                    }}
                  >
                    <Select.Trigger className="h-8 min-h-8 rounded-md bg-surface-3 text-[13px]">
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover className="z-[60] min-w-40">
                      <ListBox aria-label="Animation options">
                        <ListBox.Item id="system" textValue="System default">
                          System default
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                        <ListBox.Item id="on" textValue="On">
                          On
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                        <ListBox.Item id="reduced" textValue="Reduced motion">
                          Reduced motion
                          <ListBox.ItemIndicator />
                        </ListBox.Item>
                      </ListBox>
                    </Select.Popover>
                  </Select>
                </div>
              </div>
            </section>
          ) : null}

          {searchResults.showJev ? (
            <section
              aria-labelledby="jev-settings-heading"
              className="mt-10 scroll-mt-6 first:mt-0"
              id="jev-settings"
            >
              <h2 className="text-xl font-medium" id="jev-settings-heading">
                Jev
              </h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                TypeSafe credential and per-workspace processing permission.
              </p>
              {workspaceId ? (
                <JevSetup key={workspaceId} workspaceId={workspaceId} />
              ) : (
                <p className="mt-4 rounded-lg border border-border bg-surface-2 px-4 py-10 text-center text-[13px] text-muted-foreground">
                  Select a workspace to configure Jev.
                </p>
              )}
            </section>
          ) : null}

          {searchResults.showJevGates ? (
            <section
              aria-labelledby="jev-gate-settings-heading"
              className="mt-10 scroll-mt-6 first:mt-0"
              id="jev-gate-settings"
            >
              <h2
                className="text-xl font-medium"
                id="jev-gate-settings-heading"
              >
                Jev gates
              </h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Gate defaults for every workspace. A workspace can override any
                of them in the sidebar.
              </p>
              <div className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface-2">
                {JEV_GATE_ROWS.map((row) => (
                  <div
                    className="flex items-start justify-between gap-4 px-4 py-3"
                    data-testid={`settings-jev-gate-${row.section}`}
                    key={row.section}
                  >
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium leading-5">
                        {row.label}
                      </p>
                      <p className="text-[12px] leading-4 text-muted-foreground">
                        {row.description}
                      </p>
                      <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">
                        {formatJevGateThresholds(globalGates, row.section)}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-3">
                        {row.thresholds.map((threshold) => (
                          <label
                            className="flex items-center gap-1.5 text-[12px] text-muted-foreground"
                            key={threshold.field}
                          >
                            {threshold.label}
                            <input
                              aria-label={`${row.label}: ${threshold.label}`}
                              className="w-20 rounded border border-border bg-surface-3 px-1.5 py-0.5 text-[12px] text-foreground"
                              disabled={!jevGates}
                              max={1}
                              min={0}
                              onChange={(event) => {
                                const parsed = Number(event.target.value)
                                onUpdateGlobalJevGates(
                                  withJevGateOverride(
                                    globalOverrides,
                                    row.section,
                                    threshold.field,
                                    Number.isFinite(parsed) &&
                                      event.target.value !== ''
                                      ? Math.min(1, Math.max(0, parsed))
                                      : undefined,
                                  ),
                                )
                              }}
                              placeholder={String(
                                (
                                  globalGates[row.section] as unknown as Record<
                                    string,
                                    number
                                  >
                                )[threshold.field],
                              )}
                              step={0.05}
                              type="number"
                              value={
                                (
                                  globalOverrides[row.section] as
                                    | Record<string, number>
                                    | undefined
                                )?.[threshold.field] ?? ''
                              }
                            />
                          </label>
                        ))}
                      </div>
                    </div>
                    <Switch
                      aria-label={row.label}
                      isDisabled={!jevGates}
                      isSelected={globalGates[row.section].enabled}
                      onChange={(isSelected) =>
                        onUpdateGlobalJevGates(
                          withJevGateOverride(
                            globalOverrides,
                            row.section,
                            'enabled',
                            isSelected,
                          ),
                        )
                      }
                      size="sm"
                    >
                      <Switch.Content>
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                      </Switch.Content>
                    </Switch>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {searchResults.showKeyboard ? (
            <section
              aria-labelledby="keyboard-shortcuts-heading"
              className="mt-10 scroll-mt-6 first:mt-0"
              id="keyboard-shortcuts"
            >
              <h2
                className="text-xl font-medium"
                id="keyboard-shortcuts-heading"
              >
                Keyboard shortcuts
              </h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Keys available in the workspace, chat, and menus.
              </p>
              <div className="mt-5 space-y-6">
                {searchResults.shortcutGroups.map((group) => (
                  <div key={group.label}>
                    <h3 className="mb-2 px-1 text-[12px] font-medium text-muted-foreground">
                      {group.label}
                    </h3>
                    <div className="divide-y divide-border rounded-lg border border-border bg-surface-2">
                      {group.shortcuts.map((shortcut) => (
                        <div
                          className="flex min-w-0 items-start justify-between gap-3 px-4 py-3"
                          key={`${group.label}-${shortcut.label}`}
                        >
                          <div className="min-w-0">
                            <p className="text-[13px] font-medium leading-5">
                              {shortcut.label}
                            </p>
                            {shortcut.description ? (
                              <p className="text-[12px] leading-4 text-muted-foreground">
                                {shortcut.description}
                              </p>
                            ) : null}
                          </div>
                          <span className="flex max-w-[48%] shrink-0 flex-wrap items-center justify-end gap-1">
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
              </div>
            </section>
          ) : null}

          {searchResults.showUsage ? (
            <section
              aria-labelledby="usage-settings-heading"
              className="mt-10 scroll-mt-6 first:mt-0"
              id="usage-settings"
            >
              <h2 className="text-xl font-medium" id="usage-settings-heading">
                Usage
              </h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Plan limits and tokens on this machine, as pitwall reads them
                from the agents' session files.
              </p>
              <Suspense fallback={null}>
                <LazyUsageSection />
              </Suspense>
            </section>
          ) : null}

          {searchResults.showUpdates ? (
            <section
              aria-labelledby="update-settings-heading"
              className="mt-10 scroll-mt-6 first:mt-0"
              id="update-settings"
            >
              <h2 className="text-xl font-medium" id="update-settings-heading">
                Updates
              </h2>
              <p className="mt-1 text-[13px] text-muted-foreground">
                Software update downloads, diagnostics, and installation.
              </p>
              <div className="mt-4 divide-y divide-border rounded-lg border border-border bg-surface-2">
                <PreferenceRow
                  checked={updatePreferences?.automaticDownloads ?? false}
                  description="Download signed updates in the background. Aide still asks before restarting."
                  disabled={!updatePreferences || pendingPreference !== null}
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
                  disabled={!updatePreferences || pendingPreference !== null}
                  label="Share update health reports"
                  onChange={(isEnabled) =>
                    void saveUpdatePreference('health-reports', {
                      healthDisclosureAcknowledged: isEnabled,
                      healthReportingEnabled: isEnabled,
                    })
                  }
                />
                <div className="flex items-center justify-between gap-4 px-4 py-3">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium">Update status</p>
                    <p className="mt-0.5 text-[12px] leading-4 text-muted-foreground">
                      Check, download, or install an available update.
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="shrink-0 rounded-md border border-border bg-surface-3 px-2.5 py-1.5 text-[12px] font-medium text-foreground hover:bg-surface-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onPress={onOpenUpdate}
                    type="button"
                  >
                    Open details
                  </Button>
                </div>
              </div>
            </section>
          ) : null}

          {!searchResults.showGeneral &&
          !searchResults.showAppearance &&
          !searchResults.showJev &&
          !searchResults.showJevGates &&
          !searchResults.showKeyboard &&
          !searchResults.showUsage &&
          !searchResults.showUpdates ? (
            <p className="rounded-lg border border-border bg-surface-2 px-4 py-10 text-center text-[13px] text-muted-foreground">
              No settings match "{query}".
            </p>
          ) : null}
        </div>
      </main>
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
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="min-w-0">
        <span className="block text-[13px] font-medium leading-5">{label}</span>
        <span className="block text-[12px] leading-4 text-muted-foreground">
          {description}
        </span>
      </span>
      <Switch
        aria-label={label}
        isSelected={checked}
        isDisabled={disabled}
        onChange={onChange}
        size="sm"
      >
        <Switch.Content>
          <Switch.Control>
            <Switch.Thumb />
          </Switch.Control>
        </Switch.Content>
      </Switch>
    </div>
  )
}

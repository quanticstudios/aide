import { useEffect, useState } from 'react'
import type { JevSettingsStatus } from '../../../shared/jev'

interface JevSetupProps {
  readonly isOpen: boolean
  readonly onOpenChange: (isOpen: boolean) => void
  readonly workspaceId: string
}

/** Jev setup grants workspace processing permission without exposing stored credentials. */
export default function JevSetup({
  isOpen,
  onOpenChange,
  workspaceId,
}: JevSetupProps) {
  const [status, setStatus] = useState<JevSettingsStatus | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [allowProcessing, setAllowProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  function closeSetup() {
    onOpenChange(false)
  }

  useEffect(() => {
    let cancelled = false
    void window.aide
      .getJevSettings(workspaceId)
      .then((value) => {
        if (cancelled) return
        setStatus(value)
        setAllowProcessing(value.allowProcessing)
      })
      .catch(() => {
        if (!cancelled) setError('Jev settings could not be loaded.')
      })
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  const isReady = Boolean(status?.allowProcessing && status.hasCredential)

  if (isReady && !isOpen && !error) {
    return null
  }

  return (
    <details
      className="shrink-0 border-b border-border px-4 py-2 text-sm"
      onToggle={(event) => {
        if (event.currentTarget.open !== isOpen) {
          onOpenChange(event.currentTarget.open)
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') closeSetup()
      }}
      open={isOpen}
    >
      <summary className="cursor-pointer">
        Jev ·{' '}
        {error
          ? 'Setup error'
          : status?.allowProcessing && status.hasCredential
            ? 'Ready'
            : status?.hasCredential
              ? 'Workspace permission required'
              : status
                ? 'API key required'
                : 'Loading'}
      </summary>
      <form
        className="mx-auto mt-3 flex max-h-[40vh] max-w-3xl flex-col gap-3 overflow-y-auto pb-2"
        onSubmit={async (event) => {
          event.preventDefault()
          setSaving(true)
          setError(null)
          try {
            const value = await window.aide.updateJevSettings(workspaceId, {
              allowProcessing,
              ...(apiKey ? { apiKey } : {}),
            })
            setStatus(value)
            setApiKey('')
            if (value.allowProcessing && value.hasCredential) closeSetup()
          } catch {
            setError(
              'Jev settings could not be saved. Check secure credential storage and try again.',
            )
          } finally {
            setSaving(false)
          }
        }}
      >
        <p>
          Jev prepares context for every request. TypeSafe receives your
          request, conversation evidence, and selected workspace excerpts.
        </p>
        <label className="flex flex-col gap-1">
          TypeSafe API key {status?.hasCredential ? '(configured)' : ''}
          <input
            aria-label="TypeSafe API key"
            autoComplete="off"
            className="rounded border border-border bg-surface px-2 py-1"
            disabled={!status?.canStoreCredential || saving}
            maxLength={4096}
            onChange={(event) => setApiKey(event.target.value)}
            type="password"
            value={apiKey}
          />
        </label>
        {status?.hasCredential && !status.allowProcessing ? (
          <p>
            Allow processing below and save to enable messages in this
            workspace.
          </p>
        ) : null}
        {status && !status.canStoreCredential && !status.hasCredential ? (
          <p>
            Enable your operating system keyring, or launch Aide with
            TYPESAFE_API_KEY.
          </p>
        ) : null}
        <label className="flex items-center gap-2">
          <input
            checked={allowProcessing}
            disabled={saving}
            onChange={(event) => setAllowProcessing(event.target.checked)}
            type="checkbox"
          />
          Allow TypeSafe processing for this workspace
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <button
            className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-50"
            disabled={saving || !status}
            type="submit"
          >
            {saving ? 'Saving…' : 'Save Jev settings'}
          </button>
          <button
            className="rounded-md px-3 py-2 text-muted-foreground hover:bg-surface-secondary hover:text-foreground"
            onClick={closeSetup}
            type="button"
          >
            Close Jev setup
          </button>
          {status?.hasCredential && status.canStoreCredential ? (
            <button
              className="rounded border border-border px-3 py-1"
              disabled={saving}
              onClick={async () => {
                setSaving(true)
                try {
                  setStatus(
                    await window.aide.updateJevSettings(workspaceId, {
                      apiKey: '',
                      allowProcessing: false,
                    }),
                  )
                  setAllowProcessing(false)
                  setApiKey('')
                  setError(null)
                } catch {
                  setError(
                    'The saved TypeSafe credential could not be removed.',
                  )
                } finally {
                  setSaving(false)
                }
              }}
              type="button"
            >
              Remove saved key
            </button>
          ) : null}
        </div>
        {error ? <p role="alert">{error}</p> : null}
      </form>
    </details>
  )
}

import { useEffect, useState } from 'react'
import type { JevSettingsStatus } from '../../../shared/jev'

/** Jev setup grants workspace processing permission without exposing stored credentials. */
export default function JevSetup({ workspaceId }: { workspaceId: string }) {
  const [status, setStatus] = useState<JevSettingsStatus | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [allowProcessing, setAllowProcessing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

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

  return (
    <details className="border-b border-border px-4 py-2 text-sm">
      <summary className="cursor-pointer">
        Jev ·{' '}
        {status?.allowProcessing && status.hasCredential
          ? 'Ready'
          : 'Setup required'}
      </summary>
      <form
        className="mt-3 flex flex-col gap-3"
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
        {status && !status.canStoreCredential ? (
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
        <div className="flex gap-3">
          <button
            className="rounded border border-border px-3 py-1"
            disabled={saving || !status}
            type="submit"
          >
            {saving ? 'Saving…' : 'Save Jev settings'}
          </button>
          {status?.hasCredential ? (
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

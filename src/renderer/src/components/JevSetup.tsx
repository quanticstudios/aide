import { Button, Input, Switch } from '@heroui/react'
import { ChevronDown } from 'lucide-react'
import { useEffect, useId, useState } from 'react'
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
  const inputId = useId()
  const [status, setStatus] = useState<JevSettingsStatus | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [allowProcessing, setAllowProcessing] = useState(true)
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

  return (
    <div
      className="grid shrink-0 transition-[grid-template-rows] duration-200 ease-out"
      style={{ gridTemplateRows: !isReady || isOpen || error ? '1fr' : '0fr' }}
      inert={isReady && !isOpen && !error}
      onKeyDown={(event) => {
        if (event.key === 'Escape') closeSetup()
      }}
    >
      <div className="min-h-0 overflow-hidden">
        <div className="border-b border-border bg-surface-secondary px-4 py-2 text-sm">
          <Button
            aria-expanded={isOpen}
            className="h-8 w-full justify-start gap-2 px-2 text-sm"
            onPress={() => onOpenChange(!isOpen)}
            size="sm"
            variant="ghost"
          >
            <ChevronDown
              aria-hidden
              className={`size-3.5 transition-transform duration-200 ${isOpen ? '' : '-rotate-90'}`}
            />
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
          </Button>
          <div
            className="grid transition-[grid-template-rows] duration-200 ease-out"
            style={{ gridTemplateRows: isOpen ? '1fr' : '0fr' }}
            inert={!isOpen}
          >
            <div className="min-h-0 overflow-hidden">
              <form
                className="mx-auto mt-3 flex max-h-[40vh] max-w-3xl flex-col gap-3 overflow-y-auto pb-2"
                onSubmit={async (event) => {
                  event.preventDefault()
                  setSaving(true)
                  setError(null)
                  try {
                    const value = await window.aide.updateJevSettings(
                      workspaceId,
                      {
                        allowProcessing,
                        ...(apiKey ? { apiKey } : {}),
                      },
                    )
                    setStatus(value)
                    setApiKey('')
                    if (value.allowProcessing && value.hasCredential)
                      closeSetup()
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
                  request, conversation evidence, and selected workspace
                  excerpts.
                </p>
                <label className="flex flex-col gap-1" htmlFor={inputId}>
                  TypeSafe API key {status?.hasCredential ? '(configured)' : ''}
                  <Input
                    aria-label="TypeSafe API key"
                    id={inputId}
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
                {status &&
                !status.canStoreCredential &&
                !status.hasCredential ? (
                  <p>
                    Enable your operating system keyring, or launch Aide with
                    TYPESAFE_API_KEY.
                  </p>
                ) : null}
                <div className="flex items-center justify-between gap-4 rounded-lg bg-surface px-3 py-2">
                  <span>Allow TypeSafe processing for this workspace</span>
                  <Switch
                    aria-label="Allow TypeSafe processing for this workspace"
                    isSelected={allowProcessing}
                    isDisabled={saving}
                    onChange={setAllowProcessing}
                    size="sm"
                  >
                    <Switch.Content>
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                    </Switch.Content>
                  </Switch>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    className="rounded-md bg-primary px-3 py-2 font-medium text-primary-foreground disabled:opacity-50"
                    isDisabled={saving || !status}
                    type="submit"
                  >
                    {saving ? 'Saving…' : 'Save Jev settings'}
                  </Button>
                  <Button
                    className="rounded-md px-3 py-2 text-muted-foreground hover:bg-surface-secondary hover:text-foreground"
                    onPress={closeSetup}
                    type="button"
                  >
                    Close Jev setup
                  </Button>
                  {status?.hasCredential && status.canStoreCredential ? (
                    <Button
                      className="rounded border border-border px-3 py-1"
                      isDisabled={saving}
                      onPress={async () => {
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
                    </Button>
                  ) : null}
                </div>
                {error ? <p role="alert">{error}</p> : null}
              </form>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

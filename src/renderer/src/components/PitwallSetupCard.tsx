import { Button } from '@heroui/react'
import { AlertTriangle, Power, RotateCcw } from 'lucide-react'
import { useState } from 'react'
import type { PitwallStatus } from '../../../shared/ipc'

interface PitwallSetupCardProps {
  readonly onCheckAgain: () => void
  /** Turns pitwall's web listener on in its config.toml; only Electron's bridge offers it. */
  readonly onTurnOn?: () => Promise<unknown>
  readonly pitwall: Exclude<PitwallStatus, { status: 'ready' }>
}

// From pitwall's README, Install.
const INSTALL_COMMANDS: Record<'unix' | 'win32', readonly string[]> = {
  unix: [
    'curl -fsSL https://raw.githubusercontent.com/quanticstudios/pitwall/main/scripts/get.sh | sh',
    'brew install quanticstudios/tap/pitwall',
  ],
  win32: [
    'irm https://raw.githubusercontent.com/quanticstudios/pitwall/main/scripts/get.ps1 | iex',
    'scoop bucket add quanticstudios https://github.com/quanticstudios/scoop-bucket; scoop install pitwall',
  ],
}

function copyFor(pitwall: PitwallSetupCardProps['pitwall']): {
  commands: readonly string[]
  fix: string
  title: string
} {
  switch (pitwall.status) {
    case 'missing':
      return {
        commands:
          INSTALL_COMMANDS[pitwall.platform === 'win32' ? 'win32' : 'unix'],
        fix: 'aide runs its agents in pitwall. Install it with one of these, then check again.',
        title: 'pitwall is not installed',
      }
    case 'outdated':
      return {
        commands: ['pitwall update'],
        fix: `aide needs pitwall ${pitwall.required} or newer, and this one is ${pitwall.version}. Update it, or use brew upgrade or scoop update if one of them installed it.`,
        title: 'pitwall is too old',
      }
    case 'noEndpoint':
      return {
        commands: ['[web]\nenabled = true'],
        fix: "pitwall runs but its web listener, which aide connects to, is off. Turn it on and aide adds these lines to pitwall's config.toml, or add them yourself (pitwall config path prints where it is).",
        title: 'pitwall is not listening for aide',
      }
    case 'failed':
      return {
        commands: [pitwall.reason],
        fix: `aide started pitwall's background service and it stopped at once with this error. Its full output is in ${pitwall.log}.`,
        title: 'pitwall could not start',
      }
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message.replace(
        /^Error invoking remote method '[^']+': Error: /,
        '',
      )
    : 'aide could not change config.toml.'
}

/** Says why aide cannot reach pitwall and what to run, with a button to look again. */
export default function PitwallSetupCard({
  onCheckAgain,
  onTurnOn,
  pitwall,
}: PitwallSetupCardProps) {
  const { commands, fix, title } = copyFor(pitwall)
  const [turningOn, setTurningOn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const turnOn = async () => {
    if (!onTurnOn) return
    setTurningOn(true)
    setError(null)
    try {
      await onTurnOn()
      onCheckAgain()
    } catch (caught) {
      setError(getErrorMessage(caught))
    } finally {
      setTurningOn(false)
    }
  }
  return (
    <div
      className="fixed inset-x-0 top-16 z-50 mx-auto w-full max-w-xl rounded-lg border border-accent-red bg-surface px-4 py-3 shadow-lg"
      data-testid="pitwall-setup-card"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent-red" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-sm text-body">{fix}</p>
          {commands.map((command) => (
            <pre
              className="mt-2 select-text whitespace-pre-wrap break-all rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground"
              key={command}
            >
              {command}
            </pre>
          ))}
          {error ? (
            <p className="mt-2 text-sm text-destructive" role="status">
              {error}
            </p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {pitwall.status === 'noEndpoint' && onTurnOn ? (
              // why: the theme flattens --accent, so variant="primary" needs the Action Blue tokens to read as the filled action.
              <Button
                className="bg-primary text-primary-foreground"
                isPending={turningOn}
                onPress={() => void turnOn()}
                size="sm"
                variant="primary"
              >
                <Power className="size-3.5" />
                Turn on for aide
              </Button>
            ) : null}
            <Button
              isDisabled={turningOn}
              onPress={onCheckAgain}
              size="sm"
              variant="secondary"
            >
              <RotateCcw className="size-3.5" />
              Check again
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

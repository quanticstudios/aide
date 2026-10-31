import { Button } from '@heroui/react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import type { PitwallStatus } from '../../../shared/ipc'

interface PitwallSetupCardProps {
  readonly onCheckAgain: () => void
  readonly onUseBuiltIn: () => void
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
        fix: "pitwall runs but has not opened its web listener, which aide connects to. If this stays, add these lines to pitwall's config.toml (pitwall config path prints where it is).",
        title: 'pitwall is not listening for aide',
      }
  }
}

/** Says why aide cannot reach pitwall and what to run, with buttons to look again or fall back to built-in sessions. */
export default function PitwallSetupCard({
  onCheckAgain,
  onUseBuiltIn,
  pitwall,
}: PitwallSetupCardProps) {
  const { commands, fix, title } = copyFor(pitwall)
  return (
    <div
      className="fixed inset-x-0 top-2 z-50 mx-auto w-full max-w-xl rounded-lg border border-accent-red bg-surface px-4 py-3 shadow-lg"
      data-testid="pitwall-setup-card"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent-red" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-sm text-foreground">{fix}</p>
          {commands.map((command) => (
            <pre
              className="mt-2 select-text whitespace-pre-wrap break-all rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground"
              key={command}
            >
              {command}
            </pre>
          ))}
          <div className="mt-3 flex gap-2">
            <Button onPress={onCheckAgain} size="sm" variant="secondary">
              <RotateCcw className="size-3.5" />
              Check again
            </Button>
            <Button onPress={onUseBuiltIn} size="sm" variant="ghost">
              Use built-in sessions
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

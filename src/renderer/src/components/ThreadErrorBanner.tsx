import { Button } from '@heroui/react'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import type {
  ManagedSessionErrorKind,
  ManagedSessionProvider,
} from '../../../shared/managed-session'

interface ThreadErrorBannerProps {
  readonly kind: ManagedSessionErrorKind
  readonly message: string
  readonly onRetry: () => void
  readonly provider: ManagedSessionProvider
}

const PROVIDER_NAMES = { claude: 'Claude', codex: 'Codex' } as const

const COPY: Record<
  ManagedSessionErrorKind,
  (provider: ManagedSessionProvider) => { fix: string; title: string }
> = {
  auth: (provider) => ({
    fix:
      provider === 'claude'
        ? 'Run `claude` in a terminal and sign in with /login, then retry.'
        : 'Run `codex login` in a terminal, then retry.',
    title: `${PROVIDER_NAMES[provider]} is not signed in`,
  }),
  executable: (provider) => ({
    fix:
      provider === 'claude'
        ? 'Reinstall Aide, or set AIDE_CLAUDE_COMMAND to a Claude Code binary, then retry.'
        : 'Install the Codex CLI so `codex` is on your PATH, then retry.',
    title: `${PROVIDER_NAMES[provider]} CLI not found`,
  }),
  network: (provider) => ({
    fix: 'Check your internet connection, VPN or proxy, then retry.',
    title: `Can't reach ${PROVIDER_NAMES[provider]}`,
  }),
}

export default function ThreadErrorBanner({
  kind,
  message,
  onRetry,
  provider,
}: ThreadErrorBannerProps) {
  const { fix, title } = COPY[kind](provider)
  return (
    <div
      className="mx-auto w-full max-w-3xl rounded-lg border border-accent-red bg-accent-red-soft px-4 py-3"
      data-testid="thread-error-banner"
      role="alert"
    >
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent-red" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">{title}</p>
          <p className="mt-1 text-sm text-foreground">{fix}</p>
          <p className="mt-1 break-words font-mono text-[11px] text-muted-foreground">
            {message}
          </p>
          <div className="mt-3">
            <Button onPress={onRetry} size="sm" variant="secondary">
              <RotateCcw className="size-3.5" />
              Retry
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

import { Button } from '@heroui/react'
import { Clock } from 'lucide-react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ManagedSessionUsageLimit } from '../../../shared/managed-session'
import { formatResetTime, scheduleResumeAtReset } from '../lib/resume-at-reset'

interface UsageLimitBannerProps {
  /** The composer draft; any change after arming counts as the user typing. */
  readonly draftInput: string
  readonly limit: ManagedSessionUsageLimit
  readonly onResume: () => void
}

type ResumeState =
  | { kind: 'idle' }
  | { kind: 'armed'; armedAt: number }
  | { kind: 'sent' }
  | { kind: 'skipped' }

const PROVIDER_NAMES = { claude: 'Claude', codex: 'Codex' } as const

export default function UsageLimitBanner({
  draftInput,
  limit,
  onResume,
}: UsageLimitBannerProps) {
  const [resume, setResume] = useState<ResumeState>({ kind: 'idle' })
  const lastTypedAtRef = useRef<number | null>(null)
  const draftRef = useRef(draftInput)
  const onResumeRef = useRef(onResume)
  useLayoutEffect(() => {
    onResumeRef.current = onResume
  })
  // invariant: one arming sends at most once, even when an effect re-runs after the reset passed.
  const sentForRef = useRef<number | null>(null)

  useEffect(() => {
    if (draftRef.current === draftInput) return
    draftRef.current = draftInput
    lastTypedAtRef.current = Date.now()
  }, [draftInput])

  const armedAt = resume.kind === 'armed' ? resume.armedAt : null
  useEffect(() => {
    if (armedAt === null || !limit.resetsAt) return
    return scheduleResumeAtReset({
      armedAt,
      getLastTypedAt: () => lastTypedAtRef.current,
      onSend: () => {
        if (sentForRef.current === armedAt) return
        sentForRef.current = armedAt
        setResume({ kind: 'sent' })
        onResumeRef.current()
      },
      onSkip: () => setResume({ kind: 'skipped' }),
      resetsAt: Date.parse(limit.resetsAt),
    })
  }, [armedAt, limit.resetsAt])

  const resetTime = limit.resetsAt
    ? formatResetTime(limit.resetsAt, new Date())
    : null

  return (
    <div
      className="mx-auto w-full max-w-3xl rounded-lg border border-accent-yellow/50 bg-accent-yellow-soft px-4 py-3"
      data-testid="usage-limit-banner"
      role="status"
    >
      <div className="flex items-start gap-3">
        <Clock className="mt-0.5 size-4 shrink-0 text-accent-yellow" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-foreground">
            {PROVIDER_NAMES[limit.provider]} usage limit reached
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {resetTime
              ? `${limit.label} resets at ${resetTime}.`
              : `${limit.label}. The provider did not say when it resets.`}
            {resume.kind === 'armed'
              ? ' Aide will send "continue" then.'
              : resume.kind === 'sent'
                ? ' Sent "continue".'
                : resume.kind === 'skipped'
                  ? ' Did not resume, because you typed since.'
                  : null}
          </p>
          {resetTime && resume.kind !== 'sent' ? (
            <div className="mt-3 flex flex-wrap gap-2">
              {resume.kind === 'armed' ? (
                <Button
                  onPress={() => setResume({ kind: 'idle' })}
                  size="sm"
                  variant="secondary"
                >
                  Cancel resume
                </Button>
              ) : (
                <Button
                  onPress={() =>
                    setResume({ armedAt: Date.now(), kind: 'armed' })
                  }
                  size="sm"
                  variant="secondary"
                >
                  Resume at reset
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

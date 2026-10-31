import { Button, Modal } from '@heroui/react'
import {
  CircleCheck,
  CircleDot,
  CircleX,
  GitMerge,
  GitPullRequest,
} from 'lucide-react'
import { useState } from 'react'
import { isDaemonTransport } from '../lib/daemon-transport'
import {
  type PullRequestState,
  sendableParts,
  summarizeChecks,
} from '../lib/pull-request'
import { getSessionTransport } from '../lib/session-transport'

const REVIEW_LABELS = {
  '': null,
  approved: 'Approved',
  changes: 'Changes requested',
  required: 'Review required',
} as const

type Part = 'failures' | 'review'

interface ManagedPullRequestRowProps {
  readonly onFixInNewThread: (prompt: string) => void
  /** Sends pitwall's message to this thread's agent; false when it did not send. */
  readonly onSend: (prompt: string) => Promise<boolean>
  readonly sessionId: string
  readonly state: PullRequestState
}

/** The thread's pull request above the composer: checks, review, and pitwall's send, fix and merge actions. */
export default function ManagedPullRequestRow({
  onFixInNewThread,
  onSend,
  sessionId,
  state: { pullRequest, review, reviewError },
}: ManagedPullRequestRowProps) {
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [isMergeOpen, setIsMergeOpen] = useState(false)
  const transport = getSessionTransport()
  if (!pullRequest || !isDaemonTransport(transport)) return null

  const checks = summarizeChecks(pullRequest)
  const parts = sendableParts(pullRequest, review)
  const open = pullRequest.state === 'open'
  const reviewLabel = REVIEW_LABELS[pullRequest.review]
  const threadCount = review?.threads.length ?? 0

  const run = async (action: string, task: () => Promise<void>) => {
    setBusy(action)
    setNotice(null)
    try {
      await task()
    } catch (error) {
      setNotice(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(null)
    }
  }

  const act = (part: Part, how: 'fix' | 'send') =>
    run(`${how}:${part}`, async () => {
      const prompt = await transport.pullRequestPrompt(sessionId, part)
      if (!prompt) {
        setNotice(
          part === 'failures'
            ? 'No failed checks to send.'
            : 'No review comment to send.',
        )
        return
      }
      if (how === 'fix') onFixInNewThread(prompt)
      else await onSend(prompt)
    })

  const actions = (part: Part, label: string) => (
    <div className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate">{label}</span>
      <Button
        isDisabled={busy !== null}
        isPending={busy === `send:${part}`}
        onPress={() => void act(part, 'send')}
        size="sm"
        variant="secondary"
      >
        Send to agent
      </Button>
      <Button
        isDisabled={busy !== null}
        isPending={busy === `fix:${part}`}
        onPress={() => void act(part, 'fix')}
        size="sm"
        variant="secondary"
      >
        Fix in a new thread
      </Button>
    </div>
  )

  return (
    <section
      aria-label="Pull request"
      className="mx-auto w-full max-w-3xl rounded-lg border border-border bg-surface-2 px-3 py-2 text-xs text-muted-foreground"
      data-testid="managed-pull-request"
    >
      <div className="flex items-center gap-2">
        {pullRequest.state === 'merged' ? (
          <GitMerge className="size-3.5 shrink-0 text-accent-purple" />
        ) : (
          <GitPullRequest
            className={
              open
                ? 'size-3.5 shrink-0 text-accent-green'
                : 'size-3.5 shrink-0 text-muted-foreground'
            }
          />
        )}
        <a
          className="font-medium text-foreground hover:underline"
          href={pullRequest.url}
          rel="noreferrer"
          target="_blank"
        >
          #{pullRequest.number}
        </a>
        <span>
          {pullRequest.draft && open
            ? 'Draft'
            : pullRequest.state === 'open'
              ? 'Open'
              : pullRequest.state === 'merged'
                ? 'Merged'
                : 'Closed'}
        </span>
        {open && pullRequest.checks.length > 0 ? (
          <span
            className="flex items-center gap-1"
            data-testid="managed-pull-request-checks"
          >
            {checks.failing.length > 0 ? (
              <CircleX className="size-3.5 text-accent-red" />
            ) : checks.pending > 0 ? (
              <CircleDot className="size-3.5 text-accent-yellow" />
            ) : (
              <CircleCheck className="size-3.5 text-accent-green" />
            )}
            {checks.passing} passing · {checks.failing.length} failing ·{' '}
            {checks.pending} pending
          </span>
        ) : null}
        {open && reviewLabel ? <span>{reviewLabel}</span> : null}
        {open && pullRequest.conflicts ? (
          <span className="text-accent-red">Conflicts</span>
        ) : null}
        <span className="flex-1" />
        {open ? (
          <Button
            isDisabled={busy !== null || pullRequest.draft}
            isPending={busy === 'merge'}
            onPress={() => setIsMergeOpen(true)}
            size="sm"
            variant="secondary"
          >
            <GitMerge className="size-3.5" />
            Merge
          </Button>
        ) : null}
      </div>
      {parts.failures || parts.review ? (
        <div className="mt-2 space-y-1.5 border-t border-border pt-2">
          {parts.failures
            ? actions('failures', `Failing: ${checks.failing.join(', ')}`)
            : null}
          {parts.review
            ? actions(
                'review',
                threadCount > 0
                  ? `${threadCount} unresolved ${threadCount === 1 ? 'thread' : 'threads'}`
                  : 'Changes requested',
              )
            : null}
        </div>
      ) : null}
      {notice || reviewError ? (
        <p className="mt-1 text-xs text-danger" role="alert">
          {notice ?? `Review threads: ${reviewError}`}
        </p>
      ) : null}
      <Modal>
        <Modal.Backdrop
          isDismissable
          isOpen={isMergeOpen}
          onOpenChange={setIsMergeOpen}
          variant="opaque"
        >
          <Modal.Container placement="center" size="sm">
            <Modal.Dialog className="rounded-xl floating-surface text-foreground">
              <Modal.Header>
                <Modal.Heading>Merge #{pullRequest.number}?</Modal.Heading>
              </Modal.Header>
              <Modal.Body className="space-y-2 text-sm text-muted-foreground">
                <p>
                  pitwall runs gh pr merge with your [git] merge_method, squash
                  unless you set another.
                </p>
                {checks.failing.length > 0 || checks.pending > 0 ? (
                  <p className="text-accent-red">
                    {checks.failing.length} failing and {checks.pending} pending{' '}
                    {checks.failing.length + checks.pending === 1
                      ? 'check'
                      : 'checks'}
                    .
                  </p>
                ) : null}
                {pullRequest.review === 'changes' ? (
                  <p className="text-accent-red">
                    A reviewer requested changes.
                  </p>
                ) : null}
              </Modal.Body>
              <Modal.Footer>
                <Button
                  autoFocus
                  onPress={() => setIsMergeOpen(false)}
                  variant="secondary"
                >
                  Cancel
                </Button>
                <Button
                  onPress={() => {
                    setIsMergeOpen(false)
                    void run('merge', () =>
                      transport.mergePullRequest(sessionId),
                    )
                  }}
                  variant={
                    checks.failing.length > 0 ||
                    pullRequest.review === 'changes'
                      ? 'danger'
                      : 'primary'
                  }
                >
                  Merge
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </section>
  )
}

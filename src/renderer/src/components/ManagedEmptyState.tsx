import { GitBranch } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { WorkspaceRecord } from '../../../shared/persistence'
import { useWorkspaceGitStatus } from '../hooks/useWorkspaceGitStatus'
import { getSessionTransport } from '../lib/session-transport'

const RECENT_PROMPT_LIMIT = 3

export default function ManagedEmptyState({
  model,
  onPickPrompt,
  providerLabel,
  sessionId,
  workspace,
}: {
  readonly model: string | undefined
  readonly onPickPrompt: (text: string) => void
  readonly providerLabel: string
  readonly sessionId: string
  readonly workspace: WorkspaceRecord
}) {
  const { branchName } = useWorkspaceGitStatus(workspace.id)
  const [recentPrompts, setRecentPrompts] = useState<readonly string[]>([])

  useEffect(() => {
    const transport = getSessionTransport()
    if (!transport) return
    let cancelled = false
    const loadRecentPrompts = async () => {
      const { tasks } = await transport.listSessions()
      const earlier = tasks
        .filter(
          (task) =>
            task.workspaceId === workspace.id && task.sessionId !== sessionId,
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      const prompts: string[] = []
      // why: task titles are cut to 100 characters, so the full first prompt comes from the saved transcript.
      for (const task of earlier) {
        if (prompts.length === RECENT_PROMPT_LIMIT) break
        const transcript = await transport.getSavedSession(task.sessionId)
        const prompt = transcript?.content
          .find((item) => item.kind === 'user-prompt')
          ?.text.trim()
        if (prompt && !prompts.includes(prompt)) prompts.push(prompt)
      }
      if (!cancelled) setRecentPrompts(prompts)
    }
    void loadRecentPrompts().catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [sessionId, workspace.id])

  return (
    <div
      className="mx-auto flex h-full max-w-xl flex-col justify-center gap-4"
      data-testid="managed-empty-state"
    >
      <div className="space-y-1">
        <p className="text-sm font-semibold text-foreground">
          {workspace.name}
        </p>
        <p className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
          <GitBranch className="size-3.5" />
          {branchName ?? workspace.branchName}
        </p>
        <p className="text-xs text-muted-foreground">
          {providerLabel}
          {model ? ` · ${model}` : ''}
        </p>
      </div>
      {recentPrompts.length > 0 ? (
        <div className="space-y-1.5">
          <p className="text-xs font-medium text-muted-foreground">
            Recent prompts
          </p>
          <ul className="space-y-1">
            {recentPrompts.map((prompt) => (
              <li key={prompt}>
                <button
                  className="w-full truncate rounded-md border border-[var(--border-soft)] bg-surface-1 px-3 py-2 text-left text-[13px] text-body transition-colors hover:bg-surface-2 hover:text-foreground"
                  onClick={() => onPickPrompt(prompt)}
                  title={prompt}
                  type="button"
                >
                  {prompt}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

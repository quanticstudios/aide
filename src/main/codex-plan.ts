import type {
  ManagedProviderRuntimeTask,
  ManagedProviderRuntimeToolCall,
} from '../shared/provider-runtime'

const STEP_STATUSES: Record<string, ManagedProviderRuntimeTask['status']> = {
  completed: 'completed',
  inProgress: 'in_progress',
  in_progress: 'in_progress',
  pending: 'pending',
}

/** Maps Codex `turn/plan/updated` to one task-list call per turn, so each update replaces the last. */
export function mapCodexPlanUpdate(
  params: unknown,
  activeTurnId: string | null,
): ManagedProviderRuntimeToolCall | null {
  const record =
    params && typeof params === 'object'
      ? (params as { plan?: unknown; turnId?: unknown })
      : {}
  const turnId =
    typeof record.turnId === 'string' ? record.turnId : activeTurnId
  if (!turnId || !Array.isArray(record.plan)) return null

  const tasks = record.plan.flatMap((entry): ManagedProviderRuntimeTask[] => {
    const { status, step } =
      entry && typeof entry === 'object'
        ? (entry as { status?: unknown; step?: unknown })
        : {}
    return typeof step === 'string' && step.trim()
      ? [
          {
            status:
              (typeof status === 'string' && STEP_STATUSES[status]) ||
              'pending',
            subject: step,
          },
        ]
      : []
  })
  if (tasks.length === 0) return null

  return {
    callId: `plan:${turnId}`,
    input: params,
    status: 'completed',
    tasks,
    toolName: 'update_plan',
  }
}

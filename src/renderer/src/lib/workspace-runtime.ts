import type { PreviewTarget } from '../../../shared/domain'
import type { WorkspaceRecord } from '../../../shared/persistence'
import { isAllowedPreviewUrl, normalizePreviewUrl } from './preview-target'

export interface WorkspaceRuntimePreviewState {
  activeTargetId: string | null
  targets: PreviewTarget[]
}

export type WorkspaceRuntimeState = Record<string, WorkspaceRuntimePreviewState>

function createPreviewTargetId(url: string): string {
  return `preview:${url}`
}

export function createDefaultPreviewTarget(
  workspace: WorkspaceRecord,
): PreviewTarget {
  const normalizedUrl = normalizePreviewUrl('')

  return {
    id: createPreviewTargetId(normalizedUrl),
    isActive: true,
    label: `${workspace.name} preview`,
    url: normalizedUrl,
  }
}

export function getWorkspacePreviewState(
  runtimeState: WorkspaceRuntimeState,
  workspace: WorkspaceRecord | null,
): WorkspaceRuntimePreviewState {
  if (!workspace) {
    return {
      activeTargetId: null,
      targets: [],
    }
  }

  return (
    runtimeState[workspace.id] ?? {
      activeTargetId: createDefaultPreviewTarget(workspace).id,
      targets: [createDefaultPreviewTarget(workspace)],
    }
  )
}

export function upsertWorkspacePreviewTarget(args: {
  label?: string
  runtimeState: WorkspaceRuntimeState
  url: string
  workspace: WorkspaceRecord
}): WorkspaceRuntimeState {
  const normalizedUrl = normalizePreviewUrl(args.url)

  if (!isAllowedPreviewUrl(normalizedUrl)) {
    return args.runtimeState
  }

  const currentState = getWorkspacePreviewState(
    args.runtimeState,
    args.workspace,
  )
  const targetId = createPreviewTargetId(normalizedUrl)
  const existingTarget = currentState.targets.find(
    (target) => target.id === targetId,
  )
  const targetLabel =
    args.label?.trim() ||
    existingTarget?.label ||
    `${args.workspace.name} preview`
  const nextTargets = [
    ...currentState.targets.filter((target) => target.id !== targetId),
    {
      id: targetId,
      isActive: true,
      label: targetLabel,
      url: normalizedUrl,
    },
  ].map((target) => ({
    ...target,
    isActive: target.id === targetId,
  }))

  return {
    ...args.runtimeState,
    [args.workspace.id]: {
      activeTargetId: targetId,
      targets: nextTargets,
    },
  }
}

export function selectWorkspacePreviewTarget(args: {
  runtimeState: WorkspaceRuntimeState
  targetId: string
  workspace: WorkspaceRecord
}): WorkspaceRuntimeState {
  const currentState = getWorkspacePreviewState(
    args.runtimeState,
    args.workspace,
  )

  if (!currentState.targets.some((target) => target.id === args.targetId)) {
    return args.runtimeState
  }

  return {
    ...args.runtimeState,
    [args.workspace.id]: {
      activeTargetId: args.targetId,
      targets: currentState.targets.map((target) => ({
        ...target,
        isActive: target.id === args.targetId,
      })),
    },
  }
}

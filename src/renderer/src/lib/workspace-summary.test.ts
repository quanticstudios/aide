import { describe, expect, it } from 'vitest'

import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'
import type { WorkspaceActivitySnapshot } from '../../../shared/workspace-activity'
import {
  buildWorkspaceSummaryMap,
  resolveProjectSummaryActivity,
} from './workspace-summary'

function createProject(id: string, name: string): ProjectRecord {
  return {
    createdAt: '2026-03-24T00:00:00Z',
    defaultBranch: 'main',
    id,
    kind: 'git',
    name,
    remoteUrl: null,
    repoRoot: `/repo/${name}`,
    setupCommand: null,
    updatedAt: '2026-03-24T00:00:00Z',
    worktreeSetupRevision: 0,
  }
}

function createWorkspace(
  id: string,
  projectId: string,
  name: string,
): WorkspaceRecord {
  return {
    branchName: `${name}-branch`,
    createdAt: '2026-03-24T00:00:00Z',
    id,
    name,
    projectId,
    updatedAt: '2026-03-24T00:00:00Z',
    windowId: null,
    worktreePath: `/repo/${projectId}/${name}`,
  }
}

function createActivity(
  workspaceId: string,
  state: WorkspaceActivitySnapshot['state'],
): WorkspaceActivitySnapshot {
  return {
    detail: null,
    paneId: `${workspaceId}:pane-1`,
    provider: 'claude',
    sessionId: `${workspaceId}:session-1`,
    source: 'managed',
    state,
    updatedAt: '2026-04-06T12:00:00Z',
    workspaceId,
  }
}

describe('buildWorkspaceSummaryMap', () => {
  it('builds compact branch and runtime activity summaries for real workspaces', () => {
    const summaries = buildWorkspaceSummaryMap(
      [createProject('project-a', 'aide')],
      [
        createWorkspace('workspace-nav', 'project-a', 'nav'),
        createWorkspace('workspace-review', 'project-a', 'review'),
      ],
      {
        'workspace-review': [createActivity('workspace-review', 'working')],
      },
    )

    expect(summaries['workspace-nav']).toMatchObject({
      activity: null,
      activities: [],
      branchName: 'nav-branch',
      projectName: 'aide',
      workspaceName: 'nav',
    })
    expect(summaries['workspace-review']).toMatchObject({
      activities: [
        {
          provider: 'claude',
          state: 'working',
        },
      ],
      activity: {
        provider: 'claude',
        state: 'working',
      },
    })
  })

  it('does not inject placeholder activity when no runtime state exists', () => {
    const summaries = buildWorkspaceSummaryMap(
      [createProject('project-a', 'aide')],
      [createWorkspace('demo-workspace-aide-review', 'project-a', 'review')],
      {},
    )

    expect(summaries['demo-workspace-aide-review']?.activity).toBeNull()
  })
})

describe('resolveProjectSummaryActivity', () => {
  it('aggregates child workspace activity by priority', () => {
    const workspaces = [
      createWorkspace('workspace-a', 'project-a', 'nav'),
      createWorkspace('workspace-b', 'project-a', 'review'),
    ]
    const summaries = buildWorkspaceSummaryMap(
      [createProject('project-a', 'aide')],
      workspaces,
      {
        'workspace-a': [createActivity('workspace-a', 'working')],
        'workspace-b': [createActivity('workspace-b', 'pending-approval')],
      },
    )

    expect(
      resolveProjectSummaryActivity(summaries, workspaces, 'project-a'),
    ).toMatchObject({
      state: 'pending-approval',
      workspaceId: 'workspace-b',
    })
  })
})

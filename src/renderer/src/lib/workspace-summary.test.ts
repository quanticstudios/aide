import { describe, expect, it } from 'vitest'

import type {
  ProjectRecord,
  WorkspaceRecord,
} from '../../../shared/persistence'
import { buildWorkspaceSummaryMap } from './workspace-summary'

function createProject(id: string, name: string): ProjectRecord {
  return {
    id,
    name,
    repoRoot: `/repo/${name}`,
    remoteUrl: null,
    defaultBranch: 'main',
    createdAt: '2026-03-24T00:00:00Z',
    updatedAt: '2026-03-24T00:00:00Z',
  }
}

function createWorkspace(
  id: string,
  projectId: string,
  name: string,
): WorkspaceRecord {
  return {
    id,
    projectId,
    name,
    branchName: `${name}-branch`,
    worktreePath: `/repo/${projectId}/${name}`,
    windowId: null,
    createdAt: '2026-03-24T00:00:00Z',
    updatedAt: '2026-03-24T00:00:00Z',
  }
}

describe('buildWorkspaceSummaryMap', () => {
  it('builds compact branch, status, and placeholder job-count summaries', () => {
    const summaries = buildWorkspaceSummaryMap(
      [createProject('project-a', 'aide')],
      [
        createWorkspace('demo-workspace-aide-nav', 'project-a', 'nav'),
        createWorkspace('demo-workspace-aide-review', 'project-a', 'review'),
      ],
      'demo-workspace-aide-review',
    )

    expect(summaries['demo-workspace-aide-nav']).toMatchObject({
      branchName: 'nav-branch',
      jobCount: 2,
      projectName: 'aide',
      status: 'idle',
      workspaceName: 'nav',
    })
    expect(summaries['demo-workspace-aide-review']).toMatchObject({
      jobCount: 1,
      status: 'error',
    })
  })
})

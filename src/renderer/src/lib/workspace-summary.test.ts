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
        createWorkspace('workspace-1', 'project-a', 'nav'),
        createWorkspace('workspace-2', 'project-a', 'review'),
      ],
      'workspace-2',
    )

    expect(summaries['workspace-1']).toMatchObject({
      branchName: 'nav-branch',
      jobCount: 0,
      projectName: 'aide',
      status: 'idle',
      workspaceName: 'nav',
    })
    expect(summaries['workspace-2']).toMatchObject({
      status: 'active',
    })
  })
})

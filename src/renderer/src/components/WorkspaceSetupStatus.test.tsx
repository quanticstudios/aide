import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { WorkspaceSetupSnapshot } from '../../../shared/workspace-setup'
import WorkspaceSetupStatus from './WorkspaceSetupStatus'

const setup: WorkspaceSetupSnapshot = {
  attempt: 0,
  commandRequired: true,
  endedAt: null,
  errorSummary: null,
  exitCode: null,
  outputByteLength: 0,
  outputLineCount: 0,
  outputTail: '',
  outputTruncated: false,
  projectSetupRevision: 1,
  revision: 1,
  signal: null,
  startedAt: null,
  state: 'not-required',
  updatedAt: '2026-11-02T00:00:00.000Z',
  workspaceId: 'workspace-1',
}

describe('WorkspaceSetupStatus', () => {
  it('sits in the layout above the panes instead of floating over them', () => {
    const markup = renderToStaticMarkup(
      <WorkspaceSetupStatus
        onCancel={() => undefined}
        onRun={() => undefined}
        setup={setup}
      />,
    )
    expect(markup).toContain('Run setup')
    expect(markup).not.toMatch(/class="[^"]*\babsolute\b/)
  })
})

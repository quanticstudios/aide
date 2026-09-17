import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { TurnCheckpointPreview } from '../../../shared/checkpoints'
import {
  CheckpointRestoreContent,
  getCheckpointChangeLabel,
} from './ManagedCheckpointControls'

const preview: TurnCheckpointPreview = {
  changes: [
    { path: 'src/new.ts', status: 'added' },
    {
      path: 'src/current.ts',
      previousPath: 'src/old.ts',
      status: 'renamed',
    },
  ],
  checkpoint: {
    capturedAt: '2026-09-17T10:00:00.000Z',
    checkpointId: '00000000-0000-0000-0000-000000000000',
    sessionId: 'session-1',
    workspaceId: 'workspace-1',
  },
  createdAt: '2026-09-17T10:01:00.000Z',
  expiresAt: '2026-09-17T10:11:00.000Z',
  previewId: '11111111-1111-1111-1111-111111111111',
  sessionRevision: 3,
  turnChanges: [{ path: 'src/new.ts', status: 'added' }],
}

describe('CheckpointRestoreContent', () => {
  it('shows both explicit restore choices and the file preview', () => {
    const markup = renderToStaticMarkup(
      <CheckpointRestoreContent
        error={null}
        mode="conversation-only"
        onModeChange={vi.fn()}
        preview={preview}
      />,
    )

    expect(markup).toContain('Conversation only')
    expect(markup).toContain('Code and conversation')
    expect(markup).toContain('src/new.ts')
    expect(markup).toContain('src/old.ts')
    expect(markup).toContain('src/current.ts')
    expect(markup).toContain('current conversation remains unchanged')
  })

  it('labels renamed paths without hiding the original', () => {
    const rename = preview.changes[1]
    expect(rename).toBeDefined()
    if (!rename) return
    expect(getCheckpointChangeLabel(rename)).toBe('src/old.ts → src/current.ts')
  })
})

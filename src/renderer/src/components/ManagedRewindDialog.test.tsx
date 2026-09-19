import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import type { TurnCheckpointPreview } from '../../../shared/checkpoints'
import {
  getRewindChangeLabel,
  RewindRestoreContent,
} from './ManagedRewindDialog'

const preview: TurnCheckpointPreview = {
  changes: [
    { path: 'src/new.ts', status: 'added' },
    { path: 'src/current.ts', previousPath: 'src/old.ts', status: 'renamed' },
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
  restorePatch: 'diff --git a/src/new.ts b/src/new.ts\n',
  sessionRevision: 3,
  turnChanges: [{ path: 'src/new.ts', status: 'added' }],
  turnPatch: 'diff --git a/src/new.ts b/src/new.ts\n',
}

describe('RewindRestoreContent', () => {
  it('offers both restore choices and lists the files a restore would revert', () => {
    const markup = renderToStaticMarkup(
      <RewindRestoreContent
        error={null}
        mode="conversation-only"
        onModeChange={vi.fn()}
        preview={preview}
      />,
    )

    expect(markup).toContain('Keep file changes')
    expect(markup).toContain('Revert files too')
    expect(markup).toContain('src/new.ts')
    expect(markup).toContain('src/old.ts')
    expect(markup).toContain('src/current.ts')
  })

  it('shows the restore error instead of hiding it', () => {
    const markup = renderToStaticMarkup(
      <RewindRestoreContent
        error="The conversation changed after the preview. Preview it again."
        mode="conversation-only"
        onModeChange={vi.fn()}
        preview={preview}
      />,
    )

    expect(markup).toContain('The conversation changed after the preview.')
  })

  it('labels renamed paths without hiding the original', () => {
    const rename = preview.changes[1]
    expect(rename).toBeDefined()
    if (!rename) return
    expect(getRewindChangeLabel(rename)).toBe('src/old.ts → src/current.ts')
  })
})

import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

import {
  prepareManagedSessionAttachments,
  validateManagedSessionAttachments,
} from './managed-session-attachments'

const directories: string[] = []

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { force: true, recursive: true })
  }
})

describe('managed session attachments', () => {
  it('validates pasted image bytes and rejects false MIME claims', () => {
    const png = Buffer.from('89504e470d0a1a0a', 'hex')
    expect(
      validateManagedSessionAttachments([
        {
          data: png.toString('base64'),
          id: 'image-1',
          kind: 'image',
          mimeType: 'image/png',
          name: 'pasted.png',
          sizeBytes: png.byteLength,
        },
      ]),
    ).toHaveLength(1)
    expect(() =>
      validateManagedSessionAttachments([
        {
          data: png.toString('base64'),
          id: 'image-1',
          kind: 'image',
          mimeType: 'image/jpeg',
          name: 'pasted.jpg',
          sizeBytes: png.byteLength,
        },
      ]),
    ).toThrow('does not match')
  })

  it('loads explicit text and image evidence from regular workspace files', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'aide-attachments-'))
    directories.push(workspace)
    writeFileSync(path.join(workspace, 'notes.txt'), 'explicit fact')
    writeFileSync(
      path.join(workspace, 'screen.png'),
      Buffer.from('89504e470d0a1a0a', 'hex'),
    )
    const prepared = await prepareManagedSessionAttachments(
      workspace,
      [
        { id: 'text', kind: 'workspace-file', path: 'notes.txt' },
        { id: 'image', kind: 'workspace-file', path: 'screen.png' },
      ],
      new AbortController().signal,
    )
    expect(prepared.candidates).toEqual([
      expect.objectContaining({ content: 'explicit fact', path: 'notes.txt' }),
      expect.objectContaining({ path: 'screen.png' }),
    ])
    expect(prepared.evidence).toContainEqual({
      content: 'explicit fact',
      kind: 'workspace-file',
      path: 'notes.txt',
    })
    expect(prepared.images).toEqual([
      expect.objectContaining({ mimeType: 'image/png', name: 'screen.png' }),
    ])
  })

  it('rejects traversal and symbolic links', async () => {
    const workspace = mkdtempSync(path.join(tmpdir(), 'aide-attachments-'))
    const outside = mkdtempSync(
      path.join(tmpdir(), 'aide-attachments-outside-'),
    )
    directories.push(workspace, outside)
    writeFileSync(path.join(outside, 'secret.txt'), 'secret')
    symlinkSync(
      path.join(outside, 'secret.txt'),
      path.join(workspace, 'link.txt'),
    )
    await expect(
      prepareManagedSessionAttachments(
        workspace,
        [{ id: 'escape', kind: 'workspace-file', path: '../secret.txt' }],
        new AbortController().signal,
      ),
    ).rejects.toThrow('inside the project root')
    await expect(
      prepareManagedSessionAttachments(
        workspace,
        [{ id: 'link', kind: 'workspace-file', path: 'link.txt' }],
        new AbortController().signal,
      ),
    ).rejects.toThrow('not links')
  })
})

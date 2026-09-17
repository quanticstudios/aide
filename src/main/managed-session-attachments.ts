import { createHash } from 'node:crypto'
import { constants } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import path from 'node:path'

import type {
  ManagedSessionAttachment,
  ManagedSessionProviderImage,
} from '../shared/managed-session'
import {
  MANAGED_SESSION_MAX_ATTACHMENTS,
  MANAGED_SESSION_MAX_IMAGE_BYTES,
  MANAGED_SESSION_MAX_TOTAL_IMAGE_BYTES,
} from '../shared/managed-session'
import type { JevCandidate } from './jev-client'
import { resolveProjectFilePath } from './project-files'

const MAX_EXPLICIT_FILE_BYTES = 256 * 1024
const MAX_EXPLICIT_FILE_TOTAL_BYTES = 1024 * 1024
const imageMimeTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])

export interface PreparedManagedSessionAttachments {
  candidates: JevCandidate[]
  evidence: Array<{
    content?: string
    kind: 'image' | 'workspace-file'
    path: string
  }>
  images: ManagedSessionProviderImage[]
  revisions: Record<string, string>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isInsideRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== '..' &&
      !path.isAbsolute(relative))
  )
}

function getImageMimeType(
  buffer: Buffer,
): ManagedSessionProviderImage['mimeType'] | null {
  if (buffer.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) {
    return 'image/png'
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'image/webp'
  }
  return null
}

export function validateManagedSessionAttachments(
  value: unknown,
): ManagedSessionAttachment[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.length > MANAGED_SESSION_MAX_ATTACHMENTS) {
    throw new Error(`Attach at most ${MANAGED_SESSION_MAX_ATTACHMENTS} files.`)
  }

  let totalImageBytes = 0
  const identifiers = new Set<string>()
  return value.map((entry): ManagedSessionAttachment => {
    if (!isRecord(entry) || typeof entry.id !== 'string' || !entry.id.trim()) {
      throw new Error('Invalid attachment.')
    }
    if (identifiers.has(entry.id)) throw new Error('Duplicate attachment.')
    identifiers.add(entry.id)

    if (entry.kind === 'workspace-file') {
      if (
        typeof entry.path !== 'string' ||
        !entry.path.trim() ||
        entry.path.length > 4_096 ||
        path.isAbsolute(entry.path)
      ) {
        throw new Error('Workspace attachments require a relative file path.')
      }
      return { id: entry.id, kind: 'workspace-file', path: entry.path }
    }

    if (
      entry.kind !== 'image' ||
      typeof entry.data !== 'string' ||
      typeof entry.mimeType !== 'string' ||
      !imageMimeTypes.has(entry.mimeType) ||
      typeof entry.name !== 'string' ||
      !entry.name.trim() ||
      entry.name.length > 255 ||
      typeof entry.sizeBytes !== 'number' ||
      !Number.isInteger(entry.sizeBytes) ||
      entry.sizeBytes <= 0 ||
      entry.sizeBytes > MANAGED_SESSION_MAX_IMAGE_BYTES
    ) {
      throw new Error('Attach PNG, JPEG, or WebP images up to 5 MB each.')
    }
    const decoded = Buffer.from(entry.data, 'base64')
    if (
      decoded.byteLength !== entry.sizeBytes ||
      getImageMimeType(decoded) !== entry.mimeType
    ) {
      throw new Error(
        'Image attachment content does not match its type or size.',
      )
    }
    totalImageBytes += decoded.byteLength
    if (totalImageBytes > MANAGED_SESSION_MAX_TOTAL_IMAGE_BYTES) {
      throw new Error('Image attachments may total at most 10 MB.')
    }
    return {
      data: entry.data,
      id: entry.id,
      kind: 'image',
      mimeType: entry.mimeType as ManagedSessionProviderImage['mimeType'],
      name: entry.name,
      sizeBytes: entry.sizeBytes,
    }
  })
}

async function readWorkspaceAttachment(
  workspaceRoot: string,
  relativePath: string,
): Promise<{ absolutePath: string; buffer: Buffer; revision: string }> {
  const absolutePath = resolveProjectFilePath(workspaceRoot, relativePath)
  const initialStats = await lstat(absolutePath)
  if (initialStats.isSymbolicLink() || !initialStats.isFile()) {
    throw new Error('Workspace attachments must be regular files, not links.')
  }
  if (initialStats.size > MAX_EXPLICIT_FILE_BYTES) {
    throw new Error('Workspace attachments may be at most 256 KB each.')
  }
  const [resolvedRoot, resolvedPath] = await Promise.all([
    realpath(workspaceRoot),
    realpath(absolutePath),
  ])
  if (!isInsideRoot(resolvedRoot, resolvedPath)) {
    throw new Error(
      'Workspace attachment paths must stay inside the workspace.',
    )
  }
  const noFollow =
    typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0
  const file = await open(resolvedPath, constants.O_RDONLY | noFollow)
  try {
    const openedStats = await file.stat()
    if (
      !openedStats.isFile() ||
      openedStats.size > MAX_EXPLICIT_FILE_BYTES ||
      openedStats.dev !== initialStats.dev ||
      openedStats.ino !== initialStats.ino
    ) {
      throw new Error(
        'Workspace attachment changed before it could be read safely.',
      )
    }
    const buffer = await file.readFile()
    if (buffer.byteLength > MAX_EXPLICIT_FILE_BYTES) {
      throw new Error('Workspace attachments may be at most 256 KB each.')
    }
    return {
      absolutePath,
      buffer,
      revision: createHash('sha256').update(buffer).digest('hex'),
    }
  } finally {
    await file.close()
  }
}

export async function prepareManagedSessionAttachments(
  workspaceRoot: string,
  attachments: readonly ManagedSessionAttachment[],
  signal: AbortSignal,
): Promise<PreparedManagedSessionAttachments> {
  const candidates: JevCandidate[] = []
  const evidence: PreparedManagedSessionAttachments['evidence'] = []
  const images: ManagedSessionProviderImage[] = []
  const revisions: Record<string, string> = {}
  let workspaceFileBytes = 0

  for (const attachment of attachments) {
    signal.throwIfAborted()
    if (attachment.kind === 'image') {
      const revision = createHash('sha256')
        .update(attachment.data)
        .digest('hex')
      candidates.push({
        content: `Explicit pasted image: ${attachment.name} (${attachment.mimeType}, ${attachment.sizeBytes} bytes).`,
        contentRevision: revision,
        endLine: 1,
        id: `explicit:${attachment.id}`,
        path: `(attachment)/${attachment.name}`,
        startLine: 1,
      })
      evidence.push({ kind: 'image', path: attachment.name })
      images.push({
        data: attachment.data,
        mimeType: attachment.mimeType,
        name: attachment.name,
      })
      revisions[attachment.id] = revision
      continue
    }

    const file = await readWorkspaceAttachment(workspaceRoot, attachment.path)
    workspaceFileBytes += file.buffer.byteLength
    if (workspaceFileBytes > MAX_EXPLICIT_FILE_TOTAL_BYTES) {
      throw new Error('Workspace attachments may total at most 1 MB.')
    }
    const mimeType = getImageMimeType(file.buffer)
    const content = mimeType
      ? `Explicit workspace image: ${attachment.path} (${mimeType}, ${file.buffer.byteLength} bytes).`
      : new TextDecoder('utf-8', { fatal: true }).decode(file.buffer)
    candidates.push({
      content: content.slice(0, 24 * 1024),
      contentRevision: file.revision,
      endLine: Math.max(1, content.split('\n').length),
      id: `explicit:${attachment.id}`,
      path: attachment.path,
      startLine: 1,
    })
    evidence.push({
      ...(mimeType ? {} : { content }),
      kind: mimeType ? 'image' : 'workspace-file',
      path: attachment.path,
    })
    if (mimeType) {
      images.push({
        data: file.buffer.toString('base64'),
        mimeType,
        name: path.basename(attachment.path),
        path: file.absolutePath,
      })
    }
    revisions[attachment.id] = file.revision
  }

  return { candidates, evidence, images, revisions }
}

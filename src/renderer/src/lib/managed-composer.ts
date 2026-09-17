import type { ManagedSessionAttachment } from '../../../shared/managed-session'
import {
  MANAGED_SESSION_MAX_ATTACHMENTS,
  MANAGED_SESSION_MAX_IMAGE_BYTES,
  MANAGED_SESSION_MAX_TOTAL_IMAGE_BYTES,
} from '../../../shared/managed-session'

export async function createImageAttachments(
  files: readonly File[],
  existing: readonly ManagedSessionAttachment[],
): Promise<ManagedSessionAttachment[]> {
  const imageFiles = files.filter((file) => file.type.startsWith('image/'))
  if (imageFiles.length === 0) return []
  if (existing.length + imageFiles.length > MANAGED_SESSION_MAX_ATTACHMENTS) {
    throw new Error(`Attach at most ${MANAGED_SESSION_MAX_ATTACHMENTS} files.`)
  }
  const acceptedTypes = new Set(['image/jpeg', 'image/png', 'image/webp'])
  const existingImageBytes = existing.reduce(
    (total, attachment) =>
      total + (attachment.kind === 'image' ? attachment.sizeBytes : 0),
    0,
  )
  let totalImageBytes = existingImageBytes
  const attachments: ManagedSessionAttachment[] = []
  for (const file of imageFiles) {
    if (
      !acceptedTypes.has(file.type) ||
      file.size > MANAGED_SESSION_MAX_IMAGE_BYTES
    ) {
      throw new Error('Attach PNG, JPEG, or WebP images up to 5 MB each.')
    }
    totalImageBytes += file.size
    if (totalImageBytes > MANAGED_SESSION_MAX_TOTAL_IMAGE_BYTES) {
      throw new Error('Image attachments may total at most 10 MB.')
    }
    const bytes = new Uint8Array(await file.arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    attachments.push({
      data: btoa(binary),
      id: crypto.randomUUID(),
      kind: 'image',
      mimeType: file.type as 'image/jpeg' | 'image/png' | 'image/webp',
      name: file.name || 'Pasted image',
      sizeBytes: file.size,
    })
  }
  return attachments
}

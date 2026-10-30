import type { ManagedSessionAttachment } from '../../../shared/managed-session'
import {
  MANAGED_SESSION_MAX_ATTACHMENTS,
  MANAGED_SESSION_MAX_IMAGE_BYTES,
  MANAGED_SESSION_MAX_PASTED_TEXT_BYTES,
  MANAGED_SESSION_MAX_TOTAL_IMAGE_BYTES,
} from '../../../shared/managed-session'

export const PASTE_ATTACHMENT_THRESHOLD = 4_000
export const MAX_IMAGE_EDGE = 2_048
const MAX_IMAGE_INPUT_BYTES = 50 * 1024 * 1024

/** Turns a paste longer than the threshold into a text attachment, or returns null to paste inline. */
export function createPastedTextAttachment(
  text: string,
  existing: readonly ManagedSessionAttachment[],
): ManagedSessionAttachment | null {
  if (text.length <= PASTE_ATTACHMENT_THRESHOLD) return null
  if (existing.length >= MANAGED_SESSION_MAX_ATTACHMENTS) {
    throw new Error(`Attach at most ${MANAGED_SESSION_MAX_ATTACHMENTS} files.`)
  }
  if (
    new TextEncoder().encode(text).byteLength >
    MANAGED_SESSION_MAX_PASTED_TEXT_BYTES
  ) {
    throw new Error('Pasted text attachments may be at most 256 KB each.')
  }
  const pastedCount = existing.filter(
    (attachment) => attachment.kind === 'pasted-text',
  ).length
  return {
    id: crypto.randomUUID(),
    kind: 'pasted-text',
    name: `pasted-text-${pastedCount + 1}.txt`,
    text,
  }
}

export function fitImageWithin(
  width: number,
  height: number,
  maxEdge = MAX_IMAGE_EDGE,
): { height: number; width: number } {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return {
    height: Math.max(1, Math.round(height * scale)),
    width: Math.max(1, Math.round(width * scale)),
  }
}

async function downscaleImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file)
  try {
    const size = fitImageWithin(bitmap.width, bitmap.height)
    if (
      size.width === bitmap.width &&
      size.height === bitmap.height &&
      file.size <= MANAGED_SESSION_MAX_IMAGE_BYTES
    ) {
      return file
    }
    const canvas = new OffscreenCanvas(size.width, size.height)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Could not resize the image.')
    context.drawImage(bitmap, 0, 0, size.width, size.height)
    const encoded = await canvas.convertToBlob({
      quality: 0.9,
      type: file.type,
    })
    // why: a 2,048 px PNG photo can still pass 5 MB; WebP keeps alpha and shrinks it.
    return encoded.size <= MANAGED_SESSION_MAX_IMAGE_BYTES
      ? encoded
      : canvas.convertToBlob({ quality: 0.85, type: 'image/webp' })
  } finally {
    bitmap.close()
  }
}

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
    if (!acceptedTypes.has(file.type) || file.size > MAX_IMAGE_INPUT_BYTES) {
      throw new Error('Attach PNG, JPEG, or WebP images up to 50 MB each.')
    }
    const image = await downscaleImage(file)
    if (
      !acceptedTypes.has(image.type) ||
      image.size > MANAGED_SESSION_MAX_IMAGE_BYTES
    ) {
      throw new Error('Images must compress to 5 MB or less.')
    }
    totalImageBytes += image.size
    if (totalImageBytes > MANAGED_SESSION_MAX_TOTAL_IMAGE_BYTES) {
      throw new Error('Image attachments may total at most 10 MB.')
    }
    const bytes = new Uint8Array(await image.arrayBuffer())
    let binary = ''
    for (const byte of bytes) binary += String.fromCharCode(byte)
    attachments.push({
      data: btoa(binary),
      id: crypto.randomUUID(),
      kind: 'image',
      mimeType: image.type as 'image/jpeg' | 'image/png' | 'image/webp',
      name: file.name || 'Pasted image',
      sizeBytes: image.size,
    })
  }
  return attachments
}

import type { ManagedSessionAttachment } from '../../../shared/managed-session'
import { MANAGED_SESSION_MAX_ATTACHMENTS } from '../../../shared/managed-session'

export type MentionMenuSelection =
  | { readonly filePath: string; readonly kind: 'file' }
  | { readonly kind: 'skill'; readonly skillIndex: number }

export interface WorkspaceFileMention {
  readonly endIndex: number
  readonly query: string
  readonly startIndex: number
}

export function getWorkspaceFileMention(
  draft: string,
  cursorIndex: number,
): WorkspaceFileMention | null {
  const safeCursorIndex = Math.max(0, Math.min(cursorIndex, draft.length))
  const match = /(?:^|\s)@([A-Za-z0-9_./-]*)$/.exec(
    draft.slice(0, safeCursorIndex),
  )
  if (!match) return null
  const query = match[1] ?? ''
  return {
    endIndex: safeCursorIndex,
    query,
    startIndex: safeCursorIndex - query.length - 1,
  }
}

export function removeWorkspaceFileMention(
  draft: string,
  mention: WorkspaceFileMention,
): string {
  const beforeMention = draft.slice(0, mention.startIndex)
  const afterMention = draft.slice(mention.endIndex)
  return beforeMention.endsWith(' ') && afterMention.startsWith(' ')
    ? `${beforeMention}${afterMention.slice(1)}`
    : `${beforeMention}${afterMention}`
}

export function resolveMentionMenuSelection(
  activeIndex: number,
  skillCount: number,
  filePaths: readonly string[],
): MentionMenuSelection | null {
  if (activeIndex < 0) return null
  if (activeIndex < skillCount) {
    return { kind: 'skill', skillIndex: activeIndex }
  }
  const filePath = filePaths[activeIndex - skillCount]
  return filePath ? { filePath, kind: 'file' } : null
}

export function appendWorkspaceFileAttachment(
  attachments: readonly ManagedSessionAttachment[],
  filePath: string,
  attachmentId: string,
): readonly ManagedSessionAttachment[] {
  if (
    attachments.some(
      (attachment) =>
        attachment.kind === 'workspace-file' && attachment.path === filePath,
    )
  ) {
    return attachments
  }
  if (attachments.length >= MANAGED_SESSION_MAX_ATTACHMENTS) {
    throw new Error(`Attach at most ${MANAGED_SESSION_MAX_ATTACHMENTS} files.`)
  }
  return [
    ...attachments,
    { id: attachmentId, kind: 'workspace-file', path: filePath },
  ]
}

export class WorkspaceFileMentionSearch {
  private requestNumber = 0

  cancel(): void {
    this.requestNumber += 1
  }

  async run(
    search: () => Promise<readonly string[]>,
    accept: (filePaths: readonly string[]) => void,
    reject: (error: unknown) => void,
  ): Promise<void> {
    const requestNumber = this.requestNumber + 1
    this.requestNumber = requestNumber
    try {
      const filePaths = await search()
      if (this.requestNumber === requestNumber) accept(filePaths)
    } catch (error) {
      if (this.requestNumber === requestNumber) reject(error)
    }
  }
}

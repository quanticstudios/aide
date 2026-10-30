import { z } from 'zod'

import type { ManagedSessionSnapshot } from '../shared/managed-session'
import {
  getTaskActivity,
  type SavedTask,
  type TaskLibrarySnapshot,
  type TaskMetadataUpdate,
  taskSearchText,
} from '../shared/task-library'
import {
  buildTaskNotification,
  type TaskNotification,
} from '../shared/task-notification'
import type { AideDatabase } from './database'

function taskTitle(
  metadata: { title: string | null },
  snapshot: ManagedSessionSnapshot,
): string {
  const firstPrompt = snapshot.content.find(
    (item) => item.kind === 'user-prompt',
  )?.text
  return (
    metadata.title ??
    firstPrompt?.replace(/\s+/g, ' ').slice(0, 100) ??
    'New conversation'
  )
}

export class TaskLibrary {
  private readonly notified = new Map<string, string | null>()

  constructor(
    private readonly database: AideDatabase,
    private readonly getLiveSnapshots: () => Record<
      string,
      ManagedSessionSnapshot
    >,
  ) {
    for (const item of database.listManagedSessions()) {
      this.notified.set(
        item.config.sessionId,
        getTaskActivity(item.snapshot).activityKey,
      )
    }
  }

  getSnapshot(query = ''): TaskLibrarySnapshot {
    const search = z.string().max(500).parse(query).trim().toLocaleLowerCase()
    const snapshots = new Map(
      this.database
        .listManagedSessions()
        .map((item) => [item.config.sessionId, item.snapshot]),
    )
    for (const snapshot of Object.values(this.getLiveSnapshots()))
      snapshots.set(snapshot.sessionId, snapshot)
    const catalog = this.database.getSnapshot()
    const tasks: SavedTask[] = []
    for (const snapshot of snapshots.values()) {
      const workspace = catalog.workspaces.find(
        (item) => item.id === snapshot.workspaceId,
      )
      const project = catalog.projects.find(
        (item) => item.id === workspace?.projectId,
      )
      if (!workspace || !project) continue
      const metadata = this.database.getTaskMetadata(snapshot.sessionId)
      const title = taskTitle(metadata, snapshot)
      const transcript = taskSearchText(snapshot)
      const haystack =
        `${title}\n${project.name}\n${workspace.name}\n${workspace.branchName}\n${transcript}`.toLocaleLowerCase()
      if (search && !haystack.includes(search)) continue
      const activity = getTaskActivity(snapshot)
      const match = search ? transcript.toLocaleLowerCase().indexOf(search) : -1
      tasks.push({
        ...metadata,
        ...activity,
        sessionId: snapshot.sessionId,
        paneId: snapshot.paneId,
        workspaceId: snapshot.workspaceId,
        projectName: project.name,
        workspaceName: workspace.name,
        branchName: workspace.branchName,
        title,
        updatedAt: snapshot.updatedAt,
        provider: snapshot.provider,
        unread:
          activity.activityKey !== null &&
          activity.activityKey !== metadata.readActivityKey,
        excerpt: transcript.slice(
          Math.max(0, match - 50),
          Math.max(0, match - 50) + 240,
        ),
      })
    }
    tasks.sort(
      (left, right) =>
        Number(right.pinned) - Number(left.pinned) ||
        right.updatedAt.localeCompare(left.updatedAt) ||
        left.sessionId.localeCompare(right.sessionId),
    )
    return {
      tasks,
      notificationsEnabled: this.database.getTaskNotificationsEnabled(),
      notificationSoundsEnabled:
        this.database.getTaskNotificationSoundsEnabled(),
    }
  }

  update(sessionId: string, input: TaskMetadataUpdate): TaskLibrarySnapshot {
    z.string().min(1).max(1024).parse(sessionId)
    const task = this.getSnapshot().tasks.find(
      (item) => item.sessionId === sessionId,
    )
    if (!task) throw new Error('This conversation is no longer available.')
    if (
      input.archived &&
      ['running', 'approval', 'input'].includes(task.status)
    )
      throw new Error('Finish or interrupt this task before archiving it.')
    if (
      input.readActivityKey !== undefined &&
      input.readActivityKey !== null &&
      input.readActivityKey !== task.activityKey
    )
      throw new Error(
        'The task has newer activity. Refresh before marking it read.',
      )
    this.database.updateTaskMetadata(sessionId, input)
    return this.getSnapshot()
  }

  /** The message for new activity on this thread, or null when there is nothing new to tell. */
  nextNotification(snapshot: ManagedSessionSnapshot): TaskNotification | null {
    const activity = getTaskActivity(snapshot)
    const previous = this.notified.get(snapshot.sessionId)
    this.notified.set(snapshot.sessionId, activity.activityKey)
    if (
      !activity.activityKey ||
      activity.activityKey === previous ||
      !this.database.getTaskNotificationsEnabled()
    )
      return null
    const metadata = this.database.getTaskMetadata(snapshot.sessionId)
    if (metadata.archived || metadata.readActivityKey === activity.activityKey)
      return null
    return buildTaskNotification(snapshot, taskTitle(metadata, snapshot))
  }

  /** Live threads blocked on an approval or an answer from you. */
  attentionCount(): number {
    return Object.values(this.getLiveSnapshots()).filter((snapshot) =>
      ['approval', 'input'].includes(getTaskActivity(snapshot).status),
    ).length
  }
}

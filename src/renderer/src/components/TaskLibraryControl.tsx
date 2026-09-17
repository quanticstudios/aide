import { Button, Modal } from '@heroui/react'
import { Bell, History } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'

import type {
  SavedTask,
  TaskLibrarySnapshot,
  TaskMetadataUpdate,
} from '../../../shared/task-library'

const STATUS_LABELS: Record<SavedTask['status'], string> = {
  approval: 'Needs approval',
  input: 'Needs input',
  failed: 'Failed',
  interrupted: 'Interrupted',
  running: 'Working',
  queued: 'Queued',
  paused: 'Queue paused',
  completed: 'Completed',
  idle: 'Ready',
}

export default function TaskLibraryControl({
  onOpenTask,
}: {
  readonly onOpenTask: (task: SavedTask) => Promise<void>
}) {
  const [mode, setMode] = useState<'history' | 'activity' | null>(null)
  const [library, setLibrary] = useState<TaskLibrarySnapshot>({
    tasks: [],
    notificationsEnabled: true,
  })
  const [query, setQuery] = useState('')
  const [matches, setMatches] = useState<SavedTask[] | null>(null)
  const [showArchived, setShowArchived] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [renaming, setRenaming] = useState<string | null>(null)
  const [title, setTitle] = useState('')

  const refresh = useCallback(async () => {
    if (!window.aide) return
    setLibrary(await window.aide.getTaskLibrary())
  }, [])

  useEffect(() => {
    const api = window.aide
    if (!api) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const load = () => {
      void api
        .getTaskLibrary()
        .then((snapshot) => {
          if (!disposed) setLibrary(snapshot)
        })
        .catch(() => {
          if (!disposed) setError('Could not load saved tasks.')
        })
    }
    const unsubscribe = api.onTaskLibraryChanged(() => {
      if (timer) return
      timer = setTimeout(() => {
        timer = undefined
        load()
      }, 200)
    })
    load()
    return () => {
      disposed = true
      clearTimeout(timer)
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!mode || !query.trim()) {
      setMatches(null)
      return
    }
    let disposed = false
    const search = () => {
      void window.aide
        ?.getTaskLibrary(query)
        .then((snapshot) => {
          if (!disposed) setMatches(snapshot.tasks)
        })
        .catch(() => {
          if (!disposed) setError('Could not search saved tasks.')
        })
    }
    let timer = setTimeout(search, 150)
    const unsubscribe = window.aide?.onTaskLibraryChanged(() => {
      clearTimeout(timer)
      timer = setTimeout(search, 150)
    })
    return () => {
      disposed = true
      clearTimeout(timer)
      unsubscribe?.()
    }
  }, [query, mode])

  const openTask = useCallback(
    async (task: SavedTask) => {
      setBusy(true)
      setError(null)
      try {
        await onOpenTask(task)
        await window.aide?.updateTaskMetadata(task.sessionId, {
          readActivityKey: task.activityKey,
          archived: false,
        })
        setMode(null)
        await refresh()
      } catch (failure) {
        setError(
          failure instanceof Error
            ? failure.message
            : 'Could not open the task.',
        )
      } finally {
        setBusy(false)
      }
    },
    [onOpenTask, refresh],
  )

  useEffect(
    () =>
      window.aide?.onTaskOpen((sessionId) => {
        void window.aide
          .getTaskLibrary()
          .then((snapshot) => {
            const task = snapshot.tasks.find(
              (item) => item.sessionId === sessionId,
            )
            if (task) return openTask(task)
            throw new Error('This conversation is no longer available.')
          })
          .catch((failure) => {
            setMode('activity')
            setError(
              failure instanceof Error
                ? failure.message
                : 'Could not open the task.',
            )
          })
      }),
    [openTask],
  )

  async function update(task: SavedTask, input: TaskMetadataUpdate) {
    setBusy(true)
    setError(null)
    try {
      setLibrary(await window.aide.updateTaskMetadata(task.sessionId, input))
      setRenaming(null)
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : 'Could not update the task.',
      )
    } finally {
      setBusy(false)
    }
  }

  const needsAttention = (task: SavedTask) =>
    task.unread ||
    [
      'approval',
      'input',
      'failed',
      'interrupted',
      'running',
      'queued',
      'paused',
    ].includes(task.status)
  const unreadCount = library.tasks.filter(
    (task) => !task.archived && task.unread,
  ).length
  const tasks = (matches ?? library.tasks).filter((task) =>
    mode === 'activity'
      ? !task.archived && needsAttention(task)
      : task.archived === showArchived,
  )

  return (
    <>
      <Button
        aria-label="Open task history"
        isIconOnly
        size="sm"
        variant="ghost"
        onPress={() => {
          setMode('history')
          setQuery('')
          setError(null)
        }}
      >
        <History aria-hidden="true" className="size-4" />
      </Button>
      <Button
        aria-label={`Open activity inbox${unreadCount ? ` (${unreadCount} unread)` : ''}`}
        size="sm"
        variant="ghost"
        onPress={() => {
          setMode('activity')
          setQuery('')
          setError(null)
        }}
      >
        <Bell aria-hidden="true" className="size-4" />
        {unreadCount > 0 ? <span>{unreadCount}</span> : null}
      </Button>
      <Modal>
        <Modal.Backdrop
          isDismissable
          isOpen={mode !== null}
          onOpenChange={(open) => {
            if (!open) setMode(null)
          }}
          variant="opaque"
        >
          <Modal.Container placement="center" size="lg">
            <Modal.Dialog className="rounded-xl border border-border bg-surface text-foreground">
              <Modal.Header>
                <Modal.Heading>
                  {mode === 'activity' ? 'Activity inbox' : 'Task history'}
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body className="text-foreground">
                <div className="flex flex-wrap items-center gap-3">
                  <input
                    aria-label="Search conversations"
                    className="min-w-0 flex-1 rounded border border-border bg-background px-3 py-2 text-sm placeholder:text-muted-foreground"
                    maxLength={500}
                    placeholder="Search messages, projects, or branches"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                  {mode === 'history' ? (
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={showArchived}
                        onChange={(event) =>
                          setShowArchived(event.target.checked)
                        }
                      />
                      Archived
                    </label>
                  ) : null}
                </div>
                {mode === 'activity' ? (
                  <label className="my-3 flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={library.notificationsEnabled}
                      disabled={busy}
                      onChange={(event) => {
                        const notificationsEnabled = event.target.checked
                        setBusy(true)
                        setLibrary((current) => ({
                          ...current,
                          notificationsEnabled,
                        }))
                        void window.aide
                          .setTaskNotifications(notificationsEnabled)
                          .then(setLibrary)
                          .catch(() => {
                            setLibrary((current) => ({
                              ...current,
                              notificationsEnabled: !notificationsEnabled,
                            }))
                            setError('Could not save notification preferences.')
                          })
                          .finally(() => setBusy(false))
                      }}
                    />
                    Notify when Aide is in the background
                  </label>
                ) : null}
                {error ? (
                  <p role="alert" className="my-2 text-sm text-danger">
                    {error}
                  </p>
                ) : null}
                <div
                  className="mt-3 max-h-[55vh] space-y-2 overflow-y-auto"
                  aria-label="Saved tasks"
                >
                  {tasks.length === 0 ? (
                    <p className="py-8 text-center text-sm text-muted-foreground">
                      {query
                        ? 'No matching tasks.'
                        : mode === 'activity'
                          ? 'No tasks need attention.'
                          : showArchived
                            ? 'No archived tasks.'
                            : 'Start a conversation to see it here.'}
                    </p>
                  ) : null}
                  {tasks.map((task) => (
                    <article
                      key={task.sessionId}
                      className="rounded-lg border border-border p-3"
                      data-testid="saved-task"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <button
                          type="button"
                          disabled={busy}
                          className="min-w-0 text-left font-medium hover:underline"
                          onClick={() => void openTask(task)}
                        >
                          {task.pinned ? 'Pinned · ' : ''}
                          {task.title}
                        </button>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {task.unread ? 'Unread · ' : ''}
                          {STATUS_LABELS[task.status]}
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {task.projectName} / {task.workspaceName} ·{' '}
                        {task.branchName} · {task.provider}
                      </p>
                      {query && task.excerpt ? (
                        <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-xs">
                          {task.excerpt}
                        </p>
                      ) : null}
                      {renaming === task.sessionId ? (
                        <form
                          className="mt-2 flex gap-2"
                          onSubmit={(event) => {
                            event.preventDefault()
                            void update(task, { title })
                          }}
                        >
                          <input
                            aria-label="Task title"
                            value={title}
                            maxLength={160}
                            className="min-w-0 flex-1 rounded border border-border bg-background px-2"
                            onChange={(event) => setTitle(event.target.value)}
                          />
                          <Button
                            type="submit"
                            size="sm"
                            isDisabled={busy || !title.trim()}
                          >
                            Save title
                          </Button>
                        </form>
                      ) : null}
                      <div className="mt-2 flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          isDisabled={busy}
                          onPress={() =>
                            void update(task, { pinned: !task.pinned })
                          }
                        >
                          {task.pinned ? 'Unpin' : 'Pin'}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          isDisabled={busy}
                          onPress={() => {
                            setRenaming(task.sessionId)
                            setTitle(task.title)
                          }}
                        >
                          Rename
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          isDisabled={
                            busy ||
                            (!task.archived &&
                              [
                                'running',
                                'approval',
                                'input',
                                'queued',
                                'paused',
                              ].includes(task.status))
                          }
                          onPress={() =>
                            void update(task, { archived: !task.archived })
                          }
                        >
                          {task.archived ? 'Restore' : 'Archive'}
                        </Button>
                        {task.unread ? (
                          <Button
                            size="sm"
                            variant="ghost"
                            isDisabled={busy}
                            onPress={() =>
                              void update(task, {
                                readActivityKey: task.activityKey,
                              })
                            }
                          >
                            Mark read
                          </Button>
                        ) : null}
                      </div>
                    </article>
                  ))}
                </div>
              </Modal.Body>
              <Modal.Footer>
                <Button onPress={() => setMode(null)} variant="secondary">
                  Close
                </Button>
              </Modal.Footer>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </>
  )
}

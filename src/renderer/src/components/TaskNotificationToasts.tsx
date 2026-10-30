import { Toast, toast } from '@heroui/react'
import { useEffect, useRef } from 'react'

import type { TaskNotificationKind } from '../../../shared/task-notification'

// One tone per kind, so you can tell what a thread needs without looking.
const TONE_HZ: Record<TaskNotificationKind, number> = {
  approval: 880,
  input: 784,
  plan: 659,
  completed: 523,
  interrupted: 330,
  'usage-limit': 262,
  failed: 220,
}

function playTone(kind: TaskNotificationKind) {
  const context = new AudioContext()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  oscillator.frequency.value = TONE_HZ[kind]
  gain.gain.setValueAtTime(0.15, context.currentTime)
  gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.3)
  oscillator.connect(gain).connect(context.destination)
  oscillator.onended = () => void context.close()
  oscillator.start()
  oscillator.stop(context.currentTime + 0.3)
}

export default function TaskNotificationToasts({
  activePaneId,
}: {
  readonly activePaneId: string | null
}) {
  const activePaneIdRef = useRef(activePaneId)
  activePaneIdRef.current = activePaneId
  useEffect(
    () =>
      window.aide?.onTaskNotification((notification) => {
        if (notification.sound) playTone(notification.kind)
        // The thread you are looking at already shows what it needs.
        if (
          !notification.toast ||
          notification.paneId === activePaneIdRef.current
        )
          return
        const key = toast(notification.title, {
          description: notification.body,
          variant:
            notification.kind === 'failed' ||
            notification.kind === 'usage-limit'
              ? 'danger'
              : 'default',
          actionProps: {
            children: 'Open',
            onPress: () => {
              toast.close(key)
              void window.aide
                .openTask(notification.sessionId)
                .catch(() =>
                  toast.danger('This conversation is no longer available.'),
                )
            },
          },
        })
      }),
    [],
  )
  return <Toast.Provider />
}

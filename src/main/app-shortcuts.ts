import type { Input } from 'electron'

import {
  type AppShortcutEvent,
  mapShortcutInputToAppEvent,
} from '../shared/shortcuts'

export function mapInputToShortcutEvent(
  input: Pick<Input, 'alt' | 'code' | 'control' | 'key' | 'meta'>,
): AppShortcutEvent | null {
  return mapShortcutInputToAppEvent(input)
}

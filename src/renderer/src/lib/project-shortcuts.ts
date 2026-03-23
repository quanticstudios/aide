import type { ProjectRecord } from '../../../shared/persistence'

export function resolveProjectShortcutTarget(
  projects: readonly ProjectRecord[],
  key: string,
): ProjectRecord | null {
  if (!/^[1-9]$/.test(key)) {
    return null
  }

  const index = Number(key) - 1

  return projects[index] ?? null
}

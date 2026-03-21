import type { ProjectTextFile } from './editor'
import type { RuntimeSnapshot } from './runtime'

export const IPC_CHANNELS = {
  getRuntimeSnapshot: 'app:get-runtime-snapshot',
  readProjectFile: 'editor:read-project-file',
} as const

export interface AideApi {
  getRuntimeSnapshot: () => Promise<RuntimeSnapshot>
  readProjectFile: (relativePath: string) => Promise<ProjectTextFile>
}

import type { RuntimeSnapshot } from './runtime'

export const IPC_CHANNELS = {
  getRuntimeSnapshot: 'app:get-runtime-snapshot',
} as const

export interface AideApi {
  getRuntimeSnapshot: () => Promise<RuntimeSnapshot>
}

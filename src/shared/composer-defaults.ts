import type { ManagedSessionAgentConfig } from './conversation-routing'
import type {
  ManagedSessionEffort,
  ManagedSessionPermissionMode,
} from './managed-session'
import type { ManagedSessionMode } from './terminal'

/** Composer toolbar choices stored per workspace with a global fallback. */
export interface ComposerDefaults {
  readonly agents: readonly ManagedSessionAgentConfig[]
  readonly effort?: ManagedSessionEffort
  readonly model: string
  readonly permissionMode: ManagedSessionPermissionMode
  readonly provider: ManagedSessionMode
  readonly serviceTier: string | null
}

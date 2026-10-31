import { randomUUID } from 'node:crypto'
import { DatabaseSync } from 'node:sqlite'
import { z } from 'zod'
import type { ComposerDefaults } from '../shared/composer-defaults'
import { FleetStateSchema } from '../shared/fleet'
import { JevGateOverridesSchema } from '../shared/jev-gates'

import type { PersistedManagedSession } from '../shared/managed-session'
import type {
  CreateProjectInput,
  CreateWorkspaceInput,
  PersistedLayoutNode,
  PersistenceSnapshot,
  ProjectColor,
  ProjectIcon,
  ProjectRecord,
  SaveWorkspaceLayoutInput,
  SaveWorkspaceSurfaceStateInput,
  SetActiveSelectionInput,
  SurfaceLayoutRecord,
  UpdateProjectInput,
  UpdateWorkspaceInput,
  WorkspaceLayoutRecord,
  WorkspaceRecord,
  WorkspaceSurfaceRecord,
} from '../shared/persistence'
import type { WorkspacePreviewSnapshot } from '../shared/preview'
import {
  cohortForInstallation,
  compareStableSemver,
} from '../shared/release-envelope'
import type { TaskMetadata, TaskMetadataUpdate } from '../shared/task-library'
import type {
  UpdateHealthEvent,
  UpdatePreferencesInput,
  UpdatePreferencesSnapshot,
  UpdateState,
} from '../shared/update'
import {
  coarsenUpdateHealthTimestamp,
  UPDATE_HEALTH_DURATION_BUCKETS_MS,
} from '../shared/update-health'
import type {
  WorkspaceSetupSnapshot,
  WorkspaceSetupStatus,
} from '../shared/workspace-setup'

interface SqlProjectRow {
  color: ProjectColor
  created_at: string
  default_branch: string
  id: string
  icon: ProjectIcon
  kind: ProjectRecord['kind']
  name: string
  remote_url: string | null
  repo_root: string
  setup_command: string | null
  updated_at: string
  worktree_setup_revision: number
}

interface SqlWorkspaceRow {
  archived: number
  branch_name: string
  created_at: string
  id: string
  name: string
  name_source: 'default' | 'generated' | 'manual'
  project_id: string
  sidebar_open: number | null
  updated_at: string
  window_id: string | null
  worktree_path: string
}

interface SqlAppStateRow {
  catalog_revision: number
  last_active_project_id: string | null
  last_active_pane_ids_by_surface: string
  last_active_workspace_ids_by_project: string
  last_active_surface_ids_by_workspace: string
  last_active_pane_ids_by_workspace: string
  last_active_workspace_id: string | null
  workspace_setup_revision: number
}

interface SqlWorkspaceLayoutRow {
  nodes_json: string
  revision: number
  root_node_id: string
  workspace_id: string
}

interface SqlWorkspaceSurfaceStateRow {
  layouts_json: string
  revision: number
  surfaces_json: string
  workspace_id: string
}

interface SqlWorkspacePreviewStateRow {
  active_tab_id: string | null
  initialized: number
  revision: number
  tabs_json: string
  workspace_id: string
}

interface SqlWorkspaceSetupStateRow {
  attempt: number
  ended_at: string | null
  error_summary: string | null
  exit_code: number | null
  output_byte_length: number
  output_line_count: number
  output_tail: string
  output_truncated: number
  project_setup_revision: number
  revision: number
  signal: string | null
  started_at: string | null
  state: WorkspaceSetupStatus
  updated_at: string
  workspace_id: string
}

interface SqlUpdateStateRow {
  automatic_downloads: number
  health_disclosure_acknowledged: number
  health_reporting_enabled: number
  installation_id: string
  last_checked_at: string | null
  pending_attempt_id: string | null
  pending_target_version: string | null
  revision: number
  snoozed_until: string | null
}

interface SqlUpdateHealthEventRow {
  arch: 'arm64' | 'x64'
  attempt_id: string
  cohort: number
  created_at: string
  current_version: string
  duration_ms: number | null
  error_code: UpdateHealthEvent['errorCode']
  lifecycle: UpdateHealthEvent['lifecycle']
  platform: 'darwin' | 'linux'
  target_version: string | null
}

interface SqlQueuedUpdateHealthEventRow extends SqlUpdateHealthEventRow {
  id: number
}

interface SqlManagedSessionRow {
  pane_id: string
  payload_json: string
  session_id: string
  workspace_id: string
}

/** One stored session for pitwall's `import`; `persisted` is null for a row that no longer parses, which never verifies. */
export interface SessionImportCandidate {
  persisted: PersistedManagedSession | null
  sessionId: string
  title: string | null
  updatedAt: string
  /** The `updated_at` pitwall's copy was last verified at, else null. */
  verifiedUpdatedAt: string | null
}

export interface QueuedUpdateHealthEvent {
  event: UpdateHealthEvent
  id: number
}

const MIGRATION_STRATEGY =
  'Ordered SQL migrations tracked with PRAGMA user_version.'

const LEGACY_SURFACE_SUFFIX = ':surface:legacy-root'

const GLOBAL_COMPOSER_DEFAULTS_SCOPE = 'global'
// why: workspace scopes are `workspace:<id>`, so this key never collides with one.
const CODE_WRAP_SCOPE = 'code-wrap'

function composerDefaultsScope(workspaceId: string): string {
  return `workspace:${workspaceId}`
}

function sidebarOpenColumn(
  sidebarOpen: boolean | null | undefined,
): number | null {
  return sidebarOpen == null ? null : sidebarOpen ? 1 : 0
}

const MIGRATIONS = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        repo_root TEXT NOT NULL,
        remote_url TEXT,
        default_branch TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        name TEXT NOT NULL,
        branch_name TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        window_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_workspaces_project_id
      ON workspaces(project_id);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE IF NOT EXISTS app_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_active_project_id TEXT,
        last_active_workspace_id TEXT,
        last_active_workspace_ids_by_project TEXT NOT NULL DEFAULT '{}',
        last_active_pane_ids_by_workspace TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL
      );

      INSERT INTO app_state (id, last_active_project_id, last_active_workspace_id, last_active_workspace_ids_by_project, last_active_pane_ids_by_workspace, updated_at)
      VALUES (1, NULL, NULL, '{}', '{}', CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO NOTHING;
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE app_state ADD COLUMN last_active_workspace_ids_by_project TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE app_state ADD COLUMN last_active_pane_ids_by_workspace TEXT NOT NULL DEFAULT '{}';
    `,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE IF NOT EXISTS workspace_layouts (
        workspace_id TEXT PRIMARY KEY,
        root_node_id TEXT NOT NULL,
        nodes_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
    `,
  },
  {
    version: 5,
    sql: `
      CREATE TABLE IF NOT EXISTS workspace_surface_states (
        workspace_id TEXT PRIMARY KEY,
        surfaces_json TEXT NOT NULL,
        layouts_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );

      ALTER TABLE app_state ADD COLUMN last_active_surface_ids_by_workspace TEXT NOT NULL DEFAULT '{}';
      ALTER TABLE app_state ADD COLUMN last_active_pane_ids_by_surface TEXT NOT NULL DEFAULT '{}';
    `,
  },
  {
    version: 6,
    sql: `
      ALTER TABLE app_state ADD COLUMN catalog_revision INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE workspace_layouts ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE workspace_surface_states ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE IF NOT EXISTS workspace_preview_states (
        workspace_id TEXT PRIMARY KEY,
        active_tab_id TEXT,
        initialized INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL DEFAULT 0,
        tabs_json TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS workspace_activity_visits (
        workspace_id TEXT PRIMARY KEY,
        processed_through TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
    `,
  },
  {
    version: 7,
    sql: `
      ALTER TABLE projects ADD COLUMN setup_command TEXT;
      ALTER TABLE projects ADD COLUMN worktree_setup_revision INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE app_state ADD COLUMN workspace_setup_revision INTEGER NOT NULL DEFAULT 0;

      CREATE TABLE IF NOT EXISTS workspace_setup_states (
        workspace_id TEXT PRIMARY KEY,
        state TEXT NOT NULL,
        attempt INTEGER NOT NULL DEFAULT 0,
        project_setup_revision INTEGER NOT NULL DEFAULT 0,
        started_at TEXT,
        ended_at TEXT,
        exit_code INTEGER,
        signal TEXT,
        error_summary TEXT,
        output_tail TEXT NOT NULL DEFAULT '',
        output_byte_length INTEGER NOT NULL DEFAULT 0,
        output_line_count INTEGER NOT NULL DEFAULT 0,
        output_truncated INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );
    `,
  },
  {
    version: 8,
    sql: `
      CREATE TABLE IF NOT EXISTS app_update_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        installation_id TEXT NOT NULL,
        automatic_downloads INTEGER NOT NULL DEFAULT 1 CHECK (automatic_downloads IN (0, 1)),
        health_reporting_enabled INTEGER NOT NULL DEFAULT 1 CHECK (health_reporting_enabled IN (0, 1)),
        health_disclosure_acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (health_disclosure_acknowledged IN (0, 1)),
        snoozed_until TEXT,
        last_checked_at TEXT,
        pending_target_version TEXT,
        pending_attempt_id TEXT,
        revision INTEGER NOT NULL DEFAULT 0,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS app_update_health_queue (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        attempt_id TEXT NOT NULL,
        current_version TEXT NOT NULL,
        target_version TEXT,
        platform TEXT NOT NULL CHECK (platform IN ('darwin', 'linux')),
        arch TEXT NOT NULL CHECK (arch IN ('arm64', 'x64')),
        cohort INTEGER NOT NULL CHECK (cohort >= 0 AND cohort < 100),
        lifecycle TEXT NOT NULL CHECK (lifecycle IN ('check-failed', 'check-started', 'downloaded', 'download-failed', 'download-started', 'install-failed', 'install-started', 'install-succeeded')),
        error_code TEXT,
        created_at TEXT NOT NULL,
        duration_ms INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_app_update_health_queue_created_at
      ON app_update_health_queue(created_at);
    `,
  },
  {
    version: 9,
    sql: `
      CREATE TABLE IF NOT EXISTS managed_session_snapshots (
        session_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        pane_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_managed_session_snapshots_workspace_pane
      ON managed_session_snapshots(workspace_id, pane_id);
    `,
  },
  {
    version: 10,
    sql: `
      CREATE TABLE IF NOT EXISTS managed_task_metadata (
        session_id TEXT PRIMARY KEY,
        title TEXT,
        pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
        archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        read_activity_key TEXT
      );
      CREATE TABLE IF NOT EXISTS task_notification_preferences (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        enabled INTEGER NOT NULL CHECK (enabled IN (0, 1))
      );
      INSERT OR IGNORE INTO task_notification_preferences (id, enabled) VALUES (1, 1);
    `,
  },
  {
    version: 11,
    sql: `
      ALTER TABLE projects ADD COLUMN kind TEXT NOT NULL DEFAULT 'git'
      CHECK (kind IN ('git', 'folder'));
    `,
  },
  {
    version: 12,
    sql: `
      ALTER TABLE workspaces ADD COLUMN name_source TEXT NOT NULL DEFAULT 'default'
      CHECK (name_source IN ('default', 'generated', 'manual'));
      UPDATE workspaces
      SET name_source = 'manual'
      WHERE branch_name <> '' AND name <> branch_name;
    `,
  },
  {
    version: 13,
    sql: `
      ALTER TABLE projects ADD COLUMN icon TEXT NOT NULL DEFAULT 'folder'
      CHECK (icon IN ('folder', 'code', 'layers', 'sparkles'));
      ALTER TABLE projects ADD COLUMN color TEXT NOT NULL DEFAULT 'neutral'
      CHECK (color IN ('neutral', 'blue', 'violet', 'green', 'amber'));
    `,
  },
  {
    version: 14,
    sql: `
      BEGIN IMMEDIATE;
      ALTER TABLE projects ADD COLUMN lucide_icon TEXT NOT NULL DEFAULT 'folder';
      ALTER TABLE projects ADD COLUMN palette_color TEXT NOT NULL DEFAULT 'neutral';
      UPDATE projects SET lucide_icon = CASE icon
        WHEN 'code' THEN 'code-xml'
        WHEN 'layers' THEN 'layers-3'
        ELSE icon END, palette_color = color;
      ALTER TABLE projects DROP COLUMN icon;
      ALTER TABLE projects DROP COLUMN color;
      ALTER TABLE projects RENAME COLUMN lucide_icon TO icon;
      ALTER TABLE projects RENAME COLUMN palette_color TO color;
      PRAGMA user_version = 14;
      COMMIT;
    `,
  },
  {
    version: 15,
    sql: `
      CREATE TABLE IF NOT EXISTS composer_defaults (
        scope TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL
      );
    `,
  },
  {
    version: 16,
    sql: `
      ALTER TABLE workspaces ADD COLUMN sidebar_open INTEGER
      CHECK (sidebar_open IN (0, 1));
    `,
  },
  {
    version: 17,
    sql: `
      ALTER TABLE workspaces ADD COLUMN archived INTEGER NOT NULL DEFAULT 0
      CHECK (archived IN (0, 1));
    `,
  },
  {
    version: 18,
    sql: `
      ALTER TABLE task_notification_preferences ADD COLUMN sounds INTEGER NOT NULL DEFAULT 0
      CHECK (sounds IN (0, 1));
    `,
  },
  {
    version: 19,
    // why: proof that pitwall holds each session as stored at updated_at, so the session tables drop only once every row has it.
    sql: `
      CREATE TABLE IF NOT EXISTS session_imports (
        session_id TEXT PRIMARY KEY,
        updated_at TEXT NOT NULL,
        app_version TEXT NOT NULL,
        verified_at TEXT NOT NULL
      );
    `,
  },
]

/** The tables pitwall's daemon replaces; they drop after a verified import (ENG-2707). */
const SESSION_TABLES = ['managed_session_snapshots', 'managed_task_metadata']

const UPDATE_HEALTH_QUEUE_LIMIT = 100
const UPDATE_HEALTH_TTL_MS = 30 * 24 * 60 * 60 * 1_000
const STABLE_SEMVER = /^(0|[1-9]\d{0,9})\.(0|[1-9]\d{0,9})\.(0|[1-9]\d{0,9})$/
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const UPDATE_HEALTH_LIFECYCLES = new Set<UpdateHealthEvent['lifecycle']>([
  'check-failed',
  'check-started',
  'downloaded',
  'download-failed',
  'download-started',
  'install-failed',
  'install-started',
  'install-succeeded',
])
const UPDATE_ERROR_CODES = new Set<UpdateHealthEvent['errorCode']>([
  'disk-space',
  'invalid-update',
  'network',
  'unknown',
  null,
])
const UPDATE_HEALTH_DURATION_BUCKETS = new Set<number>(
  UPDATE_HEALTH_DURATION_BUCKETS_MS,
)
const COARSE_UPDATE_HEALTH_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/

const persistedIdentifier = z.string().min(1).max(200)
const persistedText = z.string().max(1_000_000)
const persistedTimestamp = z.string().min(1).max(64)
const persistedProvider = z.enum(['claude', 'codex'])
const persistedNullableNumber = z.number().finite().nonnegative().nullable()
const persistedProviderSelection = z.object({
  effort: z.string().max(200).optional(),
  mode: persistedProvider,
  model: z.string().max(200).optional(),
  serviceTier: z.string().max(200).nullable().optional(),
})
const persistedAgentConfig = z.object({
  alias: z
    .string()
    .regex(/^[A-Za-z][A-Za-z0-9_-]*$/)
    .max(200),
  selection: persistedProviderSelection,
})
const persistedComposerDefaults = z.object({
  agents: z.array(persistedAgentConfig).max(8),
  effort: z.string().max(200).optional(),
  model: z.string().min(1).max(200),
  permissionMode: z.enum([
    'acceptEdits',
    'bypassPermissions',
    'default',
    'plan',
  ]),
  provider: persistedProvider,
  serviceTier: z.string().max(200).nullable(),
})
const persistedUsageModel = z.object({
  cachedInputTokens: persistedNullableNumber,
  cacheCreationInputTokens: persistedNullableNumber,
  estimatedCostUsd: persistedNullableNumber,
  inputTokens: z.number().finite().nonnegative(),
  model: z.string().max(200).nullable(),
  outputTokens: z.number().finite().nonnegative(),
})
const persistedManagedAttachment = z.discriminatedUnion('kind', [
  z.object({
    data: z.string().max(7_000_000),
    id: persistedIdentifier,
    kind: z.literal('image'),
    mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp']),
    name: z.string().min(1).max(255),
    sizeBytes: z
      .number()
      .int()
      .positive()
      .max(5 * 1024 * 1024),
  }),
  z.object({
    id: persistedIdentifier,
    kind: z.literal('pasted-text'),
    name: z.string().min(1).max(255),
    text: z
      .string()
      .min(1)
      .max(256 * 1024),
  }),
  z.object({
    id: persistedIdentifier,
    kind: z.literal('workspace-file'),
    path: z.string().min(1).max(4_096),
  }),
])
const persistedToolCall = z.object({
  callId: persistedIdentifier,
  command: persistedText.optional(),
  diff: persistedText.optional(),
  endedAt: persistedTimestamp.optional(),
  exitCode: z.number().finite().int().optional(),
  files: z
    .array(
      z.object({
        path: z.string().min(1).max(4_096),
        status: z.string().max(200),
      }),
    )
    .max(200)
    .optional(),
  input: z.unknown(),
  output: persistedText.optional(),
  progress: z.string().max(500).optional(),
  startedAt: persistedTimestamp.optional(),
  status: z.enum(['running', 'completed', 'failed']),
  subagentTools: z.array(z.string().min(1).max(200)).max(1_000).optional(),
  tasks: z
    .array(
      z.object({
        status: z.enum(['pending', 'in_progress', 'completed']),
        subject: z.string().min(1).max(500),
      }),
    )
    .max(100)
    .optional(),
  toolName: z.string().min(1).max(200),
})
const persistedManagedSessionSchema = z
  .object({
    config: z.object({
      agents: z.array(persistedAgentConfig).optional(),
      contextWindow: z.enum(['200k', '1m']).optional(),
      cwd: persistedText,
      effort: z.string().max(200).optional(),
      interactionMode: z.enum(['build', 'plan']).optional(),
      jevGates: JevGateOverridesSchema.optional(),
      mode: persistedProvider,
      model: z.string().max(200).optional(),
      orchestratorSelection: persistedProviderSelection.optional(),
      paneId: persistedIdentifier,
      permissionMode: z
        .enum(['acceptEdits', 'bypassPermissions', 'default', 'plan'])
        .optional(),
      selectionNotice: z.string().max(2_000).nullable().optional(),
      serviceTier: z.string().max(200).nullable().optional(),
      sessionId: persistedIdentifier,
      thinkingBudget: z.enum(['default', 'extra', 'ultra']).optional(),
      workspaceId: persistedIdentifier,
    }),
    snapshot: z.object({
      pendingProviderSelection: persistedProviderSelection.optional(),
      content: z.array(
        z.object({
          attachments: z.array(persistedManagedAttachment).max(8).optional(),
          createdAt: persistedTimestamp.optional(),
          id: persistedIdentifier,
          kind: z.enum([
            'assistant-text',
            'reasoning-text',
            'reasoning-summary-text',
            'command-output',
            'file-change-output',
            'system',
            'tool-call',
            'user-prompt',
          ]),
          model: z.string().max(200).nullable().optional(),
          phase: z.enum(['commentary', 'final_answer']).optional(),
          provider: persistedProvider.nullable(),
          text: persistedText,
          tool: persistedToolCall.optional(),
          turnId: persistedIdentifier.nullable(),
          updatedAt: persistedTimestamp,
        }),
      ),
      detail: z.string().max(2_000).nullable(),
      fleet: FleetStateSchema.optional(),
      jevGates: JevGateOverridesSchema.optional(),
      effort: z.string().max(200).nullable(),
      interactionMode: z.enum(['build', 'plan']),
      lastCompletedAt: persistedTimestamp.nullable(),
      lastError: z.string().max(2_000).nullable(),
      lastErrorAt: persistedTimestamp.nullable(),
      model: z.string().max(200).nullable(),
      orchestratorSelection: persistedProviderSelection.optional(),
      paneId: persistedIdentifier,
      pendingApprovals: z.array(
        z.object({
          detail: z.string().max(2_000).nullable(),
          id: persistedIdentifier,
          requestType: z.enum([
            'command-execution-approval',
            'file-change-approval',
            'file-read-approval',
            'plan-approval',
            'dynamic-tool-call',
            'tool-user-input',
            'unknown',
          ]),
        }),
      ),
      pendingUserInputs: z.array(
        z.object({
          detail: z.string().max(2_000).nullable(),
          id: persistedIdentifier,
          questions: z.array(
            z.object({
              header: z.string().max(200).optional(),
              id: persistedIdentifier,
              options: z.array(
                z.object({
                  description: z.string().max(2_000).optional(),
                  id: persistedIdentifier,
                  label: z.string().min(1).max(200),
                }),
              ),
              prompt: persistedText,
            }),
          ),
        }),
      ),
      permissionMode: z
        .enum(['acceptEdits', 'bypassPermissions', 'default', 'plan'])
        .default('default'),
      planApproval: z
        .object({
          detail: z.string().max(2_000).nullable(),
          id: persistedIdentifier,
        })
        .nullable(),
      provider: persistedProvider,
      // why: the queue lives in memory, so messages still queued when the session ends load back as visible notes.
      queuedInputs: z
        .array(
          z.object({
            createdAt: persistedTimestamp,
            id: persistedIdentifier,
            text: z.string().min(1).max(65_536),
          }),
        )
        .optional(),
      revision: z.number().finite().int().nonnegative(),
      running: z.boolean(),
      runtimeGeneration: z.number().finite().int().positive(),
      selectionNotice: z.string().max(2_000).nullable(),
      serviceTier: z.string().max(200).nullable(),
      sessionId: persistedIdentifier,
      sessionState: z.enum([
        'connecting',
        'ready',
        'running',
        'waiting',
        'stopped',
        'error',
      ]),
      turns: z.array(
        z.object({
          checkpointId: persistedIdentifier.optional(),
          completedAt: persistedTimestamp.nullable(),
          id: persistedIdentifier,
          provider: persistedProvider,
          startedAt: persistedTimestamp,
          recipientAlias: z.string().max(64).optional(),
          requestText: z.string().max(65_536).optional(),
          state: z.enum([
            'running',
            'completed',
            'failed',
            'cancelled',
            'interrupted',
          ]),
        }),
      ),
      updatedAt: persistedTimestamp,
      workspaceId: persistedIdentifier,
      usage: z
        .object({
          cachedInputTokens: z.number().finite().nonnegative().optional(),
          contextTokens: z.number().finite().nonnegative().optional(),
          inputTokens: z.number().finite().nonnegative(),
          maxTokens: z.number().finite().nonnegative().optional(),
          outputTokens: z.number().finite().nonnegative(),
        })
        .optional(),
      usageReports: z
        .array(
          z.object({
            createdAt: persistedTimestamp,
            estimatedCostUsd: persistedNullableNumber,
            id: persistedIdentifier,
            models: z.array(persistedUsageModel),
            provider: z.enum(['claude', 'codex', 'jev']),
            runtimeGeneration: z.number().finite().int().positive(),
            scopeId: persistedIdentifier,
            turnId: persistedIdentifier.nullable(),
          }),
        )
        .optional(),
    }),
  })
  .superRefine((persisted, context) => {
    if (
      persisted.config.mode !== persisted.snapshot.provider ||
      persisted.config.sessionId !== persisted.snapshot.sessionId ||
      persisted.config.workspaceId !== persisted.snapshot.workspaceId ||
      persisted.config.paneId !== persisted.snapshot.paneId
    ) {
      context.addIssue({
        code: 'custom',
        message: 'Managed session identity mismatch.',
      })
    }
  })

export const AIDE_DATABASE_SCHEMA_VERSION =
  MIGRATIONS[MIGRATIONS.length - 1].version

export function createAideDatabase(databasePath: string): AideDatabase {
  return new AideDatabase(databasePath)
}

export class AideDatabase {
  private readonly database: DatabaseSync

  public constructor(private readonly databasePath: string) {
    this.database = new DatabaseSync(databasePath)
    try {
      this.database.exec('PRAGMA foreign_keys = ON;')
      this.runMigrations()
      this.ensureUpdateState()
      this.discardUpdateHealthEventsIfNotPermitted()
    } catch (error) {
      this.database.close()
      throw error
    }
  }

  public close(): void {
    this.database.close()
  }

  /**
   * Returns the only durable OTA preferences record. It intentionally exposes
   * no release URLs, downloader paths, headers, transport errors, or payloads.
   */
  public getUpdateState(): UpdateState {
    this.ensureUpdateState()
    const row = this.database
      .prepare(
        `
          SELECT installation_id, automatic_downloads, health_reporting_enabled,
                 health_disclosure_acknowledged, snoozed_until, last_checked_at,
                 pending_target_version, pending_attempt_id, revision
          FROM app_update_state
          WHERE id = 1
        `,
      )
      .get() as SqlUpdateStateRow | undefined

    if (!row) {
      throw new Error('Update state could not be initialized.')
    }
    return this.mapUpdateStateRow(row)
  }

  public getUpdatePreferences(): UpdatePreferencesSnapshot {
    const row = this.database
      .prepare(
        `
          SELECT automatic_downloads, health_reporting_enabled,
                 health_disclosure_acknowledged, snoozed_until, revision
          FROM app_update_state
          WHERE id = 1
        `,
      )
      .get() as
      | Pick<
          SqlUpdateStateRow,
          | 'automatic_downloads'
          | 'health_disclosure_acknowledged'
          | 'health_reporting_enabled'
          | 'revision'
          | 'snoozed_until'
        >
      | undefined
    if (!row) throw new Error('Update preferences could not be initialized.')
    return {
      automaticDownloads: row.automatic_downloads === 1,
      healthDisclosureAcknowledged: row.health_disclosure_acknowledged === 1,
      healthReportingEnabled: row.health_reporting_enabled === 1,
      revision: row.revision,
      snoozedUntil: row.snoozed_until,
    }
  }

  public updateUpdatePreferences(
    input: UpdatePreferencesInput,
  ): UpdatePreferencesSnapshot {
    this.updateUpdateState(input)
    return this.getUpdatePreferences()
  }

  /** Atomically updates the singleton while preserving its cohort identity. */
  public updateUpdateState(
    input: Partial<Omit<UpdateState, 'installationId'>>,
  ): UpdateState {
    const current = this.getUpdateState()
    const next: UpdateState = {
      automaticDownloads:
        input.automaticDownloads ?? current.automaticDownloads,
      healthDisclosureAcknowledged:
        input.healthDisclosureAcknowledged ??
        current.healthDisclosureAcknowledged,
      healthReportingEnabled:
        input.healthReportingEnabled ?? current.healthReportingEnabled,
      installationId: current.installationId,
      lastCheckedAt: this.requireNullableIsoTimestamp(
        this.pickUpdateStateValue(
          input,
          'lastCheckedAt',
          current.lastCheckedAt,
        ),
        'last checked time',
      ),
      pendingAttemptId: this.requireNullableIdentifier(
        this.pickUpdateStateValue(
          input,
          'pendingAttemptId',
          current.pendingAttemptId,
        ),
        'pending attempt id',
      ),
      pendingTargetVersion: this.requireNullableSemver(
        this.pickUpdateStateValue(
          input,
          'pendingTargetVersion',
          current.pendingTargetVersion,
        ),
        'pending target version',
      ),
      snoozedUntil: this.requireNullableIsoTimestamp(
        this.pickUpdateStateValue(input, 'snoozedUntil', current.snoozedUntil),
        'snoozed until',
      ),
    }

    this.database.exec('BEGIN IMMEDIATE;')
    try {
      this.database
        .prepare(
          `
            UPDATE app_update_state
            SET automatic_downloads = ?, health_reporting_enabled = ?,
                health_disclosure_acknowledged = ?, snoozed_until = ?,
                last_checked_at = ?, pending_target_version = ?,
                pending_attempt_id = ?, revision = revision + 1, updated_at = ?
            WHERE id = 1
          `,
        )
        .run(
          next.automaticDownloads ? 1 : 0,
          next.healthReportingEnabled ? 1 : 0,
          next.healthDisclosureAcknowledged ? 1 : 0,
          next.snoozedUntil,
          next.lastCheckedAt,
          next.pendingTargetVersion,
          next.pendingAttemptId,
          new Date().toISOString(),
        )

      if (!this.canCollectUpdateHealth(next)) {
        this.database.exec('DELETE FROM app_update_health_queue;')
      }
      this.database.exec('COMMIT;')
    } catch (error) {
      this.database.exec('ROLLBACK;')
      throw error
    }
    return this.getUpdateState()
  }

  /**
   * Adds only the fixed, non-identifying OTA health schema. Cleanup and the
   * insertion happen inside one SQLite transaction so a crash cannot leave an
   * over-capacity queue behind.
   */
  public appendUpdateHealthEvent(event: UpdateHealthEvent): void {
    const state = this.getUpdateState()
    if (!this.canCollectUpdateHealth(state)) {
      this.database.exec('DELETE FROM app_update_health_queue;')
      return
    }
    const sanitized = this.normalizeUpdateHealthEvent(event)
    const cutoff = new Date(
      new Date(sanitized.createdAt).getTime() - UPDATE_HEALTH_TTL_MS,
    ).toISOString()

    this.database.exec('BEGIN IMMEDIATE;')
    try {
      this.database
        .prepare(
          `
            INSERT INTO app_update_health_queue (
              attempt_id, current_version, target_version, platform, arch,
              cohort, lifecycle, error_code, created_at, duration_ms
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          sanitized.attemptId,
          sanitized.currentVersion,
          sanitized.targetVersion,
          sanitized.platform,
          sanitized.arch,
          sanitized.cohort,
          sanitized.lifecycle,
          sanitized.errorCode,
          sanitized.createdAt,
          sanitized.durationMs,
        )
      this.database
        .prepare('DELETE FROM app_update_health_queue WHERE created_at < ?')
        .run(cutoff)
      this.database.exec(`
        DELETE FROM app_update_health_queue
        WHERE id NOT IN (
          SELECT id FROM app_update_health_queue
          ORDER BY id DESC
          LIMIT ${UPDATE_HEALTH_QUEUE_LIMIT}
        );
      `)
      this.database.exec('COMMIT;')
    } catch (error) {
      this.database.exec('ROLLBACK;')
      throw error
    }
  }

  public listUpdateHealthEvents(
    now = new Date().toISOString(),
  ): UpdateHealthEvent[] {
    if (!this.canCollectUpdateHealth(this.getUpdateState())) {
      this.database.exec('DELETE FROM app_update_health_queue;')
      return []
    }
    const checkedNow = this.requireNullableIsoTimestamp(now, 'current time')
    if (!checkedNow) throw new Error('Current time is required.')
    const cutoff = new Date(
      new Date(checkedNow).getTime() - UPDATE_HEALTH_TTL_MS,
    ).toISOString()
    this.database
      .prepare('DELETE FROM app_update_health_queue WHERE created_at < ?')
      .run(cutoff)
    const rows = this.database
      .prepare(
        `
          SELECT attempt_id, current_version, target_version, platform, arch,
                 cohort, lifecycle, error_code, created_at, duration_ms
          FROM app_update_health_queue
          ORDER BY id ASC
        `,
      )
      .all() as unknown as SqlUpdateHealthEventRow[]
    return rows.map((row) => this.mapUpdateHealthEventRow(row))
  }

  /** Main-process-only queue records; SQLite IDs never cross the IPC boundary. */
  public listQueuedUpdateHealthEvents(
    limit: number,
    now = new Date().toISOString(),
  ): QueuedUpdateHealthEvent[] {
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 20) {
      throw new Error('Invalid update health queue limit.')
    }
    if (!this.canCollectUpdateHealth(this.getUpdateState())) {
      this.database.exec('DELETE FROM app_update_health_queue;')
      return []
    }
    const checkedNow = this.requireNullableIsoTimestamp(now, 'current time')
    if (!checkedNow) throw new Error('Current time is required.')
    this.deleteExpiredUpdateHealthEvents(checkedNow)
    const rows = this.database
      .prepare(
        `
          SELECT id, attempt_id, current_version, target_version, platform, arch,
                 cohort, lifecycle, error_code, created_at, duration_ms
          FROM app_update_health_queue
          ORDER BY id ASC
          LIMIT ?
        `,
      )
      .all(limit) as unknown as SqlQueuedUpdateHealthEventRow[]
    return rows.map((row) => ({
      event: this.mapUpdateHealthEventRow(row),
      id: row.id,
    }))
  }

  /** Deletes only an acknowledged main-process batch, inside one transaction. */
  public acknowledgeUpdateHealthEvents(ids: readonly number[]): void {
    if (
      ids.length === 0 ||
      ids.length > 20 ||
      ids.some((id) => !Number.isSafeInteger(id) || id < 1)
    ) {
      throw new Error('Invalid update health acknowledgement.')
    }
    const unique = [...new Set(ids)]
    this.database.exec('BEGIN IMMEDIATE;')
    try {
      this.database
        .prepare(
          `DELETE FROM app_update_health_queue WHERE id IN (${unique.map(() => '?').join(', ')})`,
        )
        .run(...unique)
      this.database.exec('COMMIT;')
    } catch (error) {
      this.database.exec('ROLLBACK;')
      throw error
    }
  }

  /** Atomically records the only restart marker eligible for post-update reconciliation. */
  public commitUpdateInstallStart(input: {
    arch: 'arm64' | 'x64'
    attemptId: string
    currentVersion: string
    now: string
    platform: 'darwin' | 'linux'
    targetVersion: string
  }): UpdateState {
    const state = this.getUpdateState()
    const attemptId = this.requireNullableIdentifier(
      input.attemptId,
      'install attempt id',
    )
    const targetVersion = this.requireNullableSemver(
      input.targetVersion,
      'install target version',
    )
    const now = this.requireNullableIsoTimestamp(input.now, 'current time')
    if (
      !attemptId ||
      !targetVersion ||
      !now ||
      !STABLE_SEMVER.test(input.currentVersion)
    ) {
      throw new Error('Invalid update install marker.')
    }

    this.database.exec('BEGIN IMMEDIATE;')
    try {
      this.database
        .prepare(
          `
            UPDATE app_update_state
            SET pending_target_version = ?, pending_attempt_id = ?, updated_at = ?
            WHERE id = 1
          `,
        )
        .run(targetVersion, attemptId, now)
      this.database.exec('COMMIT;')
    } catch (error) {
      this.database.exec('ROLLBACK;')
      throw error
    }

    if (this.canCollectUpdateHealth(state)) {
      this.tryAppendUpdateHealthEvent({
        arch: input.arch,
        attemptId,
        cohort: cohortForInstallation(state.installationId, targetVersion),
        createdAt: coarsenUpdateHealthTimestamp(now),
        currentVersion: input.currentVersion,
        durationMs: null,
        errorCode: null,
        lifecycle: 'install-started',
        platform: input.platform,
        targetVersion,
      })
    }
    return this.getUpdateState()
  }

  /**
   * Resolves the sole durable install marker after a new app process starts.
   * Only an install that was committed immediately before shutdown has both
   * fields, so ordinary closes with an available/downloaded update never create
   * a misleading terminal health event.
   */
  public reconcilePendingUpdateInstall(input: {
    arch: 'arm64' | 'x64'
    currentVersion: string
    now: string
    platform: 'darwin' | 'linux'
  }): UpdateHealthEvent | null {
    if (!STABLE_SEMVER.test(input.currentVersion)) {
      throw new Error('Invalid installed version.')
    }
    const now = this.requireNullableIsoTimestamp(input.now, 'current time')
    if (!now) throw new Error('Current time is required.')
    const current = this.getUpdateState()
    const targetVersion = current.pendingTargetVersion
    const attemptId = current.pendingAttemptId

    if (!targetVersion || !attemptId) {
      if (targetVersion || attemptId) {
        this.updateUpdateState({
          pendingAttemptId: null,
          pendingTargetVersion: null,
        })
      }
      return null
    }

    const event: UpdateHealthEvent = {
      arch: input.arch,
      attemptId,
      cohort: cohortForInstallation(current.installationId, targetVersion),
      createdAt: coarsenUpdateHealthTimestamp(now),
      currentVersion: input.currentVersion,
      durationMs: null,
      errorCode: null,
      lifecycle:
        compareStableSemver(input.currentVersion, targetVersion) >= 0
          ? 'install-succeeded'
          : 'install-failed',
      platform: input.platform,
      targetVersion,
    }

    this.database.exec('BEGIN IMMEDIATE;')
    try {
      this.database
        .prepare(
          `
            UPDATE app_update_state
            SET pending_target_version = NULL, pending_attempt_id = NULL,
                updated_at = ?
            WHERE id = 1
          `,
        )
        .run(now)
      this.database.exec('COMMIT;')
    } catch (error) {
      this.database.exec('ROLLBACK;')
      throw error
    }
    return this.canCollectUpdateHealth(current) &&
      this.tryAppendUpdateHealthEvent(event)
      ? event
      : null
  }

  public getWorkspaceActivityVisitWatermarks(): Record<string, string> {
    const rows = this.database
      .prepare(
        `
          SELECT workspace_id, processed_through
          FROM workspace_activity_visits
        `,
      )
      .all() as unknown as Array<{
      processed_through: string
      workspace_id: string
    }>

    return Object.fromEntries(
      rows.map((row) => [row.workspace_id, row.processed_through]),
    )
  }

  public setWorkspaceActivityVisitWatermark(
    workspaceId: string,
    processedThrough: string,
  ): void {
    this.database
      .prepare(
        `
          INSERT INTO workspace_activity_visits (workspace_id, processed_through)
          VALUES (?, ?)
          ON CONFLICT(workspace_id) DO UPDATE SET processed_through = excluded.processed_through
        `,
      )
      .run(workspaceId, processedThrough)
  }

  public getWorkspaceSetupRevision(): number {
    const row = this.database
      .prepare('SELECT workspace_setup_revision FROM app_state WHERE id = 1')
      .get() as Pick<SqlAppStateRow, 'workspace_setup_revision'> | undefined

    return row?.workspace_setup_revision ?? 0
  }

  public getWorkspaceSetupState(
    workspaceId: string,
  ): WorkspaceSetupSnapshot | null {
    const row = this.database
      .prepare(
        `
          SELECT workspace_id, state, attempt, project_setup_revision, started_at,
                 ended_at, exit_code, signal, error_summary, output_tail,
                 output_byte_length, output_line_count, output_truncated,
                 revision, updated_at
          FROM workspace_setup_states
          WHERE workspace_id = ?
        `,
      )
      .get(workspaceId) as SqlWorkspaceSetupStateRow | undefined

    return row ? this.mapWorkspaceSetupStateRow(row) : null
  }

  public getWorkspaceSetupStates(): Record<string, WorkspaceSetupSnapshot> {
    const rows = this.database
      .prepare(
        `
          SELECT workspace_id, state, attempt, project_setup_revision, started_at,
                 ended_at, exit_code, signal, error_summary, output_tail,
                 output_byte_length, output_line_count, output_truncated,
                 revision, updated_at
          FROM workspace_setup_states
          ORDER BY workspace_id ASC
        `,
      )
      .all() as unknown as SqlWorkspaceSetupStateRow[]

    return Object.fromEntries(
      rows.map((row) => {
        const snapshot = this.mapWorkspaceSetupStateRow(row)
        return [snapshot.workspaceId, snapshot]
      }),
    )
  }

  public saveWorkspaceSetupState(
    input: WorkspaceSetupSnapshot,
  ): WorkspaceSetupSnapshot | null {
    if (!this.getWorkspace(input.workspaceId)) {
      return null
    }

    const revision = this.incrementWorkspaceSetupRevision()
    const updatedAt = new Date().toISOString()

    this.database
      .prepare(
        `
          INSERT INTO workspace_setup_states (
            workspace_id, state, attempt, project_setup_revision, started_at,
            ended_at, exit_code, signal, error_summary, output_tail,
            output_byte_length, output_line_count, output_truncated, revision,
            updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(workspace_id) DO UPDATE SET
            state = excluded.state,
            attempt = excluded.attempt,
            project_setup_revision = excluded.project_setup_revision,
            started_at = excluded.started_at,
            ended_at = excluded.ended_at,
            exit_code = excluded.exit_code,
            signal = excluded.signal,
            error_summary = excluded.error_summary,
            output_tail = excluded.output_tail,
            output_byte_length = excluded.output_byte_length,
            output_line_count = excluded.output_line_count,
            output_truncated = excluded.output_truncated,
            revision = excluded.revision,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        input.workspaceId,
        input.state,
        input.attempt,
        input.projectSetupRevision,
        input.startedAt,
        input.endedAt,
        input.exitCode,
        input.signal,
        input.errorSummary,
        input.outputTail,
        input.outputByteLength,
        input.outputLineCount,
        input.outputTruncated ? 1 : 0,
        revision,
        updatedAt,
      )

    return this.getWorkspaceSetupState(input.workspaceId)
  }

  public reconcileInterruptedWorkspaceSetups(): WorkspaceSetupSnapshot[] {
    const running = Object.values(this.getWorkspaceSetupStates()).filter(
      (setup) => setup.state === 'queued' || setup.state === 'running',
    )

    return running.flatMap((setup) => {
      const updated = this.saveWorkspaceSetupState({
        ...setup,
        endedAt: new Date().toISOString(),
        errorSummary: 'Setup was interrupted when Aide closed.',
        state: 'failed',
      })
      return updated ? [updated] : []
    })
  }

  public saveManagedSession(
    persisted: PersistedManagedSession,
  ): PersistedManagedSession | null {
    const normalized = this.normalizeManagedSession(persisted)

    if (!this.getWorkspace(normalized.config.workspaceId)) {
      return null
    }

    this.ensureSessionTables()
    this.database
      .prepare(
        `
          INSERT INTO managed_session_snapshots (
            session_id, workspace_id, pane_id, payload_json, updated_at
          ) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET
            workspace_id = excluded.workspace_id,
            pane_id = excluded.pane_id,
            payload_json = excluded.payload_json,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        normalized.config.sessionId,
        normalized.config.workspaceId,
        normalized.config.paneId,
        JSON.stringify(normalized),
        normalized.snapshot.updatedAt,
      )

    return normalized
  }

  public getTaskMetadata(sessionId: string): TaskMetadata {
    const row = !this.hasSessionTables()
      ? undefined
      : this.database
          .prepare(
            'SELECT title, pinned, archived, read_activity_key FROM managed_task_metadata WHERE session_id = ?',
          )
          .get(sessionId)
    return {
      title: typeof row?.title === 'string' ? row.title : null,
      pinned: row?.pinned === 1,
      archived: row?.archived === 1,
      readActivityKey:
        typeof row?.read_activity_key === 'string'
          ? row.read_activity_key
          : null,
    }
  }

  public updateTaskMetadata(
    sessionId: string,
    input: TaskMetadataUpdate,
  ): TaskMetadata {
    const parsed = z
      .object({
        title: z.string().trim().min(1).max(160).optional(),
        pinned: z.boolean().optional(),
        archived: z.boolean().optional(),
        readActivityKey: z.string().max(4096).nullable().optional(),
      })
      .strict()
      .parse(input)
    const next = { ...this.getTaskMetadata(sessionId), ...parsed }
    this.ensureSessionTables()
    this.database
      .prepare(`
      INSERT INTO managed_task_metadata (session_id, title, pinned, archived, read_activity_key)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(session_id) DO UPDATE SET title = excluded.title,
        pinned = excluded.pinned, archived = excluded.archived,
        read_activity_key = excluded.read_activity_key
    `)
      .run(
        sessionId,
        next.title,
        Number(next.pinned),
        Number(next.archived),
        next.readActivityKey,
      )
    return next
  }

  public getTaskNotificationsEnabled(): boolean {
    return (
      this.database
        .prepare(
          'SELECT enabled FROM task_notification_preferences WHERE id = 1',
        )
        .get()?.enabled === 1
    )
  }

  public setTaskNotificationsEnabled(enabled: boolean): void {
    this.database
      .prepare(
        'UPDATE task_notification_preferences SET enabled = ? WHERE id = 1',
      )
      .run(Number(z.boolean().parse(enabled)))
  }

  public getTaskNotificationSoundsEnabled(): boolean {
    return (
      this.database
        .prepare(
          'SELECT sounds FROM task_notification_preferences WHERE id = 1',
        )
        .get()?.sounds === 1
    )
  }

  public setTaskNotificationSoundsEnabled(enabled: boolean): void {
    this.database
      .prepare(
        'UPDATE task_notification_preferences SET sounds = ? WHERE id = 1',
      )
      .run(Number(z.boolean().parse(enabled)))
  }

  /** Composer toolbar choices for a workspace, falling back to the last ones chosen anywhere. */
  public getComposerDefaults(workspaceId: string): ComposerDefaults | null {
    return (
      this.readComposerDefaults(
        composerDefaultsScope(persistedIdentifier.parse(workspaceId)),
      ) ?? this.readComposerDefaults(GLOBAL_COMPOSER_DEFAULTS_SCOPE)
    )
  }

  public setComposerDefaults(
    workspaceId: string,
    input: unknown,
  ): ComposerDefaults {
    const defaults = persistedComposerDefaults.parse(input)
    const scope = composerDefaultsScope(persistedIdentifier.parse(workspaceId))
    const payload = JSON.stringify(defaults)
    const statement = this.database.prepare(`
      INSERT INTO composer_defaults (scope, payload_json) VALUES (?, ?)
      ON CONFLICT(scope) DO UPDATE SET payload_json = excluded.payload_json
    `)
    statement.run(scope, payload)
    statement.run(GLOBAL_COMPOSER_DEFAULTS_SCOPE, payload)
    return defaults
  }

  /** The transcript code block soft-wrap choice, shared by every workspace. */
  public getCodeWrap(): boolean {
    const row = this.database
      .prepare('SELECT payload_json FROM composer_defaults WHERE scope = ?')
      .get(CODE_WRAP_SCOPE) as { payload_json: string } | undefined
    return row?.payload_json === 'true'
  }

  public setCodeWrap(wrap: unknown): void {
    this.database
      .prepare(`
        INSERT INTO composer_defaults (scope, payload_json) VALUES (?, ?)
        ON CONFLICT(scope) DO UPDATE SET payload_json = excluded.payload_json
      `)
      .run(CODE_WRAP_SCOPE, JSON.stringify(z.boolean().parse(wrap)))
  }

  private readComposerDefaults(scope: string): ComposerDefaults | null {
    const row = this.database
      .prepare('SELECT payload_json FROM composer_defaults WHERE scope = ?')
      .get(scope) as { payload_json: string } | undefined

    if (!row) {
      return null
    }

    const parsed = persistedComposerDefaults.safeParse(
      JSON.parse(row.payload_json),
    )
    return parsed.success ? parsed.data : null
  }

  public listManagedSessions(): PersistedManagedSession[] {
    if (!this.hasSessionTables()) return []
    const rows = this.database
      .prepare(
        `
          SELECT session_id, workspace_id, pane_id, payload_json
          FROM managed_session_snapshots
          ORDER BY updated_at ASC, session_id ASC
        `,
      )
      .all() as unknown as SqlManagedSessionRow[]

    return rows.flatMap((row) => {
      try {
        const persisted = this.normalizeManagedSession(
          JSON.parse(row.payload_json),
        )

        return persisted.config.sessionId === row.session_id &&
          persisted.config.workspaceId === row.workspace_id &&
          persisted.config.paneId === row.pane_id
          ? [persisted]
          : []
      } catch {
        return []
      }
    })
  }

  /** Every stored session row, parsed or not, for pitwall's `import`; empty once the tables dropped. */
  public listSessionImportCandidates(): SessionImportCandidate[] {
    if (!this.hasSessionTables()) return []
    const rows = this.database
      .prepare(
        `
          SELECT s.session_id, s.payload_json, s.updated_at, m.title,
            i.updated_at AS verified_updated_at
          FROM managed_session_snapshots s
          LEFT JOIN managed_task_metadata m ON m.session_id = s.session_id
          LEFT JOIN session_imports i ON i.session_id = s.session_id
          ORDER BY s.updated_at ASC, s.session_id ASC
        `,
      )
      .all() as {
      payload_json: string
      session_id: string
      title: string | null
      updated_at: string
      verified_updated_at: string | null
    }[]
    return rows.map((row) => {
      let persisted: PersistedManagedSession | null = null
      try {
        persisted = this.normalizeManagedSession(JSON.parse(row.payload_json))
        if (persisted.config.sessionId !== row.session_id) persisted = null
      } catch {}
      return {
        persisted,
        sessionId: row.session_id,
        title: row.title,
        updatedAt: row.updated_at,
        verifiedUpdatedAt: row.verified_updated_at,
      }
    })
  }

  /** Records that pitwall holds `sessionId` as stored at `updatedAt`, checked by reading it back. */
  public recordSessionImport(
    sessionId: string,
    updatedAt: string,
    appVersion: string,
  ): void {
    this.database
      .prepare(
        `
          INSERT INTO session_imports (session_id, updated_at, app_version, verified_at)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(session_id) DO UPDATE SET updated_at = excluded.updated_at,
            app_version = excluded.app_version, verified_at = excluded.verified_at
        `,
      )
      .run(sessionId, updatedAt, appVersion, new Date().toISOString())
  }

  /**
   * Drops the session tables once pitwall holds every stored session, each verified by a release before `appVersion`.
   * @remarks `backup` must leave a copy of the database first; it runs only when the drop is due, and its path comes back. Null when nothing dropped.
   */
  public dropImportedSessionTables(
    appVersion: string,
    backup: () => string,
  ): string | null {
    if (!this.hasSessionTables() || this.countUnimportedSessions(appVersion)) {
      return null
    }
    const backupPath = backup()
    const copy = new DatabaseSync(backupPath, { readOnly: true })
    let copied: number
    try {
      copied = (
        copy
          .prepare('SELECT COUNT(*) AS count FROM managed_session_snapshots')
          .get() as { count: number }
      ).count
    } finally {
      copy.close()
    }
    this.database.exec('BEGIN IMMEDIATE;')
    try {
      const stored = (
        this.database
          .prepare('SELECT COUNT(*) AS count FROM managed_session_snapshots')
          .get() as { count: number }
      ).count
      // A session saved since the check, or a backup that missed rows, waits for the next run.
      if (copied !== stored || this.countUnimportedSessions(appVersion)) {
        this.database.exec('ROLLBACK;')
        return null
      }
      for (const table of SESSION_TABLES) {
        this.database.exec(`DROP TABLE ${table};`)
      }
      this.database.exec('COMMIT;')
    } catch (error) {
      this.database.exec('ROLLBACK;')
      throw error
    }
    return backupPath
  }

  private countUnimportedSessions(appVersion: string): number {
    return (
      this.database
        .prepare(
          `
            SELECT COUNT(*) AS count FROM managed_session_snapshots s
            LEFT JOIN session_imports i ON i.session_id = s.session_id
              AND i.updated_at = s.updated_at AND i.app_version <> ?
            WHERE i.session_id IS NULL
          `,
        )
        .get(appVersion) as { count: number }
    ).count
  }

  private hasSessionTables(): boolean {
    return Boolean(
      this.database
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'managed_session_snapshots'",
        )
        .get(),
    )
  }

  /** Brings back the session tables a verified import dropped, for a built-in backend that still saves sessions. */
  private ensureSessionTables(): void {
    if (this.hasSessionTables()) return
    for (const migration of MIGRATIONS) {
      if (migration.version === 9 || migration.version === 10) {
        this.database.exec(migration.sql)
      }
    }
  }

  public reconcileInterruptedManagedSessions(
    now: string,
  ): PersistedManagedSession[] {
    return this.listManagedSessions().map((persisted) => {
      const turns = persisted.snapshot.turns.map((turn) =>
        turn.state === 'running'
          ? { ...turn, completedAt: now, state: 'interrupted' as const }
          : turn,
      )
      const interrupted =
        persisted.snapshot.running ||
        ['connecting', 'running', 'waiting'].includes(
          persisted.snapshot.sessionState,
        ) ||
        turns.some((turn, index) => turn !== persisted.snapshot.turns[index]) ||
        persisted.snapshot.pendingApprovals.length > 0 ||
        persisted.snapshot.pendingUserInputs.length > 0

      if (!interrupted) return persisted

      const next = this.normalizeManagedSession({
        config: persisted.config,
        snapshot: {
          ...persisted.snapshot,
          detail:
            'The provider session stopped when Aide closed. A new provider session will receive the visible conversation.',
          pendingApprovals: [],
          pendingUserInputs: [],
          planApproval: null,
          running: false,
          sessionState: 'stopped',
          turns,
          updatedAt: now,
        },
      })
      this.saveManagedSession(next)
      return next
    })
  }

  public createProject(input: CreateProjectInput): ProjectRecord {
    const now = new Date().toISOString()
    const project: ProjectRecord = {
      color: 'neutral',
      id: randomUUID(),
      icon: 'folder',
      kind: input.kind ?? 'git',
      name: input.name,
      repoRoot: input.repoRoot,
      remoteUrl: input.remoteUrl,
      defaultBranch: input.defaultBranch,
      setupCommand: null,
      worktreeSetupRevision: 0,
      createdAt: now,
      updatedAt: now,
    }

    this.database
      .prepare(
        `
          INSERT INTO projects (id, kind, name, icon, color, repo_root, remote_url, default_branch, setup_command, worktree_setup_revision, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        project.id,
        project.kind,
        project.name,
        project.icon ?? 'folder',
        project.color ?? 'neutral',
        project.repoRoot,
        project.remoteUrl,
        project.defaultBranch,
        project.setupCommand,
        project.worktreeSetupRevision,
        project.createdAt,
        project.updatedAt,
      )

    this.incrementCatalogRevision()

    return project
  }

  public deleteProject(projectId: string): boolean {
    const result = this.database
      .prepare(
        `
          DELETE FROM projects
          WHERE id = ?
        `,
      )
      .run(projectId) as { changes: number }

    if (result.changes > 0) {
      this.incrementCatalogRevision()
      return true
    }

    return false
  }

  public getProject(projectId: string): ProjectRecord | null {
    const row = this.database
      .prepare(
        `
          SELECT id, kind, name, icon, color, repo_root, remote_url, default_branch, setup_command, worktree_setup_revision, created_at, updated_at
          FROM projects
          WHERE id = ?
        `,
      )
      .get(projectId) as SqlProjectRow | undefined

    return row ? this.mapProjectRow(row) : null
  }

  public listProjects(): ProjectRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT id, kind, name, icon, color, repo_root, remote_url, default_branch, setup_command, worktree_setup_revision, created_at, updated_at
          FROM projects
          ORDER BY created_at ASC, id ASC
        `,
      )
      .all() as unknown as SqlProjectRow[]

    return rows.map((row) => this.mapProjectRow(row))
  }

  public findProjectByRepoRoot(repoRoot: string): ProjectRecord | null {
    const row = this.database
      .prepare(
        `
          SELECT id, kind, name, icon, color, repo_root, remote_url, default_branch, setup_command, worktree_setup_revision, created_at, updated_at
          FROM projects
          WHERE repo_root = ?
          LIMIT 1
        `,
      )
      .get(repoRoot) as SqlProjectRow | undefined

    return row ? this.mapProjectRow(row) : null
  }

  public updateProject(
    projectId: string,
    input: UpdateProjectInput,
  ): ProjectRecord | null {
    const existingProject = this.getProject(projectId)

    if (!existingProject) {
      return null
    }

    const updatedProject: ProjectRecord = {
      ...existingProject,
      color: input.color ?? existingProject.color ?? 'neutral',
      defaultBranch: input.defaultBranch ?? existingProject.defaultBranch,
      icon: input.icon ?? existingProject.icon ?? 'folder',
      kind: input.kind ?? existingProject.kind,
      name: input.name ?? existingProject.name,
      remoteUrl:
        input.remoteUrl !== undefined
          ? input.remoteUrl
          : existingProject.remoteUrl,
      repoRoot: input.repoRoot ?? existingProject.repoRoot,
      setupCommand:
        input.setupCommand !== undefined
          ? input.setupCommand
          : existingProject.setupCommand,
      worktreeSetupRevision:
        input.setupCommand !== undefined &&
        input.setupCommand !== existingProject.setupCommand
          ? existingProject.worktreeSetupRevision + 1
          : existingProject.worktreeSetupRevision,
      updatedAt: new Date().toISOString(),
    }

    this.database
      .prepare(
        `
          UPDATE projects
          SET kind = ?, name = ?, icon = ?, color = ?, repo_root = ?, remote_url = ?, default_branch = ?, setup_command = ?, worktree_setup_revision = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        updatedProject.kind,
        updatedProject.name,
        updatedProject.icon ?? 'folder',
        updatedProject.color ?? 'neutral',
        updatedProject.repoRoot,
        updatedProject.remoteUrl,
        updatedProject.defaultBranch,
        updatedProject.setupCommand,
        updatedProject.worktreeSetupRevision,
        updatedProject.updatedAt,
        projectId,
      )

    this.incrementCatalogRevision()

    return this.getProject(projectId)
  }

  public createWorkspace(input: CreateWorkspaceInput): WorkspaceRecord {
    const now = new Date().toISOString()
    const workspace: WorkspaceRecord = {
      id: randomUUID(),
      name: input.name,
      nameSource: input.nameSource ?? 'default',
      projectId: input.projectId,
      branchName: input.branchName,
      worktreePath: input.worktreePath,
      windowId: input.windowId,
      sidebarOpen: null,
      archived: false,
      createdAt: now,
      updatedAt: now,
    }

    this.database
      .prepare(
        `
          INSERT INTO workspaces (id, project_id, name, name_source, branch_name, worktree_path, window_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
      )
      .run(
        workspace.id,
        workspace.projectId,
        workspace.name,
        workspace.nameSource ?? 'default',
        workspace.branchName,
        workspace.worktreePath,
        workspace.windowId,
        workspace.createdAt,
        workspace.updatedAt,
      )

    this.incrementCatalogRevision()

    return workspace
  }

  public deleteWorkspace(workspaceId: string): boolean {
    const result = this.database
      .prepare(
        `
          DELETE FROM workspaces
          WHERE id = ?
        `,
      )
      .run(workspaceId) as { changes: number }

    if (result.changes > 0) {
      this.incrementCatalogRevision()
      return true
    }

    return false
  }

  public getWorkspace(workspaceId: string): WorkspaceRecord | null {
    const row = this.database
      .prepare(
        `
          SELECT id, project_id, name, name_source, branch_name, worktree_path, window_id, sidebar_open, archived, created_at, updated_at
          FROM workspaces
          WHERE id = ?
        `,
      )
      .get(workspaceId) as SqlWorkspaceRow | undefined

    return row ? this.mapWorkspaceRow(row) : null
  }

  public listWorkspaces(): WorkspaceRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT id, project_id, name, name_source, branch_name, worktree_path, window_id, sidebar_open, archived, created_at, updated_at
          FROM workspaces
          ORDER BY created_at ASC, id ASC
        `,
      )
      .all() as unknown as SqlWorkspaceRow[]

    return rows.map((row) => this.mapWorkspaceRow(row))
  }

  public listProjectWorkspaces(projectId: string): WorkspaceRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT id, project_id, name, name_source, branch_name, worktree_path, window_id, sidebar_open, archived, created_at, updated_at
          FROM workspaces
          WHERE project_id = ?
          ORDER BY created_at ASC
        `,
      )
      .all(projectId) as unknown as SqlWorkspaceRow[]

    return rows.map((row) => this.mapWorkspaceRow(row))
  }

  public findWorkspaceByWorktreePath(
    projectId: string,
    worktreePath: string,
  ): WorkspaceRecord | null {
    const row = this.database
      .prepare(
        `
          SELECT id, project_id, name, name_source, branch_name, worktree_path, window_id, sidebar_open, archived, created_at, updated_at
          FROM workspaces
          WHERE project_id = ? AND worktree_path = ?
          LIMIT 1
        `,
      )
      .get(projectId, worktreePath) as SqlWorkspaceRow | undefined

    return row ? this.mapWorkspaceRow(row) : null
  }

  public updateWorkspace(
    workspaceId: string,
    input: UpdateWorkspaceInput,
  ): WorkspaceRecord | null {
    const existingWorkspace = this.getWorkspace(workspaceId)

    if (!existingWorkspace) {
      return null
    }

    const updatedWorkspace: WorkspaceRecord = {
      ...existingWorkspace,
      branchName: input.branchName ?? existingWorkspace.branchName,
      name: input.name ?? existingWorkspace.name,
      nameSource: input.nameSource ?? existingWorkspace.nameSource ?? 'default',
      projectId: input.projectId ?? existingWorkspace.projectId,
      windowId:
        input.windowId !== undefined
          ? input.windowId
          : existingWorkspace.windowId,
      worktreePath: input.worktreePath ?? existingWorkspace.worktreePath,
      sidebarOpen: input.sidebarOpen ?? existingWorkspace.sidebarOpen ?? null,
      archived: input.archived ?? existingWorkspace.archived,
      updatedAt: new Date().toISOString(),
    }

    this.database
      .prepare(
        `
          UPDATE workspaces
          SET project_id = ?, name = ?, name_source = ?, branch_name = ?, worktree_path = ?, window_id = ?, sidebar_open = ?, archived = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(
        updatedWorkspace.projectId,
        updatedWorkspace.name,
        updatedWorkspace.nameSource ?? 'default',
        updatedWorkspace.branchName,
        updatedWorkspace.worktreePath,
        updatedWorkspace.windowId,
        sidebarOpenColumn(updatedWorkspace.sidebarOpen),
        Number(updatedWorkspace.archived ?? false),
        updatedWorkspace.updatedAt,
        workspaceId,
      )

    this.incrementCatalogRevision()

    return this.getWorkspace(workspaceId)
  }

  public renameWorkspaceIfUnchanged(
    workspaceId: string,
    input: {
      expectedUpdatedAt: string
      name: string
      nameSource: 'generated'
    },
  ): WorkspaceRecord | null {
    const updatedAt = new Date().toISOString()
    const result = this.database
      .prepare(
        `
          UPDATE workspaces
          SET name = ?, name_source = ?, updated_at = ?
          WHERE id = ? AND updated_at = ? AND name_source = 'default'
        `,
      )
      .run(
        input.name,
        input.nameSource,
        updatedAt,
        workspaceId,
        input.expectedUpdatedAt,
      ) as { changes: number }

    if (result.changes === 0) return null
    this.incrementCatalogRevision()
    return this.getWorkspace(workspaceId)
  }

  public getSnapshot(): PersistenceSnapshot {
    const activeSelection = this.getActiveSelection()
    const allWorkspaces = this.listWorkspaces()
    const workspaces = allWorkspaces.filter((workspace) => !workspace.archived)
    const legacyWorkspaceLayouts = this.listWorkspaceLayouts().reduce<
      Record<string, WorkspaceLayoutRecord>
    >((layouts, layout) => {
      layouts[layout.workspaceId] = layout
      return layouts
    }, {})
    const persistedSurfaceStateByWorkspace = new Map(
      this.listWorkspaceSurfaceStates().map((state) => [
        state.workspaceId,
        state,
      ]),
    )
    const workspaceSurfaces: Record<string, WorkspaceSurfaceRecord[]> = {}
    const workspaceLayoutRevisions: Record<string, number> = {}
    const workspaceSurfaceRevisions: Record<string, number> = {}
    const surfaceLayouts: Record<string, SurfaceLayoutRecord> = {}

    for (const workspace of workspaces) {
      const surfaceState =
        persistedSurfaceStateByWorkspace.get(workspace.id) ?? null

      if (surfaceState) {
        workspaceSurfaces[workspace.id] = surfaceState.surfaces
        workspaceLayoutRevisions[workspace.id] = surfaceState.revision
        workspaceSurfaceRevisions[workspace.id] = surfaceState.revision

        for (const layout of Object.values(surfaceState.layouts)) {
          surfaceLayouts[layout.surfaceId] = layout
        }

        continue
      }

      const legacyLayout = legacyWorkspaceLayouts[workspace.id]
      workspaceLayoutRevisions[workspace.id] = this.getWorkspaceLayoutRevision(
        workspace.id,
      )

      if (
        !legacyLayout ||
        !legacyLayout.rootNodeId ||
        legacyLayout.nodes.length === 0
      ) {
        workspaceSurfaces[workspace.id] = []
        continue
      }

      const legacySurfaceId = this.createLegacySurfaceId(workspace.id)
      workspaceSurfaces[workspace.id] = [
        {
          id: legacySurfaceId,
          orderIndex: 0,
          rootNodeId: legacyLayout.rootNodeId,
          title: workspace.name,
          workspaceId: workspace.id,
        },
      ]
      surfaceLayouts[legacySurfaceId] = {
        ...legacyLayout,
        surfaceId: legacySurfaceId,
      }
    }

    return {
      catalogRevision: this.getCatalogRevision(),
      databasePath: this.databasePath,
      lastActivePaneIdsBySurface: activeSelection.paneIdsBySurface ?? {},
      lastActivePaneIdsByWorkspace: activeSelection.paneIdsByWorkspace ?? {},
      lastActiveProjectId: activeSelection.projectId,
      lastActiveSurfaceIdsByWorkspace:
        activeSelection.surfaceIdsByWorkspace ?? {},
      lastActiveWorkspaceIdsByProject:
        activeSelection.workspaceIdsByProject ?? {},
      lastActiveWorkspaceId: activeSelection.workspaceId,
      migrationStrategy: MIGRATION_STRATEGY,
      schemaVersion: this.getSchemaVersion(),
      projects: this.listProjects(),
      surfaceLayouts,
      workspaceLayoutRevisions,
      workspaceLayouts: legacyWorkspaceLayouts,
      workspaceSurfaces,
      workspaceSurfaceRevisions,
      workspaces,
      archivedWorkspaces: allWorkspaces.filter(
        (workspace) => workspace.archived,
      ),
    }
  }

  public getWorkspaceLayout(workspaceId: string): WorkspaceLayoutRecord | null {
    const row = this.database
      .prepare(
        `
          SELECT workspace_id, root_node_id, nodes_json, revision
          FROM workspace_layouts
          WHERE workspace_id = ?
        `,
      )
      .get(workspaceId) as SqlWorkspaceLayoutRow | undefined

    return row ? this.mapWorkspaceLayoutRow(row) : null
  }

  public listWorkspaceLayouts(): WorkspaceLayoutRecord[] {
    const rows = this.database
      .prepare(
        `
          SELECT workspace_id, root_node_id, nodes_json, revision
          FROM workspace_layouts
          ORDER BY workspace_id ASC
        `,
      )
      .all() as unknown as SqlWorkspaceLayoutRow[]

    return rows.map((row) => this.mapWorkspaceLayoutRow(row))
  }

  public saveWorkspaceLayout(
    workspaceId: string,
    input: SaveWorkspaceLayoutInput,
  ): WorkspaceLayoutRecord | null {
    if (!this.getWorkspace(workspaceId)) {
      return null
    }

    const layout = this.normalizeWorkspaceLayout(workspaceId, input)

    this.database
      .prepare(
        `
          INSERT INTO workspace_layouts (workspace_id, root_node_id, nodes_json, revision, updated_at)
          VALUES (?, ?, ?, 1, ?)
          ON CONFLICT(workspace_id) DO UPDATE SET
            root_node_id = excluded.root_node_id,
            nodes_json = excluded.nodes_json,
            revision = workspace_layouts.revision + 1,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        layout.workspaceId,
        layout.rootNodeId,
        JSON.stringify(layout.nodes),
        new Date().toISOString(),
      )

    this.incrementCatalogRevision()
    return this.getWorkspaceLayout(workspaceId)
  }

  public saveWorkspaceSurfaceState(
    workspaceId: string,
    input: SaveWorkspaceSurfaceStateInput,
  ): {
    layouts: Record<string, SurfaceLayoutRecord>
    revision: number
    surfaces: WorkspaceSurfaceRecord[]
    workspaceId: string
  } | null {
    if (!this.getWorkspace(workspaceId)) {
      return null
    }

    const surfaces = [...input.surfaces]
      .map((surface) => this.normalizeWorkspaceSurface(workspaceId, surface))
      .sort((left, right) => left.orderIndex - right.orderIndex)
    const layouts = surfaces.reduce<Record<string, SurfaceLayoutRecord>>(
      (acc, surface) => {
        const layoutInput = input.layouts[surface.id]

        if (!layoutInput) {
          throw new Error('Each workspace surface requires a layout.')
        }

        const layout = {
          ...this.normalizeWorkspaceLayout(workspaceId, layoutInput),
          surfaceId: surface.id,
        }

        if (layout.rootNodeId !== surface.rootNodeId) {
          throw new Error(
            'Workspace surface root node id must match its layout root node id.',
          )
        }

        acc[surface.id] = layout
        return acc
      },
      {},
    )

    this.database
      .prepare(
        `
          INSERT INTO workspace_surface_states (workspace_id, surfaces_json, layouts_json, revision, updated_at)
          VALUES (?, ?, ?, 1, ?)
          ON CONFLICT(workspace_id) DO UPDATE SET
            surfaces_json = excluded.surfaces_json,
            layouts_json = excluded.layouts_json,
            revision = workspace_surface_states.revision + 1,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        workspaceId,
        JSON.stringify(surfaces),
        JSON.stringify(layouts),
        new Date().toISOString(),
      )

    this.incrementCatalogRevision()
    return this.getWorkspaceSurfaceState(workspaceId)
  }

  public getWorkspacePreviewState(
    workspaceId: string,
  ): WorkspacePreviewSnapshot | null {
    const row = this.database
      .prepare(
        `
          SELECT workspace_id, active_tab_id, initialized, revision, tabs_json
          FROM workspace_preview_states
          WHERE workspace_id = ?
        `,
      )
      .get(workspaceId) as SqlWorkspacePreviewStateRow | undefined

    return row ? this.mapWorkspacePreviewStateRow(row) : null
  }

  public getWorkspacePreviewStates(): Record<string, WorkspacePreviewSnapshot> {
    const rows = this.database
      .prepare(
        `
          SELECT workspace_id, active_tab_id, initialized, revision, tabs_json
          FROM workspace_preview_states
          ORDER BY updated_at ASC, workspace_id ASC
        `,
      )
      .all() as unknown as SqlWorkspacePreviewStateRow[]

    return Object.fromEntries(
      rows.map((row) => {
        const snapshot = this.mapWorkspacePreviewStateRow(row)
        return [snapshot.workspaceId, snapshot]
      }),
    )
  }

  public saveWorkspacePreviewState(
    input: WorkspacePreviewSnapshot,
  ): WorkspacePreviewSnapshot | null {
    if (!this.getWorkspace(input.workspaceId)) {
      return null
    }

    this.database
      .prepare(
        `
          INSERT INTO workspace_preview_states (workspace_id, active_tab_id, initialized, revision, tabs_json, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(workspace_id) DO UPDATE SET
            active_tab_id = excluded.active_tab_id,
            initialized = excluded.initialized,
            revision = excluded.revision,
            tabs_json = excluded.tabs_json,
            updated_at = excluded.updated_at
        `,
      )
      .run(
        input.workspaceId,
        input.activeTabId,
        input.initialized ? 1 : 0,
        input.revision,
        JSON.stringify(input.tabs),
        new Date().toISOString(),
      )

    return this.getWorkspacePreviewState(input.workspaceId)
  }

  public setActiveSelection(input: SetActiveSelectionInput): void {
    this.database
      .prepare(
        `
          UPDATE app_state
          SET last_active_project_id = ?, last_active_workspace_id = ?, last_active_workspace_ids_by_project = ?, last_active_pane_ids_by_workspace = ?, last_active_surface_ids_by_workspace = ?, last_active_pane_ids_by_surface = ?, updated_at = ?
          WHERE id = 1
        `,
      )
      .run(
        input.projectId,
        input.workspaceId,
        JSON.stringify(input.workspaceIdsByProject ?? {}),
        JSON.stringify(input.paneIdsByWorkspace ?? {}),
        JSON.stringify(input.surfaceIdsByWorkspace ?? {}),
        JSON.stringify(input.paneIdsBySurface ?? {}),
        new Date().toISOString(),
      )
  }

  private getSchemaVersion(): number {
    const row = this.database.prepare('PRAGMA user_version;').get() as {
      user_version: number
    }

    return row.user_version
  }

  private getCatalogRevision(): number {
    const row = this.database
      .prepare('SELECT catalog_revision FROM app_state WHERE id = 1')
      .get() as Pick<SqlAppStateRow, 'catalog_revision'> | undefined

    return row?.catalog_revision ?? 0
  }

  private incrementCatalogRevision(): void {
    this.database
      .prepare(
        'UPDATE app_state SET catalog_revision = catalog_revision + 1 WHERE id = 1',
      )
      .run()
  }

  private incrementWorkspaceSetupRevision(): number {
    this.database
      .prepare(
        'UPDATE app_state SET workspace_setup_revision = workspace_setup_revision + 1 WHERE id = 1',
      )
      .run()

    return this.getWorkspaceSetupRevision()
  }

  private getActiveSelection(): SetActiveSelectionInput {
    const row = this.database
      .prepare(
        `
          SELECT last_active_project_id, last_active_workspace_id, last_active_workspace_ids_by_project, last_active_pane_ids_by_workspace, last_active_surface_ids_by_workspace, last_active_pane_ids_by_surface
          FROM app_state
          WHERE id = 1
        `,
      )
      .get() as SqlAppStateRow | undefined

    return {
      paneIdsBySurface: row?.last_active_pane_ids_by_surface
        ? JSON.parse(row.last_active_pane_ids_by_surface)
        : {},
      paneIdsByWorkspace: row?.last_active_pane_ids_by_workspace
        ? JSON.parse(row.last_active_pane_ids_by_workspace)
        : {},
      projectId: row?.last_active_project_id ?? null,
      surfaceIdsByWorkspace: row?.last_active_surface_ids_by_workspace
        ? JSON.parse(row.last_active_surface_ids_by_workspace)
        : {},
      workspaceIdsByProject: row?.last_active_workspace_ids_by_project
        ? JSON.parse(row.last_active_workspace_ids_by_project)
        : {},
      workspaceId: row?.last_active_workspace_id ?? null,
    }
  }

  private mapProjectRow(row: SqlProjectRow): ProjectRecord {
    return {
      color: row.color,
      id: row.id,
      icon: row.icon,
      kind: row.kind,
      name: row.name,
      repoRoot: row.repo_root,
      remoteUrl: row.remote_url,
      defaultBranch: row.default_branch,
      setupCommand: row.setup_command,
      worktreeSetupRevision: row.worktree_setup_revision,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private mapWorkspaceRow(row: SqlWorkspaceRow): WorkspaceRecord {
    return {
      id: row.id,
      name: row.name,
      nameSource: row.name_source,
      projectId: row.project_id,
      branchName: row.branch_name,
      worktreePath: row.worktree_path,
      windowId: row.window_id,
      sidebarOpen: row.sidebar_open === null ? null : row.sidebar_open === 1,
      archived: row.archived === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }
  }

  private mapWorkspaceSetupStateRow(
    row: SqlWorkspaceSetupStateRow,
  ): WorkspaceSetupSnapshot {
    return {
      attempt: row.attempt,
      commandRequired: false,
      endedAt: row.ended_at,
      errorSummary: row.error_summary,
      exitCode: row.exit_code,
      outputByteLength: row.output_byte_length,
      outputLineCount: row.output_line_count,
      outputTail: row.output_tail,
      outputTruncated: row.output_truncated === 1,
      projectSetupRevision: row.project_setup_revision,
      revision: row.revision,
      signal: row.signal,
      startedAt: row.started_at,
      state: row.state,
      updatedAt: row.updated_at,
      workspaceId: row.workspace_id,
    }
  }

  private mapWorkspaceLayoutRow(
    row: SqlWorkspaceLayoutRow,
  ): WorkspaceLayoutRecord {
    const parsedNodes = JSON.parse(row.nodes_json) as PersistedLayoutNode[]

    return this.normalizeWorkspaceLayout(row.workspace_id, {
      nodes: parsedNodes,
      rootNodeId: row.root_node_id,
    })
  }

  private createLegacySurfaceId(workspaceId: string): string {
    return `${workspaceId}${LEGACY_SURFACE_SUFFIX}`
  }

  private getWorkspaceSurfaceState(workspaceId: string): {
    layouts: Record<string, SurfaceLayoutRecord>
    revision: number
    surfaces: WorkspaceSurfaceRecord[]
    workspaceId: string
  } | null {
    const row = this.database
      .prepare(
        `
          SELECT workspace_id, surfaces_json, layouts_json, revision
          FROM workspace_surface_states
          WHERE workspace_id = ?
        `,
      )
      .get(workspaceId) as SqlWorkspaceSurfaceStateRow | undefined

    return row ? this.mapWorkspaceSurfaceStateRow(row) : null
  }

  private getWorkspaceLayoutRevision(workspaceId: string): number {
    const row = this.database
      .prepare('SELECT revision FROM workspace_layouts WHERE workspace_id = ?')
      .get(workspaceId) as Pick<SqlWorkspaceLayoutRow, 'revision'> | undefined

    return row?.revision ?? 0
  }

  private listWorkspaceSurfaceStates(): Array<{
    layouts: Record<string, SurfaceLayoutRecord>
    revision: number
    surfaces: WorkspaceSurfaceRecord[]
    workspaceId: string
  }> {
    const rows = this.database
      .prepare(
        `
          SELECT workspace_id, surfaces_json, layouts_json, revision
          FROM workspace_surface_states
          ORDER BY workspace_id ASC
        `,
      )
      .all() as unknown as SqlWorkspaceSurfaceStateRow[]

    return rows.map((row) => this.mapWorkspaceSurfaceStateRow(row))
  }

  private mapWorkspaceSurfaceStateRow(row: SqlWorkspaceSurfaceStateRow): {
    layouts: Record<string, SurfaceLayoutRecord>
    revision: number
    surfaces: WorkspaceSurfaceRecord[]
    workspaceId: string
  } {
    const parsedSurfaces = JSON.parse(
      row.surfaces_json,
    ) as WorkspaceSurfaceRecord[]
    const parsedLayouts = JSON.parse(row.layouts_json) as Record<
      string,
      SaveWorkspaceLayoutInput
    >

    return {
      layouts: Object.entries(parsedLayouts).reduce<
        Record<string, SurfaceLayoutRecord>
      >((acc, [surfaceId, layout]) => {
        acc[surfaceId] = {
          ...this.normalizeWorkspaceLayout(row.workspace_id, layout),
          surfaceId,
        }
        return acc
      }, {}),
      revision: row.revision,
      surfaces: parsedSurfaces.map((surface) =>
        this.normalizeWorkspaceSurface(row.workspace_id, surface),
      ),
      workspaceId: row.workspace_id,
    }
  }

  private mapWorkspacePreviewStateRow(
    row: SqlWorkspacePreviewStateRow,
  ): WorkspacePreviewSnapshot {
    return {
      activeTabId: row.active_tab_id,
      initialized: row.initialized === 1,
      revision: row.revision,
      tabs: JSON.parse(row.tabs_json),
      workspaceId: row.workspace_id,
    }
  }

  private normalizeWorkspaceLayout(
    workspaceId: string,
    input: SaveWorkspaceLayoutInput,
  ): WorkspaceLayoutRecord {
    if (!input.rootNodeId) {
      throw new Error('Workspace layouts require a root node id.')
    }

    if (input.nodes.length === 0) {
      throw new Error('Workspace layouts require at least one layout node.')
    }

    const nodes = input.nodes.map((node) =>
      this.normalizeLayoutNode(workspaceId, node),
    )

    if (!nodes.some((node) => node.id === input.rootNodeId)) {
      throw new Error('Workspace layout root node must exist in the node list.')
    }

    return {
      nodes,
      rootNodeId: input.rootNodeId,
      workspaceId,
    }
  }

  private normalizeManagedSession(input: unknown): PersistedManagedSession {
    const parsed = persistedManagedSessionSchema.safeParse(input)

    if (!parsed.success) {
      throw new Error('Invalid managed session.')
    }

    const { queuedInputs = [], ...snapshot } = parsed.data.snapshot
    return {
      ...parsed.data,
      snapshot: {
        ...snapshot,
        content: [
          ...snapshot.content,
          ...queuedInputs.map((input) => ({
            id: `unsent-follow-up:${input.id}`,
            kind: 'system' as const,
            provider: null,
            text: `This queued message was never sent:\n\n${input.text}`,
            turnId: null,
            updatedAt: input.createdAt,
          })),
        ],
        ...(parsed.data.config.agents
          ? { agents: parsed.data.config.agents }
          : {}),
      },
    }
  }

  private normalizeWorkspaceSurface(
    workspaceId: string,
    surface: WorkspaceSurfaceRecord,
  ): WorkspaceSurfaceRecord {
    if (surface.workspaceId !== workspaceId) {
      throw new Error(
        'Workspace surfaces must belong to the workspace being saved.',
      )
    }

    if (!surface.id || !surface.rootNodeId) {
      throw new Error('Workspace surfaces require ids and root node ids.')
    }

    return {
      ...surface,
      orderIndex: Math.max(0, Math.trunc(surface.orderIndex)),
      title: surface.title.trim() || 'Pane',
    }
  }

  private normalizeLayoutNode(
    workspaceId: string,
    node: PersistedLayoutNode,
  ): PersistedLayoutNode {
    if (node.workspaceId !== workspaceId) {
      throw new Error('Layout nodes must belong to the workspace being saved.')
    }

    if (node.type === 'pane') {
      if (node.children.length > 0 || node.sizeWeights.length > 0) {
        throw new Error('Pane layout nodes cannot declare children or weights.')
      }

      if (!node.paneId) {
        throw new Error('Pane layout nodes require a pane id.')
      }

      const viewIds =
        Array.isArray(node.viewIds) && node.viewIds.length > 0
          ? node.viewIds
          : [node.paneId]
      const activeViewIndex =
        typeof node.activeViewIndex === 'number'
          ? Math.min(Math.max(node.activeViewIndex, 0), viewIds.length - 1)
          : 0

      return {
        ...node,
        activeViewIndex,
        children: [],
        sizeWeights: [],
        viewIds,
      }
    }

    if (node.paneId !== null) {
      throw new Error('Split layout nodes cannot declare a pane id.')
    }

    if (node.children.length !== node.sizeWeights.length) {
      throw new Error(
        'Split layout nodes must keep children and weight counts aligned.',
      )
    }

    return {
      ...node,
      children: [...node.children],
      sizeWeights: [...node.sizeWeights],
    }
  }

  private ensureUpdateState(): void {
    this.database
      .prepare(
        `
          INSERT INTO app_update_state (
            id, installation_id, automatic_downloads, health_reporting_enabled,
            health_disclosure_acknowledged, updated_at
          ) VALUES (1, ?, 1, 1, 0, ?)
          ON CONFLICT(id) DO NOTHING
        `,
      )
      .run(randomUUID(), new Date().toISOString())
  }

  private canCollectUpdateHealth(
    state: Pick<
      UpdateState,
      'healthDisclosureAcknowledged' | 'healthReportingEnabled'
    >,
  ): boolean {
    return state.healthReportingEnabled && state.healthDisclosureAcknowledged
  }

  /** Clears stale pre-disclosure data left by an older build before it can upload. */
  private discardUpdateHealthEventsIfNotPermitted(): void {
    if (this.canCollectUpdateHealth(this.getUpdateState())) return
    this.database.exec('DELETE FROM app_update_health_queue;')
  }

  private tryAppendUpdateHealthEvent(event: UpdateHealthEvent): boolean {
    try {
      this.appendUpdateHealthEvent(event)
      return true
    } catch {
      return false
    }
  }

  private deleteExpiredUpdateHealthEvents(now: string): void {
    const cutoff = new Date(
      new Date(now).getTime() - UPDATE_HEALTH_TTL_MS,
    ).toISOString()
    this.database
      .prepare('DELETE FROM app_update_health_queue WHERE created_at < ?')
      .run(cutoff)
  }

  private mapUpdateStateRow(row: SqlUpdateStateRow): UpdateState {
    return {
      automaticDownloads: row.automatic_downloads === 1,
      healthDisclosureAcknowledged: row.health_disclosure_acknowledged === 1,
      healthReportingEnabled: row.health_reporting_enabled === 1,
      installationId: row.installation_id,
      lastCheckedAt: row.last_checked_at,
      pendingAttemptId: row.pending_attempt_id,
      pendingTargetVersion: row.pending_target_version,
      snoozedUntil: row.snoozed_until,
    }
  }

  private mapUpdateHealthEventRow(
    row: SqlUpdateHealthEventRow,
  ): UpdateHealthEvent {
    return {
      arch: row.arch,
      attemptId: row.attempt_id,
      cohort: row.cohort,
      createdAt: row.created_at,
      currentVersion: row.current_version,
      durationMs: row.duration_ms,
      errorCode: row.error_code,
      lifecycle: row.lifecycle,
      platform: row.platform,
      targetVersion: row.target_version,
    }
  }

  private normalizeUpdateHealthEvent(
    event: UpdateHealthEvent,
  ): UpdateHealthEvent {
    if (
      !event ||
      typeof event.attemptId !== 'string' ||
      !/^[a-zA-Z0-9._-]{1,128}$/.test(event.attemptId) ||
      !STABLE_SEMVER.test(event.currentVersion) ||
      (event.targetVersion !== null &&
        !STABLE_SEMVER.test(event.targetVersion)) ||
      (event.platform !== 'darwin' && event.platform !== 'linux') ||
      (event.arch !== 'arm64' && event.arch !== 'x64') ||
      !Number.isInteger(event.cohort) ||
      event.cohort < 0 ||
      event.cohort >= 100 ||
      !UPDATE_HEALTH_LIFECYCLES.has(event.lifecycle) ||
      !UPDATE_ERROR_CODES.has(event.errorCode) ||
      !COARSE_UPDATE_HEALTH_TIMESTAMP.test(event.createdAt) ||
      new Date(event.createdAt).toISOString() !== event.createdAt ||
      (event.durationMs !== null &&
        (!Number.isSafeInteger(event.durationMs) ||
          !UPDATE_HEALTH_DURATION_BUCKETS.has(event.durationMs)))
    ) {
      throw new Error('Invalid update health event.')
    }

    return {
      arch: event.arch,
      attemptId: event.attemptId,
      cohort: event.cohort,
      createdAt: event.createdAt,
      currentVersion: event.currentVersion,
      durationMs: event.durationMs,
      errorCode: event.errorCode,
      lifecycle: event.lifecycle,
      platform: event.platform,
      targetVersion: event.targetVersion,
    }
  }

  private requireNullableIdentifier(
    value: string | null,
    label: string,
  ): string | null {
    if (value === null) return null
    if (typeof value !== 'string' || !/^[a-zA-Z0-9._-]{1,128}$/.test(value)) {
      throw new Error(`Invalid ${label}.`)
    }
    return value
  }

  private requireNullableIsoTimestamp(
    value: string | null,
    label: string,
  ): string | null {
    if (value === null) return null
    if (
      typeof value !== 'string' ||
      !ISO_TIMESTAMP.test(value) ||
      new Date(value).toISOString() !== value
    ) {
      throw new Error(`Invalid ${label}.`)
    }
    return value
  }

  private requireNullableSemver(
    value: string | null,
    label: string,
  ): string | null {
    if (value === null) return null
    if (typeof value !== 'string' || !STABLE_SEMVER.test(value)) {
      throw new Error(`Invalid ${label}.`)
    }
    return value
  }

  private pickUpdateStateValue<
    K extends Exclude<keyof UpdateState, 'installationId'>,
  >(
    input: Partial<Omit<UpdateState, 'installationId'>>,
    key: K,
    fallback: UpdateState[K],
  ): UpdateState[K] {
    return Object.hasOwn(input, key) ? (input[key] as UpdateState[K]) : fallback
  }

  private runMigrations(): void {
    const currentVersion = this.getSchemaVersion()
    const pendingMigrations = MIGRATIONS.filter(
      (migration) => migration.version > currentVersion,
    )

    for (const migration of pendingMigrations) {
      try {
        this.database.exec(migration.sql)
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.includes('duplicate column name')
        ) {
          // Ignore duplicate column errors when migrating existing local databases.
        } else {
          throw error
        }
      }
      this.database.exec(`PRAGMA user_version = ${migration.version};`)
    }
  }
}

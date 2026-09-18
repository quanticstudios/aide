import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

import { describe, expect, it } from 'vitest'

import type { PersistedManagedSession } from '../shared/managed-session'
import { createAideDatabase } from './database'

describe('createAideDatabase', () => {
  it('creates the schema and exposes the migration strategy', () => {
    const database = createAideDatabase(':memory:')

    expect(database.getSnapshot()).toMatchObject({
      databasePath: ':memory:',
      lastActivePaneIdsByWorkspace: {},
      lastActiveProjectId: null,
      lastActiveWorkspaceIdsByProject: {},
      lastActiveWorkspaceId: null,
      migrationStrategy:
        'Ordered SQL migrations tracked with PRAGMA user_version.',
      projects: [],
      schemaVersion: 14,
      workspaceLayouts: {},
      workspaces: [],
    })

    database.close()
  })

  it('migrates saved project appearances and persists any Lucide name and palette color', () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'aide-appearance-db-'))
    const databasePath = path.join(directory, 'aide.sqlite3')
    try {
      const database = createAideDatabase(databasePath)
      const project = database.createProject({
        name: 'aide',
        repoRoot: '/workspace/aide',
        defaultBranch: 'main',
        remoteUrl: null,
      })
      database.updateProject(project.id, { icon: 'code', color: 'violet' })
      database.close()
      const legacy = new DatabaseSync(databasePath)
      legacy.exec(`
        ALTER TABLE projects DROP COLUMN icon;
        ALTER TABLE projects DROP COLUMN color;
        ALTER TABLE projects ADD COLUMN icon TEXT NOT NULL DEFAULT 'folder' CHECK (icon IN ('folder', 'code', 'layers', 'sparkles'));
        ALTER TABLE projects ADD COLUMN color TEXT NOT NULL DEFAULT 'neutral' CHECK (color IN ('neutral', 'blue', 'violet', 'green', 'amber'));
        UPDATE projects SET icon = 'code', color = 'violet';
        PRAGMA user_version = 13;
      `)
      legacy.close()
      const migrated = createAideDatabase(databasePath)
      expect(migrated.getProject(project.id)).toMatchObject({
        icon: 'code-xml',
        color: 'violet',
        name: 'aide',
        repoRoot: '/workspace/aide',
      })
      migrated.updateProject(project.id, { icon: 'rocket', color: 'orange' })
      migrated.close()
      const reopened = createAideDatabase(databasePath)
      expect(reopened.getProject(project.id)).toMatchObject({
        icon: 'rocket',
        color: 'orange',
      })
      reopened.close()
    } finally {
      rmSync(directory, { force: true, recursive: true })
    }
  })

  it('persists project capabilities across reopen', () => {
    const tempDirectory = mkdtempSync(path.join(tmpdir(), 'aide-project-db-'))
    const databasePath = path.join(tempDirectory, 'aide.sqlite3')

    try {
      const database = createAideDatabase(databasePath)
      const project = database.createProject({
        defaultBranch: '',
        kind: 'folder',
        name: 'notes',
        remoteUrl: null,
        repoRoot: '/workspace/notes',
      })
      database.close()

      const reopened = createAideDatabase(databasePath)
      expect(reopened.getProject(project.id)?.kind).toBe('folder')
      reopened.close()
    } finally {
      rmSync(tempDirectory, { force: true, recursive: true })
    }
  })

  it('reopens managed conversations from disk', () => {
    const tempDirectory = mkdtempSync(path.join(tmpdir(), 'aide-session-db-'))
    const databasePath = path.join(tempDirectory, 'aide.sqlite3')

    try {
      const database = createAideDatabase(databasePath)
      const project = database.createProject({
        defaultBranch: 'main',
        name: 'aide',
        remoteUrl: null,
        repoRoot: '/workspace/aide',
      })
      const workspace = database.createWorkspace({
        branchName: 'main',
        name: 'Main',
        projectId: project.id,
        windowId: null,
        worktreePath: '/workspace/aide',
      })
      const agents = [
        {
          alias: 'reviewer',
          selection: {
            mode: 'codex' as const,
            model: 'gpt-5.6-sol',
            effort: 'medium',
          },
        },
      ]
      const persisted: PersistedManagedSession = {
        config: {
          agents,
          cwd: '/workspace/aide',
          mode: 'claude',
          orchestratorSelection: {
            mode: 'claude',
            serviceTier: null,
          },
          paneId: 'pane-1',
          serviceTier: null,
          sessionId: 'session-1',
          workspaceId: workspace.id,
        },
        snapshot: {
          agents,
          fleet: {
            plan: {
              summary: 'Saved architecture',
              nodes: [
                {
                  id: 'node-1',
                  title: 'Storage',
                  detail: 'Persist JSON',
                  dependsOn: [],
                  status: 'completed',
                  evidence: 'Reported check',
                },
              ],
            },
            events: [
              {
                id: 'event-1',
                createdAt: '2026-04-11T10:00:00.000Z',
                turnId: null,
                type: 'preparation',
                status: 'completed',
                label: 'Jev',
                detail: 'Prepared',
                source: 'runtime',
              },
            ],
            acceptedNodeIds: ['node-1'],
            attemptCounts: { 'node-1': 2 },
            updatedAt: '2026-04-11T10:00:00.000Z',
          },
          content: [
            {
              id: 'progress',
              kind: 'assistant-text',
              phase: 'commentary',
              provider: 'codex',
              text: 'Checking.',
              turnId: null,
              updatedAt: '2026-04-11T10:00:00.000Z',
            },
            {
              id: 'answer',
              kind: 'assistant-text',
              phase: 'final_answer',
              provider: 'codex',
              text: 'Tokyo.',
              turnId: null,
              updatedAt: '2026-04-11T10:00:00.000Z',
            },
          ],
          detail: null,
          effort: null,
          interactionMode: 'build',
          lastCompletedAt: null,
          lastError: null,
          lastErrorAt: null,
          model: null,
          orchestratorSelection: {
            mode: 'claude',
            serviceTier: null,
          },
          paneId: 'pane-1',
          pendingApprovals: [],
          pendingUserInputs: [],
          planApproval: null,
          provider: 'claude',
          revision: 1,
          running: true,
          runtimeGeneration: 1,
          selectionNotice: null,
          serviceTier: null,
          sessionId: 'session-1',
          sessionState: 'running',
          turns: [
            {
              completedAt: null,
              id: 'turn-1',
              provider: 'claude',
              startedAt: '2026-04-11T10:00:00.000Z',
              state: 'running',
            },
          ],
          updatedAt: '2026-04-11T10:00:00.000Z',
          usage: { inputTokens: 3, outputTokens: 2 },
          usageReports: [
            {
              createdAt: '2026-04-11T10:00:00.000Z',
              estimatedCostUsd: 0.01,
              id: 'usage-1',
              models: [
                {
                  cachedInputTokens: null,
                  cacheCreationInputTokens: null,
                  estimatedCostUsd: 0.01,
                  inputTokens: 3,
                  model: 'claude-test',
                  outputTokens: 2,
                },
              ],
              provider: 'claude',
              runtimeGeneration: 1,
              scopeId: 'scope-1',
              turnId: 'turn-1',
            },
          ],
          workspaceId: workspace.id,
        },
      }
      database.saveManagedSession(persisted)
      database.close()

      const reopened = createAideDatabase(databasePath)
      expect(reopened.listManagedSessions()).toEqual([persisted])
      expect(
        reopened.reconcileInterruptedManagedSessions(
          '2026-04-11T11:00:00.000Z',
        )[0]?.snapshot.turns[0],
      ).toMatchObject({
        completedAt: '2026-04-11T11:00:00.000Z',
        state: 'interrupted',
      })
      reopened.close()
    } finally {
      rmSync(tempDirectory, { force: true, recursive: true })
    }
  })

  it('stores and reloads projects plus workspaces', () => {
    const database = createAideDatabase(':memory:')

    const project = database.createProject({
      defaultBranch: 'main',
      name: 'aide',
      remoteUrl: 'https://github.com/example/aide',
      repoRoot: '/workspace/aide',
    })

    const workspace = database.createWorkspace({
      branchName: 'feature/navigation',
      name: 'Navigation shell',
      projectId: project.id,
      windowId: null,
      worktreePath: '/workspace/aide/.worktrees/navigation',
    })

    const snapshot = database.getSnapshot()

    expect(snapshot.projects).toEqual([project])
    expect(snapshot.workspaces).toEqual([workspace])

    database.close()
  })

  it('persists workspace activity visit watermarks', () => {
    const database = createAideDatabase(':memory:')
    const project = database.createProject({
      defaultBranch: 'main',
      name: 'aide',
      remoteUrl: null,
      repoRoot: '/workspace/aide',
    })
    const workspace = database.createWorkspace({
      branchName: 'main',
      name: 'Main',
      projectId: project.id,
      windowId: null,
      worktreePath: '/workspace/aide',
    })

    database.setWorkspaceActivityVisitWatermark(
      workspace.id,
      '2026-07-13T12:00:00.000Z',
    )

    expect(database.getWorkspaceActivityVisitWatermarks()).toEqual({
      [workspace.id]: '2026-07-13T12:00:00.000Z',
    })
    database.close()
  })

  it('initializes durable update state once and safely reopens it', () => {
    const tempDirectory = mkdtempSync(path.join(tmpdir(), 'aide-update-db-'))
    const databasePath = path.join(tempDirectory, 'aide.sqlite3')

    try {
      const database = createAideDatabase(databasePath)
      const initial = database.getUpdateState()

      expect(initial).toMatchObject({
        automaticDownloads: true,
        healthDisclosureAcknowledged: false,
        healthReportingEnabled: true,
        lastCheckedAt: null,
        pendingAttemptId: null,
        pendingTargetVersion: null,
        snoozedUntil: null,
      })
      expect(initial.installationId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      )

      const updated = database.updateUpdateState({
        automaticDownloads: false,
        healthDisclosureAcknowledged: true,
        lastCheckedAt: '2026-07-24T12:00:00.000Z',
        pendingAttemptId: 'attempt-1',
        pendingTargetVersion: '0.2.1',
        snoozedUntil: '2026-07-25T12:00:00.000Z',
      })
      database.close()

      const reopened = createAideDatabase(databasePath)
      expect(reopened.getUpdateState()).toEqual(updated)
      expect(reopened.getUpdateState().installationId).toBe(
        initial.installationId,
      )
      reopened.close()
    } finally {
      rmSync(tempDirectory, { force: true, recursive: true })
    }
  })

  it('collects health data only after disclosure and clears it when consent is withdrawn', () => {
    const database = createAideDatabase(':memory:')
    const initial = database.getUpdatePreferences()

    expect(initial).toEqual({
      automaticDownloads: true,
      healthDisclosureAcknowledged: false,
      healthReportingEnabled: true,
      revision: 0,
      snoozedUntil: null,
    })
    database.appendUpdateHealthEvent({
      arch: 'x64',
      attemptId: 'before-disclosure',
      cohort: 7,
      createdAt: '2026-07-24T11:00:00.000Z',
      currentVersion: '0.1.0',
      durationMs: null,
      errorCode: null,
      lifecycle: 'check-started',
      platform: 'linux',
      targetVersion: null,
    })
    expect(database.listUpdateHealthEvents('2026-07-24T14:00:00.000Z')).toEqual(
      [],
    )

    expect(
      database.updateUpdatePreferences({
        automaticDownloads: false,
        healthDisclosureAcknowledged: true,
        snoozedUntil: '2026-07-25T12:00:00.000Z',
      }),
    ).toEqual({
      automaticDownloads: false,
      healthDisclosureAcknowledged: true,
      healthReportingEnabled: true,
      revision: 1,
      snoozedUntil: '2026-07-25T12:00:00.000Z',
    })

    database.appendUpdateHealthEvent({
      arch: 'x64',
      attemptId: 'privacy-opt-out',
      cohort: 7,
      createdAt: '2026-07-24T12:00:00.000Z',
      currentVersion: '0.1.0',
      durationMs: null,
      errorCode: null,
      lifecycle: 'check-started',
      platform: 'linux',
      targetVersion: null,
    })
    expect(
      database.listUpdateHealthEvents('2026-07-24T14:00:00.000Z'),
    ).toHaveLength(1)

    expect(
      database.updateUpdatePreferences({ healthDisclosureAcknowledged: false }),
    ).toMatchObject({ healthDisclosureAcknowledged: false, revision: 2 })
    expect(database.listUpdateHealthEvents('2026-07-24T14:00:00.000Z')).toEqual(
      [],
    )

    database.updateUpdatePreferences({ healthDisclosureAcknowledged: true })
    database.appendUpdateHealthEvent({
      arch: 'x64',
      attemptId: 'after-reacknowledgement',
      cohort: 7,
      createdAt: '2026-07-24T13:00:00.000Z',
      currentVersion: '0.1.0',
      durationMs: null,
      errorCode: null,
      lifecycle: 'check-started',
      platform: 'linux',
      targetVersion: null,
    })
    expect(
      database.listUpdateHealthEvents('2026-07-24T14:00:00.000Z'),
    ).toHaveLength(1)
    expect(
      database.updateUpdatePreferences({ healthReportingEnabled: false }),
    ).toMatchObject({ healthReportingEnabled: false })
    expect(database.listUpdateHealthEvents('2026-07-24T14:00:00.000Z')).toEqual(
      [],
    )
    database.close()
  })

  it('bounds update health storage, expires it, and never serializes unknown fields', () => {
    const database = createAideDatabase(':memory:')
    database.updateUpdateState({ healthDisclosureAcknowledged: true })

    database.appendUpdateHealthEvent({
      arch: 'x64',
      attemptId: 'expired',
      cohort: 7,
      createdAt: '2026-06-01T00:00:00.000Z',
      currentVersion: '0.1.0',
      durationMs: null,
      errorCode: null,
      lifecycle: 'check-started',
      platform: 'linux',
      targetVersion: null,
    })
    for (let index = 0; index < 101; index += 1) {
      database.appendUpdateHealthEvent({
        arch: 'x64',
        attemptId: `attempt-${index}`,
        cohort: index % 100,
        createdAt: '2026-07-24T12:00:00.000Z',
        currentVersion: '0.1.0',
        durationMs: 1_000,
        errorCode: index % 2 === 0 ? 'network' : null,
        lifecycle: 'downloaded',
        platform: 'linux',
        targetVersion: '0.2.1',
        // This must never be used as a persistence schema escape hatch.
        rawError: 'https://secret@example.test/file',
      } as never)
    }

    const events = database.listUpdateHealthEvents('2026-07-24T12:00:00.000Z')
    expect(events).toHaveLength(100)
    expect(events[0]?.attemptId).toBe('attempt-1')
    expect(JSON.stringify(events)).not.toContain('secret')
    expect(JSON.stringify(events)).not.toContain('rawError')

    database.updateUpdateState({ healthReportingEnabled: false })
    expect(database.listUpdateHealthEvents()).toEqual([])
    database.close()
  })

  it('acknowledges only exact internal health queue rows', () => {
    const database = createAideDatabase(':memory:')
    database.updateUpdateState({ healthDisclosureAcknowledged: true })
    for (const attemptId of ['first', 'second']) {
      database.appendUpdateHealthEvent({
        arch: 'x64',
        attemptId,
        cohort: 7,
        createdAt: '2026-07-24T12:00:00.000Z',
        currentVersion: '0.1.0',
        durationMs: null,
        errorCode: null,
        lifecycle: 'check-started',
        platform: 'linux',
        targetVersion: null,
      })
    }

    const queued = database.listQueuedUpdateHealthEvents(
      20,
      '2026-07-24T12:00:01.000Z',
    )
    expect(queued).toHaveLength(2)
    expect(queued[0]?.event.attemptId).toBe('first')
    database.acknowledgeUpdateHealthEvents([queued[0]?.id as number])
    expect(
      database.listUpdateHealthEvents('2026-07-24T12:00:01.000Z'),
    ).toMatchObject([{ attemptId: 'second' }])
    database.close()
  })

  it('reconciles only committed update installs on the next startup', () => {
    const database = createAideDatabase(':memory:')

    expect(
      database.reconcilePendingUpdateInstall({
        arch: 'x64',
        currentVersion: '0.1.0',
        now: '2026-07-24T12:00:00.000Z',
        platform: 'linux',
      }),
    ).toBeNull()
    expect(database.listUpdateHealthEvents('2026-07-24T14:00:00.000Z')).toEqual(
      [],
    )

    database.commitUpdateInstallStart({
      arch: 'x64',
      attemptId: 'install-attempt',
      currentVersion: '0.1.0',
      now: '2026-07-24T12:00:30.000Z',
      platform: 'linux',
      targetVersion: '0.2.1',
    })
    expect(database.listUpdateHealthEvents('2026-07-24T14:00:00.000Z')).toEqual(
      [],
    )
    expect(
      database.reconcilePendingUpdateInstall({
        arch: 'x64',
        currentVersion: '0.2.1',
        now: '2026-07-24T12:01:00.000Z',
        platform: 'linux',
      }),
    ).toBeNull()
    expect(database.listUpdateHealthEvents('2026-07-24T14:00:00.000Z')).toEqual(
      [],
    )

    database.updateUpdateState({ healthDisclosureAcknowledged: true })
    database.commitUpdateInstallStart({
      arch: 'x64',
      attemptId: 'acknowledged-install-attempt',
      currentVersion: '0.1.0',
      now: '2026-07-24T12:01:30.000Z',
      platform: 'linux',
      targetVersion: '0.2.1',
    })
    expect(
      database.listUpdateHealthEvents('2026-07-24T14:00:00.000Z'),
    ).toMatchObject([{ lifecycle: 'install-started', targetVersion: '0.2.1' }])
    expect(
      database.reconcilePendingUpdateInstall({
        arch: 'x64',
        currentVersion: '0.2.1',
        now: '2026-07-24T12:02:00.000Z',
        platform: 'linux',
      }),
    ).toMatchObject({ lifecycle: 'install-succeeded', targetVersion: '0.2.1' })
    expect(database.getUpdateState()).toMatchObject({
      pendingAttemptId: null,
      pendingTargetVersion: null,
    })

    database.updateUpdateState({
      pendingAttemptId: 'failed-install',
      pendingTargetVersion: '0.2.2',
    })
    expect(
      database.reconcilePendingUpdateInstall({
        arch: 'x64',
        currentVersion: '0.2.1',
        now: '2026-07-24T12:03:00.000Z',
        platform: 'linux',
      }),
    ).toMatchObject({ lifecycle: 'install-failed', targetVersion: '0.2.2' })
    database.close()
  })

  it('keeps install markers durable when optional health queue writes fail', () => {
    const database = createAideDatabase(':memory:')
    database.updateUpdateState({ healthDisclosureAcknowledged: true })
    const sqlite = (database as unknown as { database: DatabaseSync }).database
    sqlite.exec(`
      CREATE TRIGGER fail_optional_update_health
      BEFORE INSERT ON app_update_health_queue
      BEGIN
        SELECT RAISE(ABORT, 'simulated telemetry failure');
      END;
    `)

    expect(() =>
      database.commitUpdateInstallStart({
        arch: 'x64',
        attemptId: 'durable-install-attempt',
        currentVersion: '0.1.0',
        now: '2026-07-24T12:00:30.123Z',
        platform: 'linux',
        targetVersion: '0.2.1',
      }),
    ).not.toThrow()
    expect(database.getUpdateState()).toMatchObject({
      pendingAttemptId: 'durable-install-attempt',
      pendingTargetVersion: '0.2.1',
    })
    expect(database.listUpdateHealthEvents()).toEqual([])

    expect(
      database.reconcilePendingUpdateInstall({
        arch: 'x64',
        currentVersion: '0.2.1',
        now: '2026-07-24T12:01:45.987Z',
        platform: 'linux',
      }),
    ).toBeNull()
    expect(database.getUpdateState()).toMatchObject({
      pendingAttemptId: null,
      pendingTargetVersion: null,
    })
    expect(database.listUpdateHealthEvents()).toEqual([])
    database.close()
  })

  it('keeps required install marker writes fatal and atomic', () => {
    const database = createAideDatabase(':memory:')
    const sqlite = (database as unknown as { database: DatabaseSync }).database
    sqlite.exec(`
      CREATE TRIGGER fail_required_install_marker
      BEFORE UPDATE ON app_update_state
      WHEN NEW.pending_attempt_id IS NOT NULL
      BEGIN
        SELECT RAISE(ABORT, 'simulated marker failure');
      END;
    `)

    expect(() =>
      database.commitUpdateInstallStart({
        arch: 'x64',
        attemptId: 'required-install-attempt',
        currentVersion: '0.1.0',
        now: '2026-07-24T12:00:30.123Z',
        platform: 'linux',
        targetVersion: '0.2.1',
      }),
    ).toThrow('simulated marker failure')
    expect(database.getUpdateState()).toMatchObject({
      pendingAttemptId: null,
      pendingTargetVersion: null,
    })

    sqlite.exec('DROP TRIGGER fail_required_install_marker;')
    database.updateUpdateState({
      pendingAttemptId: 'required-clear-attempt',
      pendingTargetVersion: '0.2.1',
    })
    sqlite.exec(`
      CREATE TRIGGER fail_required_install_clear
      BEFORE UPDATE ON app_update_state
      WHEN OLD.pending_attempt_id IS NOT NULL
        AND NEW.pending_attempt_id IS NULL
      BEGIN
        SELECT RAISE(ABORT, 'simulated marker clear failure');
      END;
    `)

    expect(() =>
      database.reconcilePendingUpdateInstall({
        arch: 'x64',
        currentVersion: '0.2.1',
        now: '2026-07-24T12:01:45.987Z',
        platform: 'linux',
      }),
    ).toThrow('simulated marker clear failure')
    expect(database.getUpdateState()).toMatchObject({
      pendingAttemptId: 'required-clear-attempt',
      pendingTargetVersion: '0.2.1',
    })
    database.close()
  })

  it('supports project CRUD operations', () => {
    const database = createAideDatabase(':memory:')

    const createdProject = database.createProject({
      defaultBranch: 'main',
      name: 'aide',
      remoteUrl: 'https://github.com/example/aide',
      repoRoot: '/workspace/aide',
    })

    expect(database.listProjects()).toEqual([createdProject])
    expect(database.getProject(createdProject.id)).toEqual(createdProject)

    const updatedProject = database.updateProject(createdProject.id, {
      color: 'violet',
      defaultBranch: 'develop',
      icon: 'sparkles',
      name: 'aide-desktop',
      remoteUrl: null,
    })

    expect(updatedProject).toMatchObject({
      color: 'violet',
      defaultBranch: 'develop',
      id: createdProject.id,
      icon: 'sparkles',
      name: 'aide-desktop',
      remoteUrl: null,
      repoRoot: '/workspace/aide',
    })
    expect(database.getSnapshot().projects).toEqual([updatedProject])

    expect(database.deleteProject(createdProject.id)).toBe(true)
    expect(database.getProject(createdProject.id)).toBeNull()
    expect(database.listProjects()).toEqual([])

    database.close()
  })

  it('stores project setup commands with a monotonically increasing revision', () => {
    const database = createAideDatabase(':memory:')
    const project = database.createProject({
      defaultBranch: 'main',
      name: 'aide',
      remoteUrl: null,
      repoRoot: '/workspace/aide',
    })

    expect(project).toMatchObject({
      setupCommand: null,
      worktreeSetupRevision: 0,
    })

    const configured = database.updateProject(project.id, {
      setupCommand: 'bun install',
    })
    expect(configured).toMatchObject({
      setupCommand: 'bun install',
      worktreeSetupRevision: 1,
    })

    expect(database.updateProject(project.id, { name: 'Aide' })).toMatchObject({
      setupCommand: 'bun install',
      worktreeSetupRevision: 1,
    })
    expect(
      database.updateProject(project.id, { setupCommand: null }),
    ).toMatchObject({
      setupCommand: null,
      worktreeSetupRevision: 2,
    })
    database.close()
  })

  it('persists setup states and cascades them when a workspace is deleted', () => {
    const database = createAideDatabase(':memory:')
    const project = database.createProject({
      defaultBranch: 'main',
      name: 'aide',
      remoteUrl: null,
      repoRoot: '/workspace/aide',
    })
    const workspace = database.createWorkspace({
      branchName: 'main',
      name: 'Main',
      projectId: project.id,
      windowId: null,
      worktreePath: '/workspace/aide',
    })

    const saved = database.saveWorkspaceSetupState({
      attempt: 1,
      commandRequired: true,
      endedAt: null,
      errorSummary: null,
      exitCode: null,
      outputByteLength: 4,
      outputLineCount: 1,
      outputTail: 'done',
      outputTruncated: false,
      projectSetupRevision: 1,
      revision: 0,
      signal: null,
      startedAt: '2026-07-24T15:00:00.000Z',
      state: 'running',
      updatedAt: '2026-07-24T15:00:00.000Z',
      workspaceId: workspace.id,
    })

    expect(saved).toMatchObject({
      outputTail: 'done',
      revision: 1,
      state: 'running',
    })
    expect(database.getWorkspaceSetupRevision()).toBe(1)
    expect(database.deleteWorkspace(workspace.id)).toBe(true)
    expect(database.getWorkspaceSetupState(workspace.id)).toBeNull()
    database.close()
  })

  it('returns null or false when project records are missing', () => {
    const database = createAideDatabase(':memory:')

    expect(database.getProject('missing')).toBeNull()
    expect(database.updateProject('missing', { name: 'ignored' })).toBeNull()
    expect(database.deleteProject('missing')).toBe(false)

    database.close()
  })

  it('supports workspace CRUD operations with project linkage', () => {
    const database = createAideDatabase(':memory:')
    const firstProject = database.createProject({
      defaultBranch: 'main',
      name: 'aide',
      remoteUrl: null,
      repoRoot: '/workspace/aide',
    })
    const secondProject = database.createProject({
      defaultBranch: 'main',
      name: 'aide-next',
      remoteUrl: null,
      repoRoot: '/workspace/aide-next',
    })

    const createdWorkspace = database.createWorkspace({
      branchName: 'feature/nav',
      name: 'Navigation shell',
      projectId: firstProject.id,
      windowId: null,
      worktreePath: '/workspace/aide/.worktrees/navigation',
    })

    expect(database.listWorkspaces()).toEqual([createdWorkspace])
    expect(database.getWorkspace(createdWorkspace.id)).toEqual(createdWorkspace)

    const updatedWorkspace = database.updateWorkspace(createdWorkspace.id, {
      branchName: 'feature/nav-2',
      name: 'Navigation shell v2',
      nameSource: 'manual',
      projectId: secondProject.id,
      windowId: 'window-1',
      worktreePath: '/workspace/aide-next/.worktrees/navigation-2',
    })

    expect(updatedWorkspace).toMatchObject({
      branchName: 'feature/nav-2',
      id: createdWorkspace.id,
      name: 'Navigation shell v2',
      nameSource: 'manual',
      projectId: secondProject.id,
      windowId: 'window-1',
      worktreePath: '/workspace/aide-next/.worktrees/navigation-2',
    })
    expect(database.getSnapshot().workspaces).toEqual([updatedWorkspace])

    expect(database.deleteWorkspace(createdWorkspace.id)).toBe(true)
    expect(database.getWorkspace(createdWorkspace.id)).toBeNull()
    expect(database.listWorkspaces()).toEqual([])

    database.close()
  })

  it('returns null or false when workspace records are missing', () => {
    const database = createAideDatabase(':memory:')

    expect(database.getWorkspace('missing')).toBeNull()
    expect(database.updateWorkspace('missing', { name: 'ignored' })).toBeNull()
    expect(database.deleteWorkspace('missing')).toBe(false)

    database.close()
  })

  it('lets generated names update only untouched workspaces', () => {
    const database = createAideDatabase(':memory:')
    const project = database.createProject({
      defaultBranch: 'main',
      name: 'aide',
      remoteUrl: null,
      repoRoot: '/workspace/aide',
    })
    const workspace = database.createWorkspace({
      branchName: 'feature/nav',
      name: 'feature/nav',
      projectId: project.id,
      windowId: null,
      worktreePath: '/workspace/aide/.worktrees/nav',
    })

    expect(workspace.nameSource).toBe('default')
    expect(
      database.renameWorkspaceIfUnchanged(workspace.id, {
        expectedUpdatedAt: workspace.updatedAt,
        name: 'Navigation polish',
        nameSource: 'generated',
      }),
    ).toMatchObject({ name: 'Navigation polish', nameSource: 'generated' })

    const manuallyRenamed = database.updateWorkspace(workspace.id, {
      name: 'My navigation work',
      nameSource: 'manual',
    })
    expect(
      database.renameWorkspaceIfUnchanged(workspace.id, {
        expectedUpdatedAt: manuallyRenamed?.updatedAt ?? '',
        name: 'Overwrite attempt',
        nameSource: 'generated',
      }),
    ).toBeNull()
    expect(database.getWorkspace(workspace.id)).toMatchObject({
      name: 'My navigation work',
      nameSource: 'manual',
    })

    database.close()
  })

  it('persists the last active project and workspace selection', () => {
    const database = createAideDatabase(':memory:')
    const project = database.createProject({
      defaultBranch: 'main',
      name: 'aide',
      remoteUrl: null,
      repoRoot: '/workspace/aide',
    })
    const workspace = database.createWorkspace({
      branchName: 'feature/nav',
      name: 'Navigation shell',
      projectId: project.id,
      windowId: null,
      worktreePath: '/workspace/aide/.worktrees/navigation',
    })

    database.setActiveSelection({
      paneIdsByWorkspace: { [workspace.id]: 'terminal' },
      projectId: project.id,
      workspaceIdsByProject: { [project.id]: workspace.id },
      workspaceId: workspace.id,
    })

    expect(database.getSnapshot()).toMatchObject({
      lastActivePaneIdsByWorkspace: { [workspace.id]: 'terminal' },
      lastActiveProjectId: project.id,
      lastActiveWorkspaceIdsByProject: { [project.id]: workspace.id },
      lastActiveWorkspaceId: workspace.id,
    })

    database.close()
  })

  it('persists workspace split layouts across relaunches', () => {
    const tempDirectory = mkdtempSync(path.join(tmpdir(), 'aide-layout-db-'))
    const databasePath = path.join(tempDirectory, 'aide.sqlite3')

    try {
      const database = createAideDatabase(databasePath)
      const project = database.createProject({
        defaultBranch: 'main',
        name: 'aide',
        remoteUrl: null,
        repoRoot: '/workspace/aide',
      })
      const workspace = database.createWorkspace({
        branchName: 'feature/layout-tree',
        name: 'Layout shell',
        projectId: project.id,
        windowId: null,
        worktreePath: '/workspace/aide/.worktrees/layout-tree',
      })

      database.saveWorkspaceLayout(workspace.id, {
        rootNodeId: 'root-horizontal',
        nodes: [
          {
            children: ['left-pane', 'nested-vertical'],
            id: 'root-horizontal',
            paneId: null,
            parentId: null,
            sizeWeights: [0.6, 0.4],
            type: 'split-horizontal',
            workspaceId: workspace.id,
          },
          {
            activeViewIndex: 0,
            children: [],
            id: 'left-pane',
            paneId: 'terminal',
            parentId: 'root-horizontal',
            sizeWeights: [],
            type: 'pane',
            viewIds: ['terminal'],
            workspaceId: workspace.id,
          },
          {
            children: ['top-pane', 'bottom-pane'],
            id: 'nested-vertical',
            paneId: null,
            parentId: 'root-horizontal',
            sizeWeights: [0.5, 0.5],
            type: 'split-vertical',
            workspaceId: workspace.id,
          },
          {
            activeViewIndex: 0,
            children: [],
            id: 'top-pane',
            paneId: 'git',
            parentId: 'nested-vertical',
            sizeWeights: [],
            type: 'pane',
            viewIds: ['git'],
            workspaceId: workspace.id,
          },
          {
            activeViewIndex: 0,
            children: [],
            id: 'bottom-pane',
            paneId: 'preview',
            parentId: 'nested-vertical',
            sizeWeights: [],
            type: 'pane',
            viewIds: ['preview'],
            workspaceId: workspace.id,
          },
        ],
      })
      database.close()

      const reopenedDatabase = createAideDatabase(databasePath)
      const snapshot = reopenedDatabase.getSnapshot()

      expect(snapshot.workspaceLayouts[workspace.id]).toEqual({
        nodes: [
          {
            children: ['left-pane', 'nested-vertical'],
            id: 'root-horizontal',
            paneId: null,
            parentId: null,
            sizeWeights: [0.6, 0.4],
            type: 'split-horizontal',
            workspaceId: workspace.id,
          },
          {
            activeViewIndex: 0,
            children: [],
            id: 'left-pane',
            paneId: 'terminal',
            parentId: 'root-horizontal',
            sizeWeights: [],
            type: 'pane',
            viewIds: ['terminal'],
            workspaceId: workspace.id,
          },
          {
            children: ['top-pane', 'bottom-pane'],
            id: 'nested-vertical',
            paneId: null,
            parentId: 'root-horizontal',
            sizeWeights: [0.5, 0.5],
            type: 'split-vertical',
            workspaceId: workspace.id,
          },
          {
            activeViewIndex: 0,
            children: [],
            id: 'top-pane',
            paneId: 'git',
            parentId: 'nested-vertical',
            sizeWeights: [],
            type: 'pane',
            viewIds: ['git'],
            workspaceId: workspace.id,
          },
          {
            activeViewIndex: 0,
            children: [],
            id: 'bottom-pane',
            paneId: 'preview',
            parentId: 'nested-vertical',
            sizeWeights: [],
            type: 'pane',
            viewIds: ['preview'],
            workspaceId: workspace.id,
          },
        ],
        rootNodeId: 'root-horizontal',
        workspaceId: workspace.id,
      })

      reopenedDatabase.close()
    } finally {
      rmSync(tempDirectory, { force: true, recursive: true })
    }
  })

  it('keeps an explicit empty workspace surface state across relaunches', () => {
    const tempDirectory = mkdtempSync(path.join(tmpdir(), 'aide-db-'))
    const databasePath = path.join(tempDirectory, 'aide.sqlite3')

    try {
      const database = createAideDatabase(databasePath)
      const project = database.createProject({
        defaultBranch: 'main',
        name: 'aide',
        remoteUrl: null,
        repoRoot: '/workspace/aide',
      })
      const workspace = database.createWorkspace({
        branchName: 'main',
        name: 'main',
        projectId: project.id,
        windowId: null,
        worktreePath: '/workspace/aide',
      })

      database.saveWorkspaceLayout(workspace.id, {
        nodes: [
          {
            activeViewIndex: 0,
            children: [],
            id: 'legacy-pane',
            paneId: 'terminal',
            parentId: null,
            sizeWeights: [],
            type: 'pane',
            viewIds: ['terminal'],
            workspaceId: workspace.id,
          },
        ],
        rootNodeId: 'legacy-pane',
      })
      database.saveWorkspaceSurfaceState(workspace.id, {
        layouts: {},
        surfaces: [],
      })
      database.close()

      const reopenedDatabase = createAideDatabase(databasePath)
      const snapshot = reopenedDatabase.getSnapshot()

      expect(snapshot.workspaceSurfaces?.[workspace.id]).toEqual([])
      expect(snapshot.surfaceLayouts).toEqual({})
      expect(snapshot.workspaceLayouts[workspace.id]).toEqual({
        nodes: [
          {
            activeViewIndex: 0,
            children: [],
            id: 'legacy-pane',
            paneId: 'terminal',
            parentId: null,
            sizeWeights: [],
            type: 'pane',
            viewIds: ['terminal'],
            workspaceId: workspace.id,
          },
        ],
        rootNodeId: 'legacy-pane',
        workspaceId: workspace.id,
      })

      reopenedDatabase.close()
    } finally {
      rmSync(tempDirectory, { force: true, recursive: true })
    }
  })

  it('persists initialized-empty preview state and cascades it with a workspace', () => {
    const database = createAideDatabase(':memory:')
    const project = database.createProject({
      defaultBranch: 'main',
      name: 'aide',
      remoteUrl: null,
      repoRoot: '/workspace/aide',
    })
    const workspace = database.createWorkspace({
      branchName: 'main',
      name: 'main',
      projectId: project.id,
      windowId: null,
      worktreePath: '/workspace/aide',
    })

    database.saveWorkspacePreviewState({
      activeTabId: null,
      initialized: true,
      revision: 4,
      tabs: [],
      workspaceId: workspace.id,
    })

    expect(database.getWorkspacePreviewState(workspace.id)).toEqual({
      activeTabId: null,
      initialized: true,
      revision: 4,
      tabs: [],
      workspaceId: workspace.id,
    })

    database.deleteWorkspace(workspace.id)
    expect(database.getWorkspacePreviewState(workspace.id)).toBeNull()
    database.close()
  })

  it('tracks catalog and per-workspace surface revisions', () => {
    const database = createAideDatabase(':memory:')
    const initialRevision = database.getSnapshot().catalogRevision
    const project = database.createProject({
      defaultBranch: 'main',
      name: 'aide',
      remoteUrl: null,
      repoRoot: '/workspace/aide',
    })
    const workspace = database.createWorkspace({
      branchName: 'main',
      name: 'main',
      projectId: project.id,
      windowId: null,
      worktreePath: '/workspace/aide',
    })

    database.saveWorkspaceSurfaceState(workspace.id, {
      layouts: {},
      surfaces: [],
    })

    const snapshot = database.getSnapshot()
    expect(snapshot.catalogRevision).toBeGreaterThan(initialRevision ?? 0)
    expect(snapshot.workspaceLayoutRevisions?.[workspace.id]).toBe(1)
    expect(snapshot.workspaceSurfaceRevisions?.[workspace.id]).toBe(1)
    database.close()
  })
})

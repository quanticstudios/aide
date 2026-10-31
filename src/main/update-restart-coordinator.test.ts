import { describe, expect, it, vi } from 'vitest'

import { UpdateRestartCoordinator } from './update-restart-coordinator'

function createCoordinator(
  overrides: {
    activeTerminalSessions?: number
    activeWorkspaceSetups?: number
    revalidate?: () => Promise<boolean>
    identityMatches?: () => Promise<boolean>
    shutdown?: () => Promise<void>
  } = {},
) {
  const shutdown = vi.fn(overrides.shutdown ?? (async () => undefined))
  const markInstallStarted = vi.fn()
  const quitAndInstall = vi.fn()
  const terminateAfterShutdownFailure = vi.fn()
  const terminals = {
    beginQuiescing: vi.fn(() => vi.fn()),
    getActiveSessionCount: () => overrides.activeTerminalSessions ?? 0,
  }
  const setups = {
    beginQuiescing: vi.fn(() => vi.fn()),
    getActiveSetupCount: () => overrides.activeWorkspaceSetups ?? 0,
  }
  const coordinator = new UpdateRestartCoordinator({
    applicationRuntime: { shutdown },
    terminals,
    terminateAfterShutdownFailure,
    updates: {
      markInstallStarted,
      quitAndInstall,
      revalidateDownloadedUpdate: overrides.revalidate ?? (async () => true),
      releaseFileMatchesVerifiedIdentity:
        overrides.identityMatches ?? (async () => true),
    },
    workspaceSetups: setups,
  })

  return {
    coordinator,
    markInstallStarted,
    quitAndInstall,
    setups,
    shutdown,
    terminals,
    terminateAfterShutdownFailure,
  }
}

describe('UpdateRestartCoordinator', () => {
  it('requires an explicit confirmation while work is active', async () => {
    const { coordinator, shutdown, quitAndInstall } = createCoordinator({
      activeTerminalSessions: 2,
      activeWorkspaceSetups: 3,
    })

    await expect(coordinator.requestRestart(false)).resolves.toEqual({
      activeTerminalSessions: 2,
      activeWorkspaceSetups: 3,
      confirmationRequired: true,
      restarting: false,
    })
    expect(shutdown).not.toHaveBeenCalled()
    expect(quitAndInstall).not.toHaveBeenCalled()
  })

  it('proceeds without confirmation when there is no active work', async () => {
    const { coordinator, markInstallStarted, quitAndInstall, shutdown } =
      createCoordinator()

    await expect(coordinator.requestRestart(false)).resolves.toMatchObject({
      confirmationRequired: false,
      restarting: true,
    })

    expect(shutdown).toHaveBeenCalledOnce()
    expect(shutdown).toHaveBeenCalledWith('update-install')
    expect(markInstallStarted).toHaveBeenCalledOnce()
    expect(quitAndInstall).toHaveBeenCalledOnce()
  })

  it('lets a confirmed restart quiesce and gracefully close pre-existing work', async () => {
    const { coordinator, quitAndInstall, shutdown } = createCoordinator({
      activeTerminalSessions: 1,
      activeWorkspaceSetups: 1,
    })

    await expect(coordinator.requestRestart(true)).resolves.toMatchObject({
      confirmationRequired: false,
      restarting: true,
    })

    expect(shutdown).toHaveBeenCalledOnce()
    expect(quitAndInstall).toHaveBeenCalledOnce()
  })

  it('asks for confirmation when work appears in the pre-quiesce race', async () => {
    let activeTerminalSessions = 0
    const { coordinator, quitAndInstall, shutdown, terminals } =
      createCoordinator()
    terminals.getActiveSessionCount = () => activeTerminalSessions
    terminals.beginQuiescing.mockImplementation(() => {
      activeTerminalSessions = 1
      return vi.fn(() => {
        activeTerminalSessions = 0
      })
    })

    await expect(coordinator.requestRestart(false)).resolves.toMatchObject({
      activeTerminalSessions: 1,
      confirmationRequired: true,
      restarting: false,
    })
    expect(shutdown).not.toHaveBeenCalled()
    expect(quitAndInstall).not.toHaveBeenCalled()
  })

  it('quiesces, rechecks, validates, then shuts down and installs exactly once', async () => {
    const { coordinator, setups, shutdown, quitAndInstall, terminals } =
      createCoordinator()

    await expect(coordinator.requestRestart(true)).resolves.toMatchObject({
      confirmationRequired: false,
      restarting: true,
    })

    expect(terminals.beginQuiescing).toHaveBeenCalledOnce()
    expect(setups.beginQuiescing).toHaveBeenCalledOnce()
    expect(shutdown).toHaveBeenCalledOnce()
    expect(quitAndInstall).toHaveBeenCalledOnce()

    await coordinator.requestRestart(true)
    expect(shutdown).toHaveBeenCalledOnce()
    expect(quitAndInstall).toHaveBeenCalledOnce()
  })

  it('never shuts down or installs when fresh validation or file identity fails', async () => {
    const invalidRelease = createCoordinator({ revalidate: async () => false })
    await expect(
      invalidRelease.coordinator.requestRestart(true),
    ).rejects.toThrow('Update can no longer be installed safely.')
    expect(invalidRelease.shutdown).not.toHaveBeenCalled()
    expect(invalidRelease.quitAndInstall).not.toHaveBeenCalled()

    const replacedFile = createCoordinator({
      identityMatches: async () => false,
    })
    await expect(replacedFile.coordinator.requestRestart(true)).rejects.toThrow(
      'Downloaded update changed before installation.',
    )
    expect(replacedFile.shutdown).toHaveBeenCalledOnce()
    expect(replacedFile.quitAndInstall).not.toHaveBeenCalled()
    expect(replacedFile.terminateAfterShutdownFailure).toHaveBeenCalledOnce()
  })

  it('terminates instead of installing when runtime shutdown rejects after marking install', async () => {
    const failedShutdown = createCoordinator({
      shutdown: async () => {
        throw new Error('managed session did not stop')
      },
    })

    await expect(
      failedShutdown.coordinator.requestRestart(true),
    ).rejects.toThrow('managed session did not stop')
    expect(failedShutdown.markInstallStarted).toHaveBeenCalledOnce()
    expect(failedShutdown.shutdown).toHaveBeenCalledOnce()
    expect(failedShutdown.quitAndInstall).not.toHaveBeenCalled()
    expect(failedShutdown.terminateAfterShutdownFailure).toHaveBeenCalledOnce()
  })
})

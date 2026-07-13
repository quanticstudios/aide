# Linux Production Alpha

## Problem Statement

Aide's core workspace, preview, terminal, Git, and managed-agent flows work, but
the repository is not yet safe to distribute. Dependencies are ranged and carry
known high-severity advisories; CI, recovery, diagnostics, packaging, and
multi-window ownership are incomplete. The editor and per-turn review loop also
remain unfinished.

## Solution

Ship a controlled Linux x64 private alpha whose dependency graph is exactly
reproducible, whose core supervision loop is complete, and whose AppImage and
DEB artifacts can recover from failures without silently losing user state.
Beads remain authoritative and Linear mirrors roadmap status.

## User Stories

1. As a developer, I can install Aide on Linux and reopen the same projects and
   windows without data loss.
2. As a developer, I can run Claude or Codex using only models and capabilities
   that the installed provider actually supports.
3. As a developer, I can review each agent turn, open its files, make a small
   edit, and save without overwriting an external change.
4. As a developer, I can detach one workspace to another window and trust that
   terminals, providers, previews, notifications, and navigation retain one
   authoritative owner.
5. As a tester, I can diagnose a crash, export a redacted local support bundle,
   and recover or reset a damaged database explicitly.
6. As a maintainer, I can reproduce a release from exact, quarantined versions
   and block known high or critical dependency findings.

## Navigation and Interaction Model

- The hierarchy remains Project -> Workspace -> Surface -> Pane/View.
- The main window may host multiple workspaces; a detached window owns exactly
  one workspace. Selecting a workspace already owned elsewhere focuses its
  existing window.
- Reattaching returns the workspace to the main window without terminating
  main-owned terminal or provider sessions.
- File and status actions navigate to the exact owning workspace and pane.
- Settings and onboarding use ordinary panes/dialogs and preserve all existing
  project-scoped workspace and keyboard contracts.

## Implementation Decisions

- Pin Node 24.17.0, Bun 1.3.14, and every direct dependency exactly. Enforce a
  seven-day package release age and frozen `bun.lock` installs.
- Electron 43, electron-vite 5, and Vite 7 form the supported build matrix;
  Vite 8 waits for electron-vite support.
- Version provider-capability, window-ownership, settings, and diagnostics
  snapshots/events. Main remains authoritative and renderer hydration
  subscribes before fetching snapshots.
- Workspace file writes are UTF-8, workspace-contained, size-limited, atomic,
  and revision checked.
- Per-turn patch bodies live with the managed session and survive renderer
  reload, but are not persisted beyond app exit.
- Logs remain local and exclude prompts, terminal output, patches, credentials,
  environment values, and unredacted home paths.
- Linux artifacts are x64 AppImage and DEB. Releases are manual, checksummed,
  SBOM-backed, and SSH-signed. There is no auto-updater in this alpha.

## Testing Decisions

- Every Bead uses vertical TDD and runs the locked React Doctor, Biome, node
  tests, build, and relevant Electron scenarios.
- CI performs a fresh frozen install, dependency-policy check, high/critical
  audit, unit/integration checks, Xvfb Electron E2E, and packaged-artifact smoke.
- Final acceptance covers provider discovery, editor conflicts, per-turn diffs,
  detach/reattach/restore, corrupt-state recovery, offline/CSP security, native
  PTY loading, accessibility, and a Linux soak.

## Out of Scope

- macOS, Windows, Linux ARM64, RPM, and store distribution
- automatic updates and remote telemetry
- cloud sync, authentication, plugins, Archive, and Comments
- LSP/editor parity, full browser automation, and advanced preview tooling

## Further Notes

"Production grade" in this PRD means a controlled Linux private alpha. It does
not claim risk-free software or cross-platform production readiness.

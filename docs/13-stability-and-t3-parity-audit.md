# Stability and T3 Code Parity Audit

Audit date: 2026-07-13

Reference checkout: `pingdotgg/t3code` at `c1ec1915fc16f3dc1ec5d47d9a97f6210a574526`

## Executive summary

Aide is a real Electron application, not only the build plan described by the
README. Its core spatial shell works: a Git repository can be imported, a
workspace can own multiple full-size pane destinations, layouts persist in
SQLite, shell terminals run through a PTY, Git status and diffs render, local
preview targets load, and Claude/Codex sessions run through managed backends.

It is still an alpha. The most important gaps are lifecycle and state-integrity
gaps rather than missing polish:

1. app identity depends on the launch directory because the database defaults
   to `process.cwd()/.aide.sqlite3`;
2. rapid layout commands can race because async mutations are launched without
   ordering and are based on captured snapshots;
3. provider models and capabilities are hardcoded instead of discovered;
4. managed-session ownership is partly tied to renderer mounting and shutdown
   cleanup is not awaited consistently;
5. every Linux launch disables hardware acceleration and GPU sandboxing;
6. the initial renderer payload is very large;
7. core UI paths contain invalid nested interactive controls;
8. Editor and Chat are still placeholders, while preview state is not durable.

The first stabilization pass also found two reproduced defects in managed
provider startup and four stale end-to-end tests. Those defects are fixed in
the associated implementation change; regression tests now cover failed
provider creation, a missing Codex executable, renderer reload reattachment,
and terminal restart after shell exit.

## What this project is

The durable domain hierarchy is:

```text
Project
  Workspace (normally a Git worktree)
    Surface (a full-size horizontal destination)
      Layout (a split tree)
        Pane
          View
```

The public planning documents use `Project -> Workspace -> Layout -> Pane`.
The implementation has since added `Surface` and pane-local `View` concepts to
support the spatial navigation model.

The process boundary is sound in principle:

- Electron main owns SQLite, Git, PTYs, provider processes, executable probes,
  editor launching, and runtime activity aggregation.
- The preload exposes a typed IPC API with context isolation enabled and Node
  integration disabled.
- React renders navigation and pane state.
- Shared TypeScript modules define IPC, persistence, layout, terminal, managed
  session, and activity contracts.

The project resembles T3 Code in product intent, but it is not a source fork.
Aide has its own workspace/surface/pane shell and its own persistence model.
Current T3 Code is a much larger monorepo with a server, WebSocket protocol,
web and mobile clients, provider registry, durable orchestration snapshots,
and multiple provider drivers. Copying its tree or merging its Git history
would overwrite Aide's product-specific architecture. Parity work must port
contracts and behaviors in vertical slices.

## Required product journeys

These are the minimum journeys that must remain continuously testable before
more feature work is safe.

### Repository and workspace

1. Open a valid Git repository.
2. Reject a non-Git folder with a useful inline error.
3. Reopen the app from any launch directory and see the same projects.
4. Create or attach a worktree without corrupting an existing worktree.
5. Navigate workspaces and preserve the active surface, pane, and view.
6. Survive rapid create/split/resize/close commands without losing layout.

Current state: 1, 2, and ordinary navigation are covered. Stable app storage
and concurrent layout mutation safety are not.

### Agent session

1. Start Claude or Codex only when its executable/runtime is available.
2. Show startup, working, approval, user-input, completion, error, and
   interruption states from structured provider events.
3. Resolve approval and structured user-input requests.
4. Keep the session alive across navigation and renderer reload.
5. Reconnect after a window/app interruption when the provider supports it.
6. Fail promptly and allow retry when startup fails.
7. Never route a stale event from an old provider generation into a new turn.
8. Show exactly which model and capabilities are actually supported.

Current state: 1-3 work for the implemented provider adapters; renderer reload
reattachment is now covered; startup retry is fixed. Durable app-level resume,
generation-aware stale-event rejection, and capability discovery remain open.

### Terminal

1. Start in the workspace worktree.
2. Preserve input focus through pane navigation.
3. Preserve a running PTY while its pane is off-screen.
4. Keep the pane after a shell exits and offer a restart action.
5. Kill only on explicit pane/session deletion or bounded app shutdown.

Current state: 1-3 work. This audit fixed 4, which previously deleted the pane
on every PTY exit. App shutdown ownership still needs hardening.

### Git and preview

1. Refresh status and distinguish staged, unstaged, and untracked files.
2. Render the selected file's structured diff.
3. Preserve worktree metadata during branch operations.
4. Load only allowed local preview targets and expose load failures.
5. Persist selected preview targets and reconnect after reload.

Current state: Git status/diff and local preview loading work. Git has no
per-agent-turn change grouping yet. Preview targets are renderer-memory state
and disappear on reload.

### Recovery and diagnostics

1. A failed child process must reject promptly without crashing Electron.
2. Closing the last window and quitting must await bounded provider cleanup,
   PTY cleanup, and database close on every platform.
3. Renderer exceptions, console errors, failed IPC requests, and child-process
   exits must be visible in diagnostics and fail smoke tests where appropriate.
4. An interrupted write must not corrupt or silently roll back newer state.

Current state: the reproduced Codex `ENOENT` crash/hang is fixed. Shutdown,
diagnostic capture, and mutation ordering remain incomplete.

## Findings

The labels below deliberately distinguish reproduced failures from source-code
risks. A source risk is not presented as a user-reproduced incident.

### P0: managed provider startup could hang, crash, and become unretryable

Status: reproduced and fixed.

`ManagedSessionManager.createSession` inserted a session before awaiting
backend startup, then retained it when startup rejected. A retry returned the
dead snapshot instead of invoking the backend again. The Codex app-server child
also had no `error` listener, so a missing executable emitted an unhandled
`ENOENT`; pending requests remained alive until their timeout.

Regression coverage now proves that:

- a generic provider start failure removes the failed session;
- backend cleanup is attempted without replacing the original error;
- a missing Codex executable rejects without an unhandled process error;
- pending requests reject when the child errors, exits, or is closed;
- retry reaches startup again.

Tracking: `aide-bs3`.

### P0: application storage is tied to `process.cwd()`

Status: source-proven defect; open.

The default database path is constructed during module initialization as
`process.cwd()/.aide.sqlite3`. This means the same installed application can
show a different project list depending on how it was launched. A packaged app
may also choose an unexpected or unwritable directory. `app.getPath('userData')`
cannot be used safely until Electron is ready, so fixing this requires moving
service construction behind application initialization and defining a one-time
migration/conflict rule.

Tracking: `aide-3f2`.

### P0: layout writes can race and overwrite newer state

Status: source-proven concurrency risk; open.

Split, close, resize, add-view, and other handlers call an async layout mutation
with `void`. Each mutation derives its next state from the render's captured
navigation snapshot, persists a whole surface/layout snapshot, and then replaces
renderer storage state with the returned database snapshot. Two rapid commands
can therefore start from the same revision and finish in reverse order. The
older completion can resurrect a closed pane or discard a newer split/resize.

The safe choices are a per-workspace command queue or optimistic revisions with
conflict/retry. A deterministic concurrency test must precede the fix.

Tracking: `aide-d6d`.

### P0: provider model menus are static

Status: confirmed T3 parity gap; open.

Aide hardcodes both provider catalogs in `ModelSelector.tsx`. Its Claude default
is Sonnet 4.6. Current T3 Code defaults Claude to Sonnet 5, version-gates Fable
5 and Opus 4.8/4.7, normalizes legacy aliases, and describes model-specific
reasoning/context/fast-mode capabilities. T3 asks Codex app-server for
`model/list` and maps the returned reasoning levels and service tiers.

Simply adding current slugs to Aide's array would be unsafe: older local Claude
or Codex installations would be offered models they cannot run, and the list
would go stale again. The correct port is provider capability discovery plus a
fallback explanation for saved selections that are no longer available.

Tracking: `aide-nbn`.

### P1: managed-session lifecycle has no durable ownership boundary

Status: partial risk; renderer reload was tested and currently reattaches.

The main process owns live sessions, which is good. The renderer retrieves main
process snapshots after reload, and a new headless regression proves that this
path currently restores an in-flight fake session. However,
`ManagedAgentPane` also closes its session in effect cleanup. Any future
pane-local view switch or conditional unmount can therefore terminate work even
though the durable domain object still exists.

Shutdown is also asymmetric: non-macOS `window-all-closed` starts asynchronous
managed cleanup without awaiting it, immediately kills terminals and closes the
database, then quits. macOS keeps the process alive and has no matching
`before-quit` cleanup path in this module.

Current T3 Code separates persisted orchestration snapshots, live provider
session ownership, client subscriptions, reconnection, and stale-session
reaping. Aide does not need T3's entire server, but it does need that ownership
model: explicit pane deletion terminates; transient renderer absence does not;
app quit performs bounded awaited cleanup.

Tracking: `aide-aei`.

### P1: Linux always runs in software rendering mode

Status: source-proven performance and security defect; open.

Every Linux launch sets llvmpipe, disables hardware acceleration, disables GPU
and GPU compositing, disables the GPU sandbox, and selects SwiftShader. That may
make one problematic compositor or CI environment stable, but it penalizes all
Linux users with higher CPU usage, worse animations/terminal rendering, and a
weaker sandbox configuration.

Software rendering should be an explicit diagnostic flag or a fallback after a
known GPU initialization failure. Headless tests can continue to set their own
CI-safe environment.

Tracking: `aide-twp`.

### P1: renderer startup payload is excessive

Status: measured build output; open.

The audited production build emitted an approximately 5.6 MB renderer entry
chunk, approximately 509 KB of CSS, and hundreds of Shiki language/theme chunks.
Monaco, Git diff rendering, syntax grammars/themes, and large icon catalogs
should not be part of the core shell's startup path. Pane renderers should be
lazy boundaries and code highlighting should request only the languages and
themes required by an opened diff/editor.

Tracking: `aide-7tr`.

### P1: terminal exit deleted the pane

Status: reproduced from the event path and fixed.

`TerminalPane` previously called the workspace `onClosePane` callback for any
PTY `exit` event. An intentional `exit`, a shell crash, or a command-mode process
completion therefore removed the user's layout destination. The pane now stays
present, reports the exit code, and offers `Restart terminal`; a headless test
covers exit and restart.

Tracking: `aide-uqs`.

### P1: invalid nested controls damage keyboard and accessibility behavior

Status: observed in headless accessibility snapshots; open.

Examples include the model row button containing a favorite button, pane tabs
containing close buttons, and tooltip wrappers that expose an extra button role
around a real button. Browser accessibility snapshots show duplicated roles and
compound names. The original managed-session E2E test also could not address the
icon-only Send button because it had no accessible name; this audit added one.

The remaining controls should be restructured, not patched only with selectors.
Smoke coverage should also capture renderer `pageerror` and critical console
errors so React invalid-DOM warnings cannot silently ship.

React Doctor scored the audited renderer 65/100, with two errors and 32
warnings across 12 files. This pass added a global reduced-motion fallback,
resolving one error. The other error flags slash-menu selection reset in an
effect; it should be handled with the larger managed-pane state cleanup rather
than changed mechanically. The report also confirms concentrated state/effect
complexity in `App`, `ManagedAgentPane`, `GitPane`, and workspace modals.

Tracking: `aide-5gj`.

### P1: the end-to-end gate had drifted from the product

Status: reproduced and fixed.

Four of twelve tests failed at baseline. The product had renamed “Create
workspace” to “New workspace,” consolidated Claude/Codex destinations under
“Agent,” replaced raw Git diff text with a structured renderer, shortened
sidebar activity labels, and removed a private managed-state test ID. The tests
still asserted the old UI. These were test-contract failures, but they made the
entire smoke gate untrustworthy and obscured real regressions.

The tests now use user-facing roles/names and rendered behavior. The managed
session test no longer depends on a removed implementation-only state node.

Tracking: `aide-uhi`.

### P2: Editor and Chat are not products yet

Status: known incomplete scope.

Editor and Chat pane types resolve to placeholder views. Monaco is installed,
but there is no complete workspace-relative open/save/dirty-state journey. The
existing `readProjectFile` IPC handler is rooted at `process.cwd()` rather than
the active workspace, which must be corrected as part of the editor open-path
work. Chat is represented by managed Agent panes rather than a durable thread
model with history/search/resume.

Tracking: `aide-k8d.9`, `aide-k8d.10`, and the Phase 3 epic.

### P2: preview and Git need agent-aware durability

Status: confirmed feature gap.

Preview targets and selection live in React state rather than durable workspace
surface state. Git renders the current worktree status/diff but does not group
changes by agent turn. Current T3 Code's per-turn diff behavior is a high-value
reference because it answers the central question, “what did that agent turn
change?” without requiring a full editor.

Tracking: `aide-1se`; preview persistence needs its own vertical-slice ticket
when that work is scheduled.

### P2: the root coordinator is a change-risk hotspot

Status: architectural observation.

`App.tsx` is roughly 1,600 lines and coordinates boot, persistence snapshots,
project/workspace creation, spatial navigation, pane mutations, preview state,
sidebar state, command palette state, and IPC events. The issue is not line count
alone: unrelated async state machines share captured snapshots and callback
dependency graphs. After the P0 mutation/lifecycle fixes, extract deep modules
around boot/storage synchronization, workspace layout commands, runtime
activity, and preview targets. Do not perform a cosmetic component split first.

## What changed in current T3 Code

The following T3 behaviors are relevant to Aide. They are ordered by product
value, not by ease of copying.

| Current T3 behavior | Aide state | Recommended action |
| --- | --- | --- |
| Provider registry with server-owned live sessions | Separate main-process adapters, but renderer-coupled close behavior | Port ownership contract and bounded reaper |
| Durable orchestration snapshots before live sync | Main snapshots exist; turn/history durability is limited | Add persisted session/thread snapshots and hydrate before events |
| Codex `model/list` capability discovery | Hardcoded Codex array | Port directly through typed main/preload IPC |
| Version-gated Claude model capabilities | Hardcoded Claude array/default | Probe version and expose compatible descriptors |
| Provider/model option migration and aliases | No durable normalized option schema | Add schema/version migration before expanding controls |
| Generation-aware event routing and stale-event diagnostics | Session-id filtering only in renderer | Add provider generation/turn identity in main |
| Pending approval/input priority over running/completed | Aide has a priority table and compact pills | Keep; align tests and add plan-ready/unseen semantics only if product needs them |
| HTTP snapshot followed by live sync/reconnect | Electron IPC snapshots followed by event subscriptions | Formalize revision/watermark to close the subscribe race |
| Per-turn diff viewer | Worktree-level Git diff only | Implement existing `aide-1se` before full editor |
| Chat scroll anchoring and composer provider state | Managed prompt UI is pane-local and simpler | Port only after durable thread model exists |
| Web, desktop, iOS, and Android clients | Electron desktop only by product decision | Do not port; this is outside Aide's current scope |
| Cursor, OpenCode, and Grok providers | Claude and Codex only | Defer until the two existing adapters are reliable and discoverable |

## Recommended execution order

### Stabilization gate

The repository should not begin another broad UI development burst until all
of these are true:

1. `bun run test:node`, `bun run check`, `bun run build`, and the full headless
   Electron suite pass from a clean checkout.
2. Failed provider startup and missing executables are prompt and retryable.
3. Terminal exit is recoverable without layout deletion.
4. App state uses a stable user-data path.
5. Layout mutations have an ordering or revision guarantee.

### Provider parity

1. Define a shared provider/model capability contract.
2. Add Codex `model/list` discovery and fallback behavior.
3. Add Claude version probing and compatible built-in descriptors.
4. Persist normalized model options and aliases.
5. Add provider generation identifiers and stale-event rejection.
6. Make session snapshot, reconnect, explicit close, and reaping semantics
   durable and independently testable.

### Product completeness

1. Implement per-turn agent diffs.
2. Persist preview targets and selected target.
3. Complete workspace-relative editor open/save/dirty state.
4. Add durable conversation history only after the session snapshot contract is
   stable.

### Performance and usability

1. Restore hardware acceleration by default with a software fallback switch.
2. Lazy-load heavyweight pane renderers, Monaco, Shiki, and icon assets.
3. Remove nested interactive controls and add accessibility/console smoke gates.
4. Decompose the root coordinator along state-machine boundaries after the
   concurrency contracts are fixed.

## Explicit non-goals for this parity pass

- Do not merge or copy the T3 Code repository wholesale.
- Do not add T3's server, mobile applications, authentication, or cloud sync.
- Do not add more providers before Claude and Codex discovery/lifecycle work.
- Do not build a full IDE or browser.
- Do not hide unavailable models by continually editing another static array.
- Do not refactor the full renderer before reproducing state races with tests.

## Verification record

Baseline before fixes:

- node/Vitest suite: 212 tests passed;
- typecheck and production build: passed;
- headless Electron suite: 8 passed, 4 failed due to stale UI contracts;
- renderer entry chunk: approximately 5.6 MB;
- CSS output: approximately 509 KB.

Final stabilization gate:

- raw `bun test` compatible subset: 188 tests passed;
- authoritative `bun run test` Node/Vitest suite: 214 tests passed;
- Biome check: passed;
- typecheck and production build: passed;
- headless Electron suite: 14 tests passed;
- React Doctor: 68/100; one remaining error and 32 warnings are documented
  above (its dead-code sub-check failed non-fatally).

Generated Playwright result files are not product source and are not committed
as evidence.

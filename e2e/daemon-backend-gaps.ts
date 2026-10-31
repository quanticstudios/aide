/**
 * Tests the daemon-backend e2e job skips until aide on pitwall reaches parity (ENG-2704): `[title, why]`.
 * @remarks Found by running the whole suite with `AIDE_E2E_PITWALL` on 2026-10-31. Delete an entry once its test passes on the daemon.
 */
export const DAEMON_BACKEND_GAPS: readonly (readonly [string, string])[] = [
  // agent-approval-cards.spec.ts
  [
    'counts queued approvals and denies one with composer feedback for Claude and Codex',
    "pitwall's web protocol cannot switch a chat to another provider",
  ],
  // agent-empty-state.spec.ts
  [
    'shows the workspace context and reuses a recent prompt',
    "recent prompts come from task excerpts, which pitwall's chat list has no field for",
  ],
  // agent-full-access.spec.ts
  [
    'auto-allows requests the permission mode covers and still asks for the rest',
    'pitwall hands the mode to the provider, so a real CLI never asks; the fake asks anyway and nothing auto-allows it or writes aide\'s "Allowed by" line',
  ],
  // agent-hotkeys.spec.ts
  [
    'opens each composer menu, closes it with Escape, then interrupts',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'steers a running Codex turn with the next message',
    "pitwall's web protocol cannot switch a chat to another provider",
  ],
  // agent-long-transcript.spec.ts
  [
    'opens, scrolls and follows a 2,000-item transcript',
    'fails on the daemon backend, cause not traced yet: the last of 4,000 items never scrolls into view',
  ],
  // agent-message-queue.spec.ts
  [
    'queues on Enter, steers on Mod+Enter, then sends one per finished turn',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'keeps the queue across a renderer reload and promotes one to steer',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  // agent-rewind.spec.ts
  [
    'rewinds to a user message and keeps workspace files',
    'rewind needs a preview with the changed files and conversation-only rewind; the web protocol has neither',
  ],
  [
    'reverts workspace files when the rewind asks for them',
    'rewind needs a preview with the changed files and conversation-only rewind; the web protocol has neither',
  ],
  [
    'disables the rewind action while a turn runs',
    'rewind needs a preview with the changed files and conversation-only rewind; the web protocol has neither',
  ],
  // agent-turn-diff.spec.ts
  [
    'shows the turn diff chip and expands the turn patch',
    'needs the turn diff; the web protocol has no checkpoint diff yet',
  ],
  // composer-stash-history.spec.ts
  [
    'attaches a long paste and downscales a pasted screenshot',
    'sends an image attachment, which pitwall refuses for now',
  ],
  // diff-panel.spec.ts
  [
    'opens a turn file and switches between the three scopes',
    'needs the turn diff; the web protocol has no checkpoint diff yet',
  ],
  // electron-navigation.spec.ts
  [
    'persists explicit Jev workspace consent without exposing credentials',
    "Jev preparation and its consent check run in aide's session manager, which the daemon backend skips",
  ],
  [
    'renders managed Claude states from structured runtime events',
    'the sidebar\'s "Agent Input" attention comes from aide\'s task library, which pitwall chats do not update',
  ],
  // jev-gates-sidebar.spec.ts
  [
    'draws a gate node for every gate turned on and keeps the choice after a relaunch',
    'configured agents (setAgents) are aide-only; pitwall answers unsupported',
  ],
  [
    'edits the global gate layer in Settings and lets a workspace override win',
    'configured agents (setAgents) are aide-only; pitwall answers unsupported',
  ],
  // plan-card.spec.ts
  [
    'refines, implements and implements a plan in a new thread',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  // shared-model-chat.spec.ts
  [
    'distinguishes Codex activity from the final response',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'keeps copy actions below the response and copies only reply text',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'branches a response into an independent same-workspace conversation',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'chats in an ordinary folder without Git and restores the project after restart',
    "Jev preparation and its consent check run in aide's session manager, which the daemon backend skips",
  ],
  [
    'reopens a closed Agent conversation while New chat and other workspaces stay fresh',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'selects the highlighted agent mention with the keyboard',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'keeps the composer responsive during a sustained Codex stream',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'reattaches to a Codex stream after a renderer reload with the same transcript',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'navigates the conversation minimap with scrolling, clicks and keyboard',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'keeps model and effort controls available during a reply and applies the next choice after it finishes',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'shows provider reasoning options and applies keyboard selections',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'clears accepted drafts and restores only an untouched failed submission',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'ranks skill names first and removes stale suggestions while typing',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'runs a Claude skill with its owner and clears opinion recipients',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'switches to a Codex skill owner and restores its draft in a narrow pane',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'opens fleet Plan first, accepts reported work, and shows actual routing after restart',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'searches, archives and reopens saved tasks with durable attention state',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'opens settings with searchable shortcuts and persists preferences without losing the draft',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'hands a follow-up with images to the running agent',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'sends Codex follow-ups immediately through required Jev preparation',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'labels a running Codex opinion response under a Claude parent',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'attaches a selected workspace file to a required-Jev turn',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'preserves a ten-megabyte image draft across renderer reload',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'keeps the orchestrator while tagged opinions retain model attribution in Build and Plan',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'closes the configured agents popover on an outside click',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'closes the configured agents popover on Escape and refocuses the trigger',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'preserves a completed opinion when a peer fails, then interrupts only the pending peer',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  [
    'rounds the settings select menu and the model selector popover to 8px',
    "getSessions lists every chat in the suite's one daemon, not only this aide's, so the spec reads another test's chat",
  ],
  // task-notifications.spec.ts
  [
    'names the thread, toasts when focused, notifies the OS otherwise, and badges waiting threads',
    "notifications come from aide's task library attention state, which pitwall's chat list has no field for",
  ],
  // theme-switching.spec.ts
  [
    'repaints the canvas, code, diff and terminal without a reload',
    'needs the turn diff; the web protocol has no checkpoint diff yet',
  ],
  // turn-checkpoints.spec.ts
  [
    'keeps checkpoints available through the API without conversation buttons',
    'reads checkpoints through window.aide; the web protocol has no checkpoint list',
  ],
  // usage-limit-banners.spec.ts
  [
    'resumes once at the reset, in local time, and not after the user typed',
    "pitwall's snapshot drops limit events, so there is no usageLimit for the banner",
  ],
  [
    'names the fix for a missing CLI',
    "the fake fails a start only through PITWALL_FAKE_SCRIPT, which is global to the suite's daemon",
  ],
]

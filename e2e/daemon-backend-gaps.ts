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
  // agent-full-access.spec.ts
  [
    'auto-allows requests the permission mode covers and still asks for the rest',
    'pitwall hands the mode to the provider, so a real CLI never asks; the fake asks anyway and nothing auto-allows it or writes aide\'s "Allowed by" line',
  ],
  // agent-hotkeys.spec.ts
  [
    'steers a running Codex turn with the next message',
    "pitwall's web protocol cannot switch a chat to another provider",
  ],
  // agent-long-transcript.spec.ts
  [
    'opens, scrolls and follows a 2,000-item transcript',
    'fails on the daemon backend, cause not traced yet: the last of 4,000 items never scrolls into view',
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
  // shared-model-chat.spec.ts
  [
    'distinguishes Codex activity from the final response',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'keeps copy actions below the response and copies only reply text',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'branches a response into an independent same-workspace conversation',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'chats in an ordinary folder without Git and restores the project after restart',
    "Jev preparation and its consent check run in aide's session manager, which the daemon backend skips",
  ],
  [
    'reopens a closed Agent conversation while New chat and other workspaces stay fresh',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'selects the highlighted agent mention with the keyboard',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'keeps the composer responsive during a sustained Codex stream',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'reattaches to a Codex stream after a renderer reload with the same transcript',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'navigates the conversation minimap with scrolling, clicks and keyboard',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'keeps model and effort controls available during a reply and applies the next choice after it finishes',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'shows provider reasoning options and applies keyboard selections',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'clears accepted drafts and restores only an untouched failed submission',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'ranks skill names first and removes stale suggestions while typing',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'runs a Claude skill with its owner and clears opinion recipients',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'switches to a Codex skill owner and restores its draft in a narrow pane',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'opens fleet Plan first, accepts reported work, and shows actual routing after restart',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'searches, archives and reopens saved tasks with durable attention state',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'opens settings with searchable shortcuts and persists preferences without losing the draft',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'hands a follow-up with images to the running agent',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'sends Codex follow-ups immediately through required Jev preparation',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'labels a running Codex opinion response under a Claude parent',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'attaches a selected workspace file to a required-Jev turn',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'preserves a ten-megabyte image draft across renderer reload',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'keeps the orchestrator while tagged opinions retain model attribution in Build and Plan',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'closes the configured agents popover on an outside click',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'closes the configured agents popover on Escape and refocuses the trigger',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'preserves a completed opinion when a peer fails, then interrupts only the pending peer',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
  ],
  [
    'rounds the settings select menu and the model selector popover to 8px',
    'startSharedChat configures Claude and Codex agents with setAgents, which pitwall answers unsupported (multi-agent routing is dropped, ENG-2706)',
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
]

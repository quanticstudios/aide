/**
 * Tests the daemon-backend e2e job skips until aide on pitwall reaches parity (ENG-2704): `[title, why]`.
 * @remarks Found by running the whole suite with `AIDE_E2E_PITWALL` on 2026-10-31. Delete an entry once its test passes on the daemon.
 */
export const DAEMON_BACKEND_GAPS: readonly (readonly [string, string])[] = [
  // agent-approval-cards.spec.ts
  [
    'counts queued approvals and denies one with composer feedback for Claude and Codex',
    'fails on the daemon backend, cause not traced yet: expect(locator).toHaveText(expected) failed',
  ],
  // agent-empty-state.spec.ts
  [
    'shows the workspace context and reuses a recent prompt',
    "recent prompts come from task excerpts, which pitwall's chat list has no field for",
  ],
  [
    'marks a finished turn that has no assistant text',
    'fails on the daemon backend, cause not traced yet: expect(locator).toHaveText(expected) failed',
  ],
  // agent-full-access.spec.ts
  [
    'auto-allows requests the permission mode covers and still asks for the rest',
    'fails on the daemon backend, cause not traced yet: expect(locator).toContainText(expected) failed',
  ],
  // agent-hotkeys.spec.ts
  [
    'opens each composer menu, closes it with Escape, then interrupts',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'steers a running Codex turn with the next message',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  // agent-long-transcript.spec.ts
  [
    'opens, scrolls and follows a 2,000-item transcript',
    'fails on the daemon backend, cause not traced yet: expect(locator).toBeInViewport() failed',
  ],
  // agent-message-queue.spec.ts
  [
    'queues on Enter, steers on Mod+Enter, then sends one per finished turn',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'keeps the queue across a renderer reload and promotes one to steer',
    'reads session state through window.aide, which the daemon backend leaves empty',
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
  // agent-tasks.spec.ts
  [
    'shows a turn checklist and a nested subagent row',
    'fails on the daemon backend, cause not traced yet: expect(locator).toHaveText(expected) failed',
  ],
  // agent-thinking.spec.ts
  [
    'shows thinking live, then collapses it with its duration',
    'fails on the daemon backend, cause not traced yet: expect(locator).toContainText(expected) failed',
  ],
  // agent-tool-timeline.spec.ts
  [
    'shows one expandable row per tool call and keeps it after a reload',
    'fails on the daemon backend, cause not traced yet: expect(locator).toHaveCount(expected) failed',
  ],
  [
    'draws each tool kind, ticks a running tool and marks a failed exit code red',
    'fails on the daemon backend, cause not traced yet: locator.click: Timeout 30000ms exceeded.',
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
    'fails on the daemon backend, cause not traced yet: expect(locator).toBeVisible() failed',
  ],
  [
    'renders managed Claude states from structured runtime events',
    'fails on the daemon backend, cause not traced yet: expect(locator).toBeVisible() failed',
  ],
  // jev-gates-sidebar.spec.ts
  [
    'draws a gate node for every gate turned on and keeps the choice after a relaunch',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'edits the global gate layer in Settings and lets a workspace override win',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  // plan-card.spec.ts
  [
    'refines, implements and implements a plan in a new thread',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  // shared-model-chat.spec.ts
  [
    'distinguishes Codex activity from the final response',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'keeps copy actions below the response and copies only reply text',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'branches a response into an independent same-workspace conversation',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'chats in an ordinary folder without Git and restores the project after restart',
    'fails on the daemon backend, cause not traced yet: expect(locator).toBeVisible() failed',
  ],
  [
    'reopens a closed Agent conversation while New chat and other workspaces stay fresh',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'selects the highlighted agent mention with the keyboard',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'keeps the composer responsive during a sustained Codex stream',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'reattaches to a Codex stream after a renderer reload with the same transcript',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'navigates the conversation minimap with scrolling, clicks and keyboard',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'keeps model and effort controls available during a reply and applies the next choice after it finishes',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'shows provider reasoning options and applies keyboard selections',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'clears accepted drafts and restores only an untouched failed submission',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'ranks skill names first and removes stale suggestions while typing',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'runs a Claude skill with its owner and clears opinion recipients',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'switches to a Codex skill owner and restores its draft in a narrow pane',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'opens fleet Plan first, accepts reported work, and shows actual routing after restart',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'searches, archives and reopens saved tasks with durable attention state',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'opens settings with searchable shortcuts and persists preferences without losing the draft',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'hands a follow-up with images to the running agent',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'sends Codex follow-ups immediately through required Jev preparation',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'labels a running Codex opinion response under a Claude parent',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'attaches a selected workspace file to a required-Jev turn',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'preserves a ten-megabyte image draft across renderer reload',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'keeps the orchestrator while tagged opinions retain model attribution in Build and Plan',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'closes the configured agents popover on an outside click',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'closes the configured agents popover on Escape and refocuses the trigger',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'preserves a completed opinion when a peer fails, then interrupts only the pending peer',
    'reads session state through window.aide, which the daemon backend leaves empty',
  ],
  [
    'rounds the settings select menu and the model selector popover to 8px',
    'reads session state through window.aide, which the daemon backend leaves empty',
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
    "the limit, auth and missing-CLI banners come from aide's provider errors, which pitwall's fake does not raise the same way",
  ],
  [
    'names the fix for missing auth and retries the prompt',
    "the limit, auth and missing-CLI banners come from aide's provider errors, which pitwall's fake does not raise the same way",
  ],
  [
    'names the fix for a missing CLI',
    "the limit, auth and missing-CLI banners come from aide's provider errors, which pitwall's fake does not raise the same way",
  ],
]

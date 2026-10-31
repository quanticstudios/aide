/**
 * Tests the daemon-backend e2e job skips until aide on pitwall reaches parity (ENG-2704): `[title, why]`.
 * @remarks Found by running the whole suite with `AIDE_E2E_PITWALL` on 2026-10-31. Delete an entry once its test passes on the daemon.
 */
export const DAEMON_BACKEND_GAPS: readonly (readonly [string, string])[] = [
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
    'selects the highlighted agent mention with the keyboard',
    'routing-only: tests multi-agent routing through setAgents, which stays on the built-in backend (ENG-2898)',
  ],
  [
    'clears accepted drafts and restores only an untouched failed submission',
    'routing-only: tests multi-agent routing through setAgents, which stays on the built-in backend (ENG-2898)',
  ],
  [
    'opens fleet Plan first, accepts reported work, and shows actual routing after restart',
    'routing-only: tests multi-agent routing through setAgents, which stays on the built-in backend (ENG-2898)',
  ],
  [
    'labels a running Codex opinion response under a Claude parent',
    'routing-only: tests multi-agent routing through setAgents, which stays on the built-in backend (ENG-2898)',
  ],
  [
    'keeps the orchestrator while tagged opinions retain model attribution in Build and Plan',
    'routing-only: tests multi-agent routing through setAgents, which stays on the built-in backend (ENG-2898)',
  ],
  [
    'closes the configured agents popover on an outside click',
    'routing-only: tests multi-agent routing through setAgents, which stays on the built-in backend (ENG-2898)',
  ],
  [
    'closes the configured agents popover on Escape and refocuses the trigger',
    'routing-only: tests multi-agent routing through setAgents, which stays on the built-in backend (ENG-2898)',
  ],
  [
    'preserves a completed opinion when a peer fails, then interrupts only the pending peer',
    'routing-only: tests multi-agent routing through setAgents, which stays on the built-in backend (ENG-2898)',
  ],
]

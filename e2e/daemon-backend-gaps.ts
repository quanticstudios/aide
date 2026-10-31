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
    'distinguishes Codex activity from the final response',
    "injects a Codex snapshot through aide's own IPC (syncManagedSession, managed-session:event), which the daemon transport never reads",
  ],
  [
    'reopens a closed Agent conversation while New chat and other workspaces stay fresh',
    'closing the pane archives its pitwall chat, so the next Agent pane finds no open task to reopen',
  ],
  [
    'keeps model and effort controls available during a reply and applies the next choice after it finishes',
    "picks a Codex model in a Claude chat; pitwall's web protocol cannot switch a chat to another provider (ENG-2932)",
  ],
  [
    'shows provider reasoning options and applies keyboard selections',
    "picks a Codex model in a Claude chat; pitwall's web protocol cannot switch a chat to another provider (ENG-2932)",
  ],
  [
    'searches, archives and reopens saved tasks with durable attention state',
    "task history lists the suite's other daemon chats too, and Restore needs unarchive, which pitwall lacks (ENG-2707). Rename and pin pass on the daemon in pitwall-backend.spec.ts",
  ],
  [
    'hands a follow-up with images to the running agent',
    "pitwall answers every attachment with 'attachments are not supported yet' (ENG-2933)",
  ],
  [
    'attaches a selected workspace file to a required-Jev turn',
    "pitwall answers every attachment with 'attachments are not supported yet' (ENG-2933)",
  ],
  [
    'selects the highlighted agent mention with the keyboard',
    'routing-only: tests multi-agent routing through setAgents, which stays on the built-in backend (ENG-2898)',
  ],
  [
    'clears accepted drafts and restores only an untouched failed submission',
    'routing-only: tests multi-agent routing through setAgents, which stays on the built-in backend (ENG-2898)',
  ],
  [
    'runs a Claude skill with its owner and clears opinion recipients',
    'routing-only: tests multi-agent routing through setAgents, which stays on the built-in backend (ENG-2898)',
  ],
  [
    'switches to a Codex skill owner and restores its draft in a narrow pane',
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

# Daemon backend parity

ENG-2704 tracks every aide journey on both session backends: built-in
(aide's own session manager) and pitwall (`DaemonTransport` to the pitwall
daemon, Settings > General > "Run sessions on the pitwall daemon"). The
daemon backend becomes the default (ENG-2705) only when every row reads
"same" or names a decision.

How to check a row: CI's "Electron e2e" job runs the built-in backend and
"Electron e2e on the pitwall daemon" runs the same suite on a daemon with
`PITWALL_FAKE_PROVIDERS=1`. A test the daemon job skips is listed with its
cause in `e2e/daemon-backend-gaps.ts`. Locally:
`AIDE_E2E_PITWALL=/path/to/pitwall xvfb-run -a bun run test:e2e`.

Specs drive sessions through `window.aideSessions`, the renderer's active
`SessionTransport`, so one spec covers both backends. `window.aide` stays for
workspace, settings and Git calls, which are aide's own on both.

Status: **same** passes on both. **gap** fails on the daemon, with the cause
and the owner of the fix. **decision** needs a product call before anyone
builds it. **dropped** and **moves** follow ENG-2706.

The daemon transport reports a chat under aide's own ids: the workspace whose
folder matches, and the pane aide started it from. It leaves out chats in
folders aide has not opened, so specs sharing the suite's one daemon no longer
read each other's chats. Most `shared-model-chat` specs start through
`startSharedChat`, which configures Claude and Codex agents with `setAgents`.
pitwall answers that unsupported, and multi-agent routing is dropped
(ENG-2706), so those specs need a plain-chat start before they can run on the
daemon. The rows below call this "`startSharedChat`".

## Journeys

| Journey | e2e | Built-in | pitwall | Cause and owner |
| --- | --- | --- | --- | --- |
| Start Claude or Codex, pick model, effort, mode | `shared-model-chat` reasoning, model and effort specs; `composer-settings-persistence` | same | gap | `startSharedChat` (aide). Switching a running chat to the other provider: pitwall's protocol has no command (pitwall). |
| Start in a folder without Git | `shared-model-chat` ordinary folder | same | same | Fixed by ENG-2934: the daemon checks Jev consent (Jev row). |
| Start in a new worktree | `electron-navigation` worktree setup, new chat | same | same |  |
| Streaming reply, follow and minimap | `transcript-follow`, `agent-long-transcript`, `shared-model-chat` stream specs | same | gap | Fixed in ENG-2935: the 2,000-item follow. pitwall streams a long turn in frames, so a commit that adds rows can clamp `scrollTop` a few pixels up for one layout, and the follow hook took that for the reader scrolling away (aide). Stream and minimap specs: `startSharedChat` (aide). |
| Tool cards, every tool kind, timers, red exit | `agent-tool-timeline` | same | same | Fixed here: pitwall fake `tool kinds`; pitwall's Claude driver now folds a subagent's calls into its Task row (they reached the main transcript before). |
| Task checklist and subagent row | `agent-tasks` | same | same |  |
| Thinking live, then collapsed with duration | `agent-thinking` | same | same | Fixed here: pitwall fake `think-stream`. |
| Empty reply marker | `agent-empty-state` | same | same | Fixed here: pitwall fake `empty reply`. |
| Empty state recent prompts | `agent-empty-state` | same | same | Chat summaries carry the first-prompt excerpt; the existing empty-state UI reads it through DaemonTransport (ENG-2930). |
| Plan card: Implement, Implement in a new thread, Refine | `plan-card` | same | same | Fixed here: pitwall reports plan mode as `interactionMode` and its fake carries aide's plan; aide's transport implements a plan in a new chat and opens it. |
| Approvals: keys, command and diff | `agent-approval-cards` | same | same |  |
| Approvals: counter, deny with feedback | `agent-approval-cards` | same | gap | Fixed here: several open approvals and the denial echo in pitwall's fake. The spec still switches to Codex mid-chat, which pitwall can't (pitwall). |
| Full access and Auto-accept edits | `agent-full-access` | same | decision | pitwall passes the mode to the CLI, so a real agent never asks and there is no "Allowed by" line. Keep aide's line, or change the spec to expect no request? |
| Input requests | `electron-navigation` structured runtime events | same | same | Fixed here (ENG-2929): the daemon transport reports each chat in an aide pane to main, which feeds the sidebar's "Agent Input" from it. |
| Steer and queue, interrupt | `agent-message-queue`, `agent-hotkeys` | same | same | Snapshots carry queuedInputs and queuePaused. Atomic queue edits, moves, deletes, resume and promotion to steer pass agent-message-queue, including renderer reload (ENG-2930). |
| Rewind | `agent-rewind` | same | gap | Needs a rewind preview and conversation-only rewind in the web protocol (pitwall, after ENG-2691 #237). |
| Branch a response | `shared-model-chat` branches a response | same | gap | `startSharedChat` (aide); fork goes through the provider after ENG-2691. |
| Per-turn diff chip, changed-files panel | `agent-turn-diff`, `diff-panel`, `theme-switching` | same | gap | The web protocol has no checkpoint diff (pitwall). |
| Pull request row: send failures or review, fix in a new thread, merge | `pitwall-pr-flow` | none | same | pitwall only (ENG-2708): the row reads pitwall's PR poll, and the built-in backend has none. Review threads under diff lines are covered by `DiffPanel.test.tsx`; the e2e can't open the diff on the daemon until the checkpoint diff row is fixed. |
| Turn checkpoints API | `turn-checkpoints` | same | gap | The web protocol has no checkpoint list (pitwall). |
| Usage-limit banner, resume at reset | `usage-limit-banners` | same | same | Snapshots and limit deltas retain the rejected limit and clear it on the next turn. The local-time reset and draft-cancellation spec passes (ENG-2930). |
| Auth and missing-CLI banners | `usage-limit-banners` | same | same | Auth retries and per-start fake missing-CLI failures pass through the existing error banner (ENG-2930). |
| Notifications and unread | `task-notifications` | same | same | Fixed here (ENG-2929): main runs the same notifications, badge and unread on the reported chats. A chat no aide pane shows is not reported, so it notifies once a pane opens it. |
| Task history: search, open, rename | `pitwall-backend`, `shared-model-chat` saved tasks | same | gap | A `pitwall chat new` chat shows without a reload. A chat aide started opens in its own workspace and pane; one started elsewhere opens in an Agent pane of its workspace (both fixed here). Search, rename and pin: `startSharedChat`. |
| Task history: archive and reopen | `shared-model-chat` saved tasks | same | gap | Owned by ENG-2707 (import, archived list and read). Reopening an archived chat showed "does not support unarchive"; ENG-2707's PR skips `unarchive` while pitwall lacks it and opens the chat as read-only history. |
| Attachments: images, long paste, files | `composer-stash-history`, `shared-model-chat` image and file specs | same | gap | Fixed here: pitwall takes images, workspace files and pasted text on `start` and `send`, keeps them on the prompt and the queued message, and hands the agent images as images and the rest quoted as aide's preparation quotes it; `composer-stash-history` passes on the daemon. `shared-model-chat` image and file specs: `startSharedChat` (aide). |
| Jev gates and Jev preparation | `jev-gates-sidebar`, `electron-navigation` Jev consent, `shared-model-chat` Jev specs | same | same | ENG-2934: pitwall's `internal/decide` runs Jev preparation, the consent check and the tool gate on every turn of a chat aide started. aide's main process hands over the keyring key, consent list and gate layers with `setJev` on each connection and settings change; the renderer never sees the key. Lane routing and the completion check judge aide's configured agents, which are dropped with `setAgents` (Fleet row); the `jev-gates-sidebar` and `shared-model-chat` Jev specs stay skipped for that reason. |
| Fleet plan, @agent routing, opinions, orchestrator tools | `shared-model-chat` fleet, opinion and agents specs | same | dropped | Dropped with the main-process manager (ENG-2706, a user call as reported by the ENG-2706 session). |
| Model and skill lists, workspace titles, commit messages | `shared-model-chat` skill specs | same | moves | They stay on aide's provider code until ENG-2706 replaces it: lists without the Agent SDK, titles and messages through a pitwall chat. |
| Reload and reattach a running session | `electron-navigation` reattach, `shared-model-chat` reattach | same | gap | `startSharedChat` (aide). |
| Switch backends and keep built-in sessions | `pitwall-backend` | same | same |  |

## Checked by hand

The ticket asks for a manual run with real Claude and Codex on a scratch repo
before the default switch. It has not happened yet. Record it here with the
date, the pitwall and aide commits, and one line per journey above.

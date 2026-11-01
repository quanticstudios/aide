# Daemon backend parity

ENG-2704 tracked every aide journey on both session backends: built-in
(aide's own session manager) and pitwall (`DaemonTransport` to the pitwall
daemon). ENG-2898 deleted the built-in backend, so sessions run only on the
daemon. The "Built-in" column records how each journey ran before that.

How to check a row: CI's "Electron e2e on the pitwall daemon" job runs the
suite on a daemon with `PITWALL_FAKE_PROVIDERS=1`. A test that cannot pass on
the daemon yet is `test.fixme`, with a `// why:` line naming its ticket.
Locally: `AIDE_E2E_PITWALL=/path/to/pitwall xvfb-run -a bun run test:e2e`.

Specs drive sessions through `window.aideSessions`, the renderer's
`SessionTransport`. `window.aide` stays for workspace, settings and Git
calls, which are aide's own.

Status: **same** passes on both. **gap** fails on the daemon, with the cause
and the owner of the fix. **decision** needs a product call before anyone
builds it. **dropped** and **moves** follow ENG-2706.

The daemon transport reports a chat under aide's own ids: the workspace whose
folder matches, and the pane aide started it from. It leaves out chats in
folders aide has not opened, so specs sharing the suite's one daemon no longer
read each other's chats. `shared-model-chat` specs start through
`startPlainChat`, one Claude or Codex chat as a user starts it (ENG-2928).

## Journeys

| Journey | e2e | Built-in | pitwall | Cause and owner |
| --- | --- | --- | --- | --- |
| Start Claude or Codex, pick model, effort, mode | `shared-model-chat` reasoning, model and effort specs; `composer-settings-persistence` | same | same | Starting either provider: same (plain-chat start, ENG-2928). Switching a running chat to the other provider: same, through `set` with `provider` (ENG-2932). A switch picked while a turn runs or waits on an approval: same, pitwall holds it in the snapshot's `pendingProviderSelection` and runs it once the turn ends, as aide does (ENG-2941). |
| Start in a folder without Git | `shared-model-chat` ordinary folder | same | same | Fixed by ENG-2934: the daemon checks Jev consent (Jev row). |
| Start in a new worktree | `electron-navigation` worktree setup, new chat | same | same |  |
| Streaming reply, follow and minimap | `transcript-follow`, `agent-long-transcript`, `shared-model-chat` stream specs | same | same | Fixed in ENG-2935: the 2,000-item follow. pitwall streams a long turn in frames, so a commit that adds rows can clamp `scrollTop` a few pixels up for one layout, and the follow hook took that for the reader scrolling away (aide). Sustained Codex stream, minimap and copy actions: same (ENG-2928). Codex commentary versus final answer: same, the spec runs pitwall's `codex commentary` fake script on the daemon, which streams both phases (ENG-2941). |
| Tool cards, every tool kind, timers, red exit | `agent-tool-timeline` | same | same | Fixed here: pitwall fake `tool kinds`; pitwall's Claude driver now folds a subagent's calls into its Task row (they reached the main transcript before). |
| Task checklist and subagent row | `agent-tasks` | same | same |  |
| Thinking live, then collapsed with duration | `agent-thinking` | same | same | Fixed here: pitwall fake `think-stream`. |
| Empty reply marker | `agent-empty-state` | same | same | Fixed here: pitwall fake `empty reply`. |
| Empty state recent prompts | `agent-empty-state` | same | same | Chat summaries carry the first-prompt excerpt; the existing empty-state UI reads it through DaemonTransport (ENG-2930). |
| Plan card: Implement, Implement in a new thread, Refine | `plan-card` | same | same | Fixed here: pitwall reports plan mode as `interactionMode` and its fake carries aide's plan; aide's transport implements a plan in a new chat and opens it. |
| Approvals: keys, command and diff | `agent-approval-cards` | same | same |  |
| Approvals: counter, deny with feedback | `agent-approval-cards` | same | same | Several open approvals and the denial echo in pitwall's fake; the switch to Codex mid-chat is `set` with `provider` (ENG-2932). |
| Full access and Auto-accept edits | `agent-full-access` | same | same | Decided (ENG-2928): pitwall passes the mode to the CLI, so no request reaches aide and there is no "Allowed by" line; the spec expects that on the daemon and keeps the line on built-in. pitwall's fake now leaves out the requests a mode grants, as a real CLI does. |
| Input requests | `electron-navigation` structured runtime events | same | same | Fixed here (ENG-2929): the daemon transport reports each chat in an aide pane to main, which feeds the sidebar's "Agent Input" from it. |
| Steer and queue, interrupt | `agent-message-queue`, `agent-hotkeys` | same | same | Snapshots carry queuedInputs and queuePaused. Atomic queue edits, moves, deletes, resume and promotion to steer pass agent-message-queue, including renderer reload (ENG-2930). |
| Rewind | `agent-rewind` | same | same | `rewindPreview` lists the files a rewind changes, and `rewind` with `keepFiles` rewinds the conversation alone (ENG-2931). pitwall rewinds the chat in place where aide's backend restores into a copy, so the pane's own composer takes the prompt. |
| Branch a response | `shared-model-chat` branches a response | same | same | Fixed here (ENG-2928): the daemon transport opens the fork in a pane of its own, as the built-in backend does; fork goes through the provider after ENG-2691. |
| Reopen a closed Agent pane | `shared-model-chat` reopens a closed Agent conversation | same | same | Closing a pane archives its pitwall chat. `DaemonTransport` remembers the chats it archived that way (localStorage `aide.pitwall-closed-chats`) and lists them as open tasks, as the built-in backend does, so the next Agent pane finds one; the pane's subscribe then calls pitwall's `unarchive`, and the chat resumes its provider session (ENG-2940). |
| Per-turn diff chip, changed-files panel | `agent-turn-diff`, `diff-panel`, `theme-switching` | same | same | `checkpointDiff` (ENG-2931). The last turn's diff runs to the files now, where aide's backend stops at the turn's end, so edits made after the turn count as the turn's. |
| Pull request row: send failures or review, fix in a new thread, merge | `pitwall-pr-flow` | none | same | pitwall only (ENG-2708): the row reads pitwall's PR poll, and the built-in backend has none. Review threads under diff lines are covered by `DiffPanel.test.tsx`; the e2e can't open the diff on the daemon until the checkpoint diff row is fixed. |
| Turn checkpoints API | `turn-checkpoints` | same | same | Snapshot turns carry `checkpointId`, and `checkpoints` lists the ones the tab still keeps (ENG-2931). |
| Usage-limit banner, resume at reset | `usage-limit-banners` | same | same | Snapshots and limit deltas retain the rejected limit and clear it on the next turn. The local-time reset and draft-cancellation spec passes (ENG-2930). |
| Auth and missing-CLI banners | `usage-limit-banners` | same | same | Auth retries and per-start fake missing-CLI failures pass through the existing error banner (ENG-2930). |
| Notifications and unread | `task-notifications` | same | same | Fixed here (ENG-2929): main runs the same notifications, badge and unread on the reported chats. The transport stays subscribed to every chat in aide's workspaces, so one no aide pane shows, such as a `pitwall chat new` chat, notifies and badges too (ENG-2937). |
| Task history: search, open, rename | `pitwall-backend`, `shared-model-chat` saved tasks | same | same | A `pitwall chat new` chat shows without a reload. A chat aide started opens in its own workspace and pane; one started elsewhere opens in an Agent pane of its workspace (both fixed here). Rename and pin are pitwall's `rename` and `pin` commands and survive a reload and a daemon restart (ENG-2938); `pitwall-backend` covers search, rename and pin. A name another pitwall tab of the session has is refused, which the built-in backend allows. A chat aide starts takes its title from its first prompt (ENG-2940). Search matches the title, the project, workspace and branch, and the transcript of the chats aide holds a snapshot of; an archived chat's transcript goes unsearched. |
| Task history: archive and reopen | `shared-model-chat` saved tasks | same | same | Restore is pitwall's `unarchive` (ENG-2940): the chat comes back in a new tab of its folder with its id, transcript and provider session. An archived chat aide started keeps its project and workspace names from aide's own workspace. The spec scopes its cards to its own project, since the suite's one daemon also lists other specs' chats. |
| Attachments: images, long paste, files | `composer-stash-history`, `shared-model-chat` image and file specs | same | same | Fixed in ENG-2933: pitwall takes images, workspace files and pasted text on `start` and `send`, keeps them on the prompt and the queued message, and hands the agent images as images and the rest quoted as aide's preparation quotes it; `composer-stash-history` passes on the daemon. The `shared-model-chat` image and file specs pass too, on the plain-chat start (ENG-2928). |
| Jev gates and Jev preparation | `jev-gates-sidebar`, `electron-navigation` Jev consent, `shared-model-chat` Jev specs | same | same | ENG-2934: pitwall's `internal/decide` runs Jev preparation, the consent check and the tool gate on every turn of a chat aide started. aide's main process hands over the keyring key, consent list and gate layers with `setJev` on each connection and settings change; the renderer never sees the key. Lane routing and the completion check judged aide's configured agents, and were dropped with @agent routing (ENG-2898); `jev-gates-sidebar` checks the gate switches without the fleet drawer. |
| Fleet plan, @agent routing, opinions, orchestrator tools | none | same | dropped | Dropped with the main-process manager (ENG-2898, recorded on ENG-2898 and ENG-2706). Their specs are deleted. |
| Model and skill lists, workspace titles, commit messages | `shared-model-chat` model discovery and skill search specs | same | moves | The model list is fixed in `src/shared/provider-capabilities.ts` and skills are read from the skill folders (ENG-2898). |
| Run a selected provider skill | `shared-model-chat` runs a Claude skill, switches to a Codex skill owner | same | same | ENG-2942: `DaemonTransport` has Electron main resolve the selected skill (`resolveProviderSkill`) and sends its native name and path as pitwall's `skill` on `send`, queued messages included. pitwall runs it as aide's built-in backend did: Claude gets `/name` ahead of the text, Codex a `skill` input item. A Codex skill owner switches the chat first, as the composer asks. |
| Reload and reattach a running session | `electron-navigation` reattach, `shared-model-chat` reattach | same | same | Fixed here (ENG-2928): plain-chat start, and the spec waits for the pane before it reads while the transport reconnects. |
| Import aide's stored sessions | `session-import.test.ts` (unit) | none | same | The first connect imports aide's stored sessions into pitwall as archived chats, with their titles, pins and transcripts (ENG-2707). One aide had open is listed as an open task, through the closed-pane path of the row above: main hands each to `DaemonTransport` once (`takeImportedOpenSessions`), and opening it unarchives it. One aide had archived stays under Archived. pitwall's `unarchive` is not called on import, since it opens a tab for every chat it restores. Its `pitwall-backend` spec is deleted, since nothing makes built-in sessions any more (ENG-2898). |

## Checked by hand

The ticket asks for a manual run with real Claude and Codex on a scratch repo
before the default switch. It has not happened yet. Record it here with the
date, the pitwall and aide commits, and one line per journey above.

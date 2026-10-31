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
builds it. **dropped** and **moves** follow ENG-2706. "Slice 2" is ENG-2704's
next aide PR: scope `getSessions` to this aide's panes and map pitwall's
`paneId` and `workspaceId` to aide's.

## Journeys

| Journey | e2e | Built-in | pitwall | Cause and owner |
| --- | --- | --- | --- | --- |
| Start Claude or Codex, pick model, effort, mode | `shared-model-chat` reasoning, model and effort specs; `composer-settings-persistence` | same | gap | Specs read the wrong chat: `getSessions` lists every chat in the suite's daemon (slice 2, aide). Switching a running chat to the other provider: pitwall's protocol has no command (pitwall). |
| Start in a folder without Git | `shared-model-chat` ordinary folder | same | gap | Jev consent is checked in aide's session manager, which the daemon backend skips (Jev row). |
| Start in a new worktree | `electron-navigation` worktree setup, new chat | same | same |  |
| Streaming reply, follow and minimap | `transcript-follow`, `agent-long-transcript`, `shared-model-chat` stream specs | same | gap | 2,000-item follow fails, cause not traced. Stream specs: `getSessions` (slice 2). |
| Tool cards, every tool kind, timers, red exit | `agent-tool-timeline` | same | same | Fixed here: pitwall fake `tool kinds`; pitwall's Claude driver now folds a subagent's calls into its Task row (they reached the main transcript before). |
| Task checklist and subagent row | `agent-tasks` | same | same |  |
| Thinking live, then collapsed with duration | `agent-thinking` | same | same | Fixed here: pitwall fake `think-stream`. |
| Empty reply marker | `agent-empty-state` | same | same | Fixed here: pitwall fake `empty reply`. |
| Empty state recent prompts | `agent-empty-state` | same | gap | Recent prompts come from task excerpts; pitwall's chat list has no field for them (pitwall). |
| Plan card: Implement, Implement in a new thread, Refine | `plan-card` | same | gap | `getSessions` (slice 2), then implement in a new thread needs a check. |
| Approvals: keys, command and diff | `agent-approval-cards` | same | same |  |
| Approvals: counter, deny with feedback | `agent-approval-cards` | same | gap | Fixed here: several open approvals and the denial echo in pitwall's fake. The spec still switches to Codex mid-chat, which pitwall can't (pitwall). |
| Full access and Auto-accept edits | `agent-full-access` | same | decision | pitwall passes the mode to the CLI, so a real agent never asks and there is no "Allowed by" line. Keep aide's line, or change the spec to expect no request? |
| Input requests | `electron-navigation` structured runtime events | same | gap | The answer works; the sidebar's "Agent Input" attention comes from aide's task library, which pitwall chats don't update (aide). |
| Steer and queue, interrupt | `agent-message-queue`, `agent-hotkeys` | same | gap | `getSessions` (slice 2). |
| Rewind | `agent-rewind` | same | gap | Needs a rewind preview and conversation-only rewind in the web protocol (pitwall, after ENG-2691 #237). |
| Branch a response | `shared-model-chat` branches a response | same | gap | `getSessions` (slice 2); fork goes through the provider after ENG-2691. |
| Per-turn diff chip, changed-files panel | `agent-turn-diff`, `diff-panel`, `theme-switching` | same | gap | The web protocol has no checkpoint diff (pitwall). |
| Turn checkpoints API | `turn-checkpoints` | same | gap | The web protocol has no checkpoint list (pitwall). |
| Usage-limit banner, resume at reset | `usage-limit-banners` | same | gap | pitwall's snapshot drops limit events, so there is no `usageLimit` (pitwall). The fake now has `usage limit <unix seconds>`. |
| Auth and missing-CLI banners | `usage-limit-banners` | same | gap | Fixed here: auth (the pane names the fix from `lastError` when the snapshot has no kind). Missing CLI: the fake can only fail starts suite-wide (pitwall). |
| Notifications and unread | `task-notifications` | same | gap | Attention state lives in aide's task library; pitwall chats don't feed it (aide). |
| Task history: search, open, rename | `pitwall-backend`, `shared-model-chat` saved tasks | same | gap | A `pitwall chat new` chat shows without a reload. Search and attention: `getSessions` (slice 2). |
| Task history: archive and reopen | `shared-model-chat` saved tasks | same | gap | Owned by ENG-2707 (import, archived list and read). Reopening an archived chat showed "does not support unarchive"; ENG-2707's PR skips `unarchive` while pitwall lacks it and opens the chat as read-only history. |
| Attachments: images, long paste, files | `composer-stash-history`, `shared-model-chat` image and file specs | same | gap | pitwall refuses image attachments for now (pitwall). |
| Jev gates and Jev preparation | `jev-gates-sidebar`, `electron-navigation` Jev consent, `shared-model-chat` Jev specs | same | gap | Owner: pitwall (`internal/decide`), per the ticket. On the daemon today aide sends without Jev preparation or its consent check. |
| Fleet plan, @agent routing, opinions, orchestrator tools | `shared-model-chat` fleet, opinion and agents specs | same | dropped | Dropped with the main-process manager (ENG-2706, a user call as reported by the ENG-2706 session). |
| Model and skill lists, workspace titles, commit messages | `shared-model-chat` skill specs | same | moves | They stay on aide's provider code until ENG-2706 replaces it: lists without the Agent SDK, titles and messages through a pitwall chat. |
| Reload and reattach a running session | `electron-navigation` reattach, `shared-model-chat` reattach | same | gap | `getSessions` (slice 2). |
| Switch backends and keep built-in sessions | `pitwall-backend` | same | same |  |

## Checked by hand

The ticket asks for a manual run with real Claude and Codex on a scratch repo
before the default switch. It has not happened yet. Record it here with the
date, the pitwall and aide commits, and one line per journey above.

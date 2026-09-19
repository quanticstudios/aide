# Agent pane parity

Shipped on 2026-09-19 as fifteen squash merges to `main`, PRs 41 to 57. The audit that
produced the ticket set compared the Agent pane with T3 Code, Claude Code desktop, the
Codex app and Conductor. The six must-haves from that audit, three user reports from the
same day, and the CI repairs needed to land any of it are listed below with the check that
proves each one in the Electron suite.

## What the Agent pane does now

| Capability                                  | PR  | Journey (fake providers, `AIDE_FAKE_MANAGED_PROVIDERS=1`)                                                                         |
| ------------------------------------------- | --- | --------------------------------------------------------------------------------------------------------------------------------- |
| Tool calls as collapsible rows              | 45  | Send `tools`: Bash, Edit and Read rows appear above the reply; Bash shows `exit 0`, Edit expands to a diff; rows survive reload.  |
| Approval cards show the real request        | 43  | Send `approval`: the full command in a mono block; `1` allows once, `Escape` denies. `edit approval` shows the path and diff.     |
| Full access never prompts                   | 57  | Set Full access, send `approval`: no card, a system line "Allowed by Full access" and the turn completes.                         |
| Per-turn diff chip                          | 41  | Send `edit readme` in a Git project: a `+1 -0 · 1 file` chip on the turn opens an inline diff of `README.md`.                     |
| Edit from here (rewind)                     | 44  | Hover a user message: "Edit from here" opens a modal with "Keep file changes" or "Revert files too"; the prompt returns.          |
| Task list and subagent rows                 | 54  | Send `todos`: a "Tasks 1/3" checklist between prompt and reply. Send `subagent`: one "Explore the repo" row with nested output.   |
| Composer hotkeys                            | 47  | `Escape` stops a running turn; `Ctrl+Shift+M`, `E`, `A` open model, effort and permission menus; `Ctrl+Shift+Enter` sends queued. |
| Composer settings persist                   | 46  | Change model, effort, permission mode and an agent model, relaunch: all four are back, and a new workspace starts from them.      |
| Configured agents popover closes            | 42  | Open Agents, click the transcript: closed. Escape returns focus to the button.                                                    |
| Update modal                                | 48  | One heading with a state pill, one status line, a flat settings list, primary action filled and Close quiet.                      |
| Sidebar row and pane header aligned         | 51  | The project row and the Agent and Git headers share a 40 px height and top edge.                                                  |
| Jev configured in Settings                  | 52  | The pane header has no Jev button; a blocked send offers "Open Settings" landing on the Jev section.                              |
| Overlay radius                              | 53  | Every dropdown, select, popover and palette container is 8 px, rows 6 px.                                                         |
| Jev gates in the sidebar and the flowchart  | 56  | Toggle a gate in the sidebar section: a dashed gate node appears in the fleet flowchart at its pipeline position.                 |

## CI repairs that had to land first

- PR 49: the dependency audit step retries a registry 5xx and only fails on a real
  advisory; four React Doctor errors in the file search effect are gone; four stale e2e
  assertions and one too-short timeout were corrected.
- PR 55: five assertions across three tests that passed or failed by runner timing and
  window height now wait for the state they assert on.

## Evidence

- PRs 41 to 54 ran the full CI job (dependency policy, packaging tests, audit, React
  Doctor, vitest, Biome, build, bundle budget, native ABI, Electron e2e under Xvfb) green
  on their own head before merge. PRs 55, 56 and 57 merged on the user's instruction
  before their runs finished; their specs are covered by the `main` run.
- Workers ran vitest and their own Playwright spec locally before the first push; after
  that CI was the only gate.
- `bun run test` on the final tree: 710 tests across 106 files.
- The `main` run for the commit that adds this file is the authoritative full-suite
  result; earlier `main` runs were cancelled by the next merge's concurrency group.

## Known gaps

- The tool-call rows, task list and subagent rows are proven against the fake provider and
  the SDK message shapes, not against a live Claude session with a real `TodoWrite` or
  `Task` call.
- Codex `approvalPolicy: 'never'` under Full access is unverified against a live
  app-server; the shared guard covers the behaviour either way.
- The Preview pane header matches the shared height but sits inside a padded card, so its
  top edge is 16 px lower than the sidebar row.
- Composer persistence stores one selection per workspace; the previous per-provider model
  memory is gone, so switching provider resolves that provider's default model.
- The global Jev gate layer has no editor yet; AP-16 adds it to Settings.

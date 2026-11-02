# Changelog

## Unreleased

- Split horizontally and Split vertically open their pane menu again, and
  picking Agent there adds an Agent pane instead of a Terminal.
- Typing a URL into a Preview pane no longer crashes the pane.
- Terminal text is readable in the Light theme, and the terminal lifts any ANSI
  color below 4.5:1 on its background until it passes.
- The Git pane's diff keeps room to read: Line feedback starts collapsed, and
  the pane scrolls instead of squeezing the diff.
- The Git pane lists each file inside an untracked folder, so their diffs open.
- Generated commit messages say "1 more file" instead of "1 more files".
- Line feedback names agent panes "Agent 1 · Claude" instead of their pane ids.
- The Preview pane uses the standard pane header, shows URLs as typed, and tells
  you to select it when another pane is active.
- Edit from here marks the files a revert would change that the message did
  not, and says when pitwall reverts edits made after it too.
- A turn's diff is read when the turn ends and kept across reloads, so edits
  made after it don't count as the turn's.
- `@` mentions list matching files first and match skills by name only.
- Skill and file names in the `@` menu stay readable next to long descriptions.
- Escape closes the permission-mode and stash menus and returns focus to their
  button.
- A Stop button replaces Send while a turn runs, and a stopped or failed turn
  says so in the transcript.
- A turn with no reply ends with a muted "No response" divider.
- A provider failure with no known fix shows its message and Retry, also after
  a stopped turn.
- The error banner shows commands as code instead of raw backticks.
- The Codex reasoning chip no longer says "Default" for models without service
  tiers.
- Chats are titled from the first line of their first prompt, without markdown,
  and agent tabs show that title.
- Line feedback puts each agent pane's chat title before "Agent 1 · Claude".
- The pane tabs no longer draw a scrollbar over themselves.
- Removing a skill chip clears its notice, and a file mention at the end of the
  draft leaves no trailing space.
- The answer field of an input request no longer says to leave it blank.

## 0.0.3 (2026-11-01)

### Sessions run on the pitwall daemon

aide starts every session in pitwall's daemon instead of its own main process.
Sessions keep running when you close aide or restart the machine, and they
resume where they left off. aide no longer ships its own session manager or the
Claude and Codex SDKs.

- If pitwall is not installed, aide shows how to install it.
- An existing install shows a notice once. Sessions aide ran itself move into
  pitwall the first time it connects, with their titles, pins and transcripts,
  and stay in task history.
- The agent fleet, @agent mentions, opinions and orchestrator tools are
  removed.

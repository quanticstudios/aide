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

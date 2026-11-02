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
- When pitwall's web listener is off, the setup card offers Turn on for aide,
  which adds `[web] enabled = true` to pitwall's config.toml and connects. A
  fresh install no longer needs a hand edit.
- When the pitwall daemon aide starts exits at once, the card says pitwall
  could not start, with its error and the path of its crash.log, instead of
  asking you to edit config.toml.
- The daemon aide starts no longer holds aide's open files and ports, such as
  the DevTools port, after aide quits.
- New worktrees inside the repository are added to `.git/info/exclude`, so they
  no longer show as an untracked change.
- Safe mode no longer tries to reach pitwall, which filled the log with errors.
- A new chat says before your first message when Jev needs a TypeSafe key or
  workspace permission, with a link to Settings.
- The pitwall setup card sits below the top bar instead of covering its
  buttons.
- Safe mode marks Restore as the main action and shows Reset in its warning
  color.
- The workspace setup log opens under the status line, so Retry setup stays
  beside it.
- Field descriptions, Diagnostics values and other secondary text in dialogs
  are readable again in every theme.
- Primary buttons are blue, checked switches show a blue track with a white
  thumb, and unchecked switches show a visible track.
- A focused dialog or rounded control keeps its own corners instead of turning
  square, and a dialog no longer draws a focus ring around itself.
- Opening a conversation from Task history, the Activity inbox or a
  notification switches to its workspace.
- While the workspace switcher is open, Alt+J and Alt+K move through the
  workspaces of every project, and the switcher lists them all with their
  project.
- The Ctrl+1 project hints in the sidebar go away after Ctrl+K, Ctrl+Tab or
  Ctrl+B.
- Workspace setup status and the "Sessions now run on pitwall" notice sit above
  the panes instead of covering them or the sidebar footer.
- The archived workspaces popover closes after you restore the last one.
- The top bar keeps the active pane tab in view, fades tabs that scroll off,
  names the project when you have more than one, and shows the version and
  update buttons as icons below 1440 pixels wide.
- Shrink pane and Grow pane are disabled when the pane has nothing to share
  its space with.
- Task history and the Activity inbox name the project and workspace instead
  of repeating the branch, and the bell stops counting an approval that
  expired.
- The project attention count is easier to read, and screen readers announce
  the current workspace.
- Settings > Keyboard shortcuts lists Ctrl+` and the composer's model, effort
  and permission menus.
- Focus rings in the top bar are no longer clipped, and they appear blue at
  once instead of fading in from black.

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

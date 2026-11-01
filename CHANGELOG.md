# Changelog

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

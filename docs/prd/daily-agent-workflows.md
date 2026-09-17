# Daily agent workflows

## Problem Statement

Aide runs shared model conversations but daily work still requires external tools
to supply screenshots, correct running work, recover a bad turn, review changes,
and find completed conversations.

## Solution

Complete six workflows in the existing desktop shell: attachments and explicit
file context; queued follow-ups and steering; turn checkpoints; Git review and
pull requests; an activity inbox; searchable and archivable conversation history.
Jev remains required beneath the selected orchestrator and configured agents.

## User Stories

1. Paste or drop an image and select workspace files as explicit turn context.
2. Queue a follow-up while an agent works, cancel it, or send it now with clear
   provider-supported behavior. Recover unsent drafts after restart.
3. Inspect changes from a turn and preview a restore before choosing whether to
   restore conversation alone or conversation and files. Preserve original history.
4. Give line-specific diff feedback to the orchestrator, stage or revert a file,
   commit selected changes, create a pull request, and inspect checks.
5. Find tasks needing approval, input, or failure handling in one activity list.
   Open the exact task from an item or desktop notification and mark it read.
6. Search saved user and assistant messages, rename or pin a task, archive finished
   work, and restore it without losing its transcript.

## Navigation and Interaction Model

Keep the workspace/surface/pane hierarchy. Composer controls belong in the Agent
pane; review actions belong in the Git pane. History and Activity open from the
shell without creating another workspace. Selecting a result activates its owning
workspace and pane. Controls support keyboard use, meaningful labels, visible
pending/error states, and focus return when dialogs close.

## Implementation Decisions

Reuse main-process runtime ownership, typed trusted IPC, SQLite persistence,
provider adapters, existing worktrees, and Git diff components. Do not introduce
a server, provider framework, or new dependency for these workflows.

Explicit attachments bypass optional evidence ranking but retain type, size,
workspace, and path checks. Never expose the Jev key. Preserve image modality for
providers that support it and explain unsupported inputs before dispatch.

Queue delivery must be ordered and at most once within a process. Interrupted
queued work must require explicit resumption after application restart. Steering
must not silently become a concurrent write turn. Preserve recipients and explicit
context per queued message.

Checkpoint restoration must reject running turns and stale previews, preserve
user changes made after the preview, and never delete ignored files or follow
symlinks outside the workspace. Capture recoverable originals before changes.
Git mutations accept validated file paths and argument arrays, never shell text.
PR actions use the configured repository's existing GitHub CLI authentication.

History operates on durable conversation records. Archiving does not delete code
or terminate active work. Read/unread state survives restart. Desktop notifications
default to background-only and never include secrets or full message content.

## Testing Decisions

Prove real provider payloads receive explicit attachments, queue ordering and
recipient attribution, cancellation and restart behavior, and required Jev use.
Use disposable Git repositories for checkpoint and mutation tests, including dirty
files, untracked files, symlinks, stale restore previews, and failed Git commands.
Test persistence, search, archive, read state, and navigation to exact task owners.
Exercise all six user journeys in Electron. Run Node unit tests, TypeScript/build,
Biome, locked React Doctor, packaging checks, and the existing desktop suite.

## Out of Scope

Mobile/remote access, additional providers, scheduled agents, a plugin marketplace,
automatic merge, and public release provisioning are separate work.

## Further Notes

The implementation builds on `codex/product-readiness`. Existing public release
gates remain in `docs/19-production-readiness.md`. Feature completion does not
establish signing, OTA deployment, or team pilot results.

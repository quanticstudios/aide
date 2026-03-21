# Ticket Backlog — Core Panes and AI (Phases 3–4)

---

## Phase 3 — Core panes

### P3-001 — Pane registry
**Why**  
Need one way to register pane types and renderers.

**Depends on**  
P2-003

**Deliverable**  
Pane type registry and factory.

**Acceptance**
- Pane type resolves to renderer.
- Pane metadata and default state can be created centrally.

### P3-002 — Terminal session manager
**Why**  
Terminals must outlive naive renderer state.

**Depends on**  
P0-004, P1-003

**Deliverable**  
Workspace-scoped terminal session service.

**Acceptance**
- Can create session for workspace.
- Session can be reattached by pane.
- Process lifecycle is tracked.

### P3-003 — Terminal pane renderer
**Why**  
First truly useful pane for power users.

**Depends on**  
P3-002, P3-001

**Deliverable**  
xterm.js pane with connect/disconnect and resize handling.

**Acceptance**
- User can type commands.
- Output streams live.
- Resize does not break terminal.

### P3-004 — Git service layer
**Why**  
Git pane and AI review both depend on stable repo state.

**Depends on**  
P1-003

**Deliverable**  
Workspace-scoped git wrapper service.

**Acceptance**
- Reads branch name.
- Reads changed files.
- Reads staged/unstaged state.
- Emits parseable errors.

### P3-005 — Git pane renderer
**Why**  
Users need review and trust surface.

**Depends on**  
P3-004, P3-001

**Deliverable**  
Git pane showing changed files and file selection.

**Acceptance**
- Changed files list visible.
- Staged/unstaged distinction visible.
- Selecting file updates diff area or linked editor later.

### P3-006 — Diff viewer
**Why**  
Git pane without diff is incomplete.

**Depends on**  
P3-005

**Deliverable**  
Side-by-side or unified diff surface.

**Acceptance**
- File diff renders.
- Large diffs do not freeze obviously.

### P3-007 — Preview target model
**Why**  
Preview pane needs stable notion of what to load.

**Depends on**  
P1-003

**Deliverable**  
Workspace-scoped preview target definitions.

**Acceptance**
- Workspace can store one or more preview targets.
- Active target is selectable.

### P3-008 — Preview pane renderer
**Why**  
The product needs app validation inside workspace.

**Depends on**  
P0-005, P3-007, P3-001

**Deliverable**  
Preview pane loading target URL with reload support.

**Acceptance**
- Local runtime loads.
- Reload works.
- Target can be changed.

### P3-009 — Editor file open path
**Why**  
Git and chat need to open referenced files.

**Depends on**  
P0-003, P3-001

**Deliverable**  
File resolver and open-file action.

**Acceptance**
- Can open file path into editor pane.
- Missing file errors handled.

### P3-010 — Editor pane renderer
**Why**  
Light editing and inspection are still necessary.

**Depends on**  
P3-009

**Deliverable**  
Monaco-based editor pane with syntax highlighting.

**Acceptance**
- Opens files.
- Saves files.
- Tracks dirty state.

### P3-011 — Jobs domain model and service
**Why**  
Notifications and provider integration depend on jobs.

**Depends on**  
P1-003

**Deliverable**  
Job store/service for workspace-scoped jobs.

**Acceptance**
- Can create, update, complete, fail jobs.
- Job list queryable by workspace.

### P3-012 — Jobs pane
**Why**  
Users need visible background work status.

**Depends on**  
P3-011, P3-001

**Deliverable**  
Jobs pane listing running/recent jobs.

**Acceptance**
- Shows running jobs.
- Shows completed jobs.
- Status is visually obvious.

### P3-013 — Logs pane
**Why**  
Need a place to inspect structured or raw output.

**Depends on**  
P3-011, P3-001

**Deliverable**  
Basic logs/output pane.

**Acceptance**
- Can show output for selected source.
- Output does not mix unrelated workspaces.

### P3-014 — Workspace presets using real panes
**Why**  
Common workspace setups should be one click.

**Depends on**  
P3-003, P3-005, P3-008, P3-010, P3-012

**Deliverable**  
Real presets: chat placeholder + terminal, terminal+git, editor+preview+terminal, review layout.

**Acceptance**
- Presets create correct pane types and layout.
- User can apply to new or existing workspace.

---

## Phase 4 — Chat and provider adapter layer

### P4-001 — Provider adapter interface
**Why**  
Need one app-facing abstraction before real integrations.

**Depends on**  
P3-011

**Deliverable**  
Shared provider adapter contract and event model.

**Acceptance**
- Interface defined in code.
- Event normalization types exist.
- Capability model exists.

### P4-002 — Provider executable configuration UI
**Why**  
Users need to point app at local provider tools.

**Depends on**  
P0-007, P4-001

**Deliverable**  
Settings flow for executable paths and validation.

**Acceptance**
- User can configure provider binary.
- Validation errors are clear.

### P4-003 — Chat thread domain model
**Why**  
Chat needs a stable state container independent of provider.

**Depends on**  
P1-003, P4-001

**Deliverable**  
Workspace-scoped thread/message/task model.

**Acceptance**
- Chat thread persists per workspace.
- Messages and task links can be stored.

### P4-004 — Chat pane renderer
**Why**  
This is the user-facing AI control surface.

**Depends on**  
P4-003, P3-001

**Deliverable**  
Chat pane UI with input area, transcript, job linkage area.

**Acceptance**
- User can send prompt.
- Transcript renders.
- Pending state visible.

### P4-005 — Claude Code adapter
**Why**  
Need first real provider integration.

**Depends on**  
P4-001, P4-002

**Deliverable**  
Adapter that can launch, stream, and finish tasks through Claude Code.

**Acceptance**
- Start task works.
- Stream events are normalized.
- Completion/failure maps into job state.

### P4-006 — Chat-to-job pipeline
**Why**  
Provider work should create workspace jobs automatically.

**Depends on**  
P4-004, P4-005, P3-011

**Deliverable**  
Trigger pipeline from chat message to job creation and provider execution.

**Acceptance**
- Sending prompt creates a job.
- Job status updates during run.
- Completed job links back to message thread.

### P4-007 — Provider command event surfacing
**Why**  
Users need to know what the provider is doing.

**Depends on**  
P4-005, P4-006

**Deliverable**  
Chat/jobs/logs surfaces showing commands planned/executed.

**Acceptance**
- Commands appear with timestamps/state.
- User can inspect command history for a task.

### P4-008 — File-change surfacing from provider events
**Why**  
AI work must connect directly to git/editor review flow.

**Depends on**  
P4-005, P3-004, P3-010

**Deliverable**  
Changed-file events connected to git pane and editor open actions.

**Acceptance**
- Provider-touched files are identifiable.
- User can jump from chat/job to changed file/diff.

### P4-009 — Cancellation and failure handling
**Why**  
Real use requires stopping bad runs and understanding failures.

**Depends on**  
P4-006

**Deliverable**  
Cancel action, failure state mapping, retry entry point.

**Acceptance**
- Cancel ends job or clearly reports inability.
- Failed jobs are visible and inspectable.

### P4-010 — Provider capability flags
**Why**  
Later multi-provider support depends on explicit differences.

**Depends on**  
P4-001

**Deliverable**  
Capability flags such as streaming support, approval hooks, file event richness.

**Acceptance**
- UI can adapt to provider capabilities without branching everywhere.

### P4-011 — Codex CLI adapter
**Why**  
Second adapter proves abstraction is real.

**Depends on**  
P4-001, P4-002, P4-010

**Deliverable**  
Codex CLI adapter implementation.

**Acceptance**
- Can run end-to-end through same chat pane.
- No provider-specific UI hacks required for basic function.

### P4-012 — OpenCode adapter
**Why**  
Third adapter completes the initial provider target set.

**Depends on**  
P4-001, P4-002, P4-010

**Deliverable**  
OpenCode adapter implementation.

**Acceptance**
- Can run end-to-end through same chat pane.
- Same lifecycle states appear in jobs/notifications.

### P4-013 — Workspace default provider selection
**Why**  
Users will want workspace-scoped preferred provider.

**Depends on**  
P4-005

**Deliverable**  
Workspace setting for default provider.

**Acceptance**
- Sending prompt uses configured default unless overridden.

### P4-014 — Approval/attention request UX hook
**Why**  
Some providers/tasks may need human confirmation.

**Depends on**  
P4-010, P4-006

**Deliverable**  
Generic "attention needed" state in chat/jobs.

**Acceptance**
- Job can pause awaiting attention.
- UI makes this visually distinct from running/completed.

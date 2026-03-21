# Execution Order and Critical Path

This document answers: **what should be built first, second, third, and what should not start too early**.

## 1. Critical-path principle

The product only works if these foundations are real:

1. workspace model
2. layout model
3. pane system
4. job model
5. one provider working end-to-end
6. workspace-scoped notifications

Anything that does not strengthen those should wait.

## 2. Strict build order

### Step 1 — Lock scope and prove stack
Build:

- P0-001
- P0-002
- P0-003
- P0-004
- P0-005
- P0-006
- P0-007
- P0-008

Do not proceed until:

- Electron is fine
- terminal is viable
- preview is viable
- Monaco is viable
- persistence is viable

### Step 2 — Create the real domain shell
Build:

- P1-001
- P1-002
- P1-003
- P1-004
- P1-005
- P1-006
- P1-007
- P1-008
- P1-009
- P1-010

Do not proceed until:

- project/workspace creation works
- restore works
- sidebar tree works
- workspace selection is stable

### Step 3 — Make the spatial model real before tool depth
Build:

- P2-001
- P2-002
- P2-003
- P2-004
- P2-005
- P2-006
- P2-007
- P2-008
- P2-009
- P2-010
- P2-011
- P2-012

Do not proceed until:

- users can split panes
- pane focus works
- workspaces switch quickly
- sidebar and overview feel coherent

If the shell does not feel spatial and obvious here, stop and fix it before adding AI.

### Step 4 — Add the boring-but-essential core panes
Build in this order:

1. P3-001 Pane registry
2. P3-002 Terminal session manager
3. P3-003 Terminal pane
4. P3-004 Git service
5. P3-005 Git pane
6. P3-006 Diff viewer
7. P3-007 Preview target model
8. P3-008 Preview pane
9. P3-009 File open path
10. P3-010 Editor pane
11. P3-011 Jobs model/service
12. P3-012 Jobs pane
13. P3-013 Logs pane
14. P3-014 Workspace presets using real panes

Why this order:

- terminal proves raw control
- git proves review flow
- preview proves runtime validation
- editor supports inspection
- jobs/logs provide the shell needed for AI

Do not start provider integrations before P3-011 exists.

### Step 5 — Build AI on top of the shell, not before it
Build in this order:

1. P4-001 Provider interface
2. P4-002 Provider executable config
3. P4-003 Chat thread model
4. P4-004 Chat pane
5. P4-005 Claude adapter
6. P4-006 Chat-to-job pipeline
7. P4-007 Command event surfacing
8. P4-008 File-change surfacing
9. P4-009 Cancellation/failure handling
10. P4-010 Capability flags
11. P4-013 Workspace default provider
12. P4-014 Approval/attention hook

Only after that:

- P4-011 Codex adapter
- P4-012 OpenCode adapter

Why:

- one provider proves the core experience
- multiple providers too early will hide design flaws behind adapter complexity

### Step 6 — Make parallel work actually manageable
Build:

- P5-001 Notification service
- P5-002 Toast notifications
- P5-003 Notification inbox
- P5-004 Workspace status badges
- P5-005 Job completion focus action
- P5-006 Workspace activity feed
- P5-007 Preview health monitoring
- P5-009 Overview improvements

Then:

- P5-008 Command palette
- P5-010 Sidebar performance
- P5-011 Layout presets save/load
- P5-012 Workspace lifecycle actions

Do not move to multi-window until notifications and workspace status feel good in one window.

### Step 7 — Add multi-window without breaking the model
Build:

- P6-001 Window registry
- P6-002 Detach workspace
- P6-003 Prevent duplicate workspace windows
- P6-004 Reattach workspace
- P6-005 Restore windows
- P6-006 Global notification routing
- P6-007 Window-aware overview/sidebar
- P6-008 Multi-window runtime sanity
- P6-009 Shortcut/help polish
- P6-010 Onboarding

## 3. Recommended first alpha cut

Ship a private alpha after:

- all of Phase 1
- all of Phase 2
- most of Phase 3
- Phase 4 through Claude adapter
- key Phase 5 notification tickets

Specifically minimum:

- P1-001 through P1-010
- P2-001 through P2-012
- P3-001 through P3-012
- P4-001 through P4-010 and P4-013/P4-014
- P5-001 through P5-005

## 4. What not to start early

Do not start these too soon:

- multi-window
- multiple providers
- pane-local tabs
- advanced preview devtools
- plugin architecture
- cloud sync
- collaboration

These are force multipliers for complexity, not for validation.

## 5. Weekly cadence suggestion

This is a rough solo cadence, not a promise.

### Weeks 1–2
- Phase 0
- set up repo, shell, storage, spikes

### Weeks 3–6
- Phase 1
- project/workspace model
- sidebar foundation
- restore

### Weeks 7–10
- Phase 2
- layout engine
- navigation
- overview
- project jump hints

### Weeks 11–16
- Phase 3
- terminal
- git
- preview
- editor
- jobs

### Weeks 17–22
- Phase 4 with one provider
- chat pane
- adapter contract
- job pipeline

### Weeks 23–28
- Phase 5 essentials
- notifications
- focus return
- status polish

### Weeks 29+
- Phase 6 and beyond
- multi-window
- onboarding
- private alpha hardening

## 6. Phase gates

Before leaving each phase, ask:

### Leaving Phase 1
- Does workspace feel like the top-level object?

### Leaving Phase 2
- Does the app already feel spatial and faster than tabs/windows for switching?

### Leaving Phase 3
- Can you personally do real work in one workspace?

### Leaving Phase 4
- Can one provider complete a meaningful task end-to-end?

### Leaving Phase 5
- Do completed jobs reliably pull your attention back without chaos?

### Leaving Phase 6
- Can a multi-monitor user keep distinct workspaces open safely?

## 7. Kill criteria

If any of these fail badly, stop adding features and fix the base:

- workspace state becomes unreliable
- layout corruption is common
- terminal session stability is poor
- provider jobs cannot be mapped clearly into jobs/notifications
- navigation is clever but not learnable

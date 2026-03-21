# Ticket Backlog — Notifications, Polish, Multi-Window (Phases 5–6)

---

## Phase 5 — Notifications, completion UX, workflow polish

### P5-001 — Notification domain service
**Why**  
Notification logic must not be ad hoc.

**Depends on**  
P3-011

**Deliverable**  
Workspace-scoped notification service and store.

**Acceptance**
- Can create, mark read, dismiss notifications.
- Notifications link to workspace and optional job.

### P5-002 — Toast notification renderer
**Why**  
Completion and failure events need obvious surfacing.

**Depends on**  
P5-001

**Deliverable**  
In-app toast system.

**Acceptance**
- Toast appears on relevant job events.
- Toast click can focus workspace.

### P5-003 — Notification inbox / history pane
**Why**  
Toasts are too ephemeral on their own.

**Depends on**  
P5-001

**Deliverable**  
Dedicated notification list surface or pane.

**Acceptance**
- User can review older notifications.
- Read/unread state works.

### P5-004 — Workspace status badge wiring
**Why**  
Sidebar and overview should reflect real runtime state.

**Depends on**  
P5-001, P3-011

**Deliverable**  
Real badge updates for running jobs, failures, attention needed.

**Acceptance**
- Sidebar badges update live.
- Overview cards update live.

### P5-005 — Job completion focus action
**Why**  
Notification usefulness depends on quick jump back to context.

**Depends on**  
P5-002, P1-006

**Deliverable**  
Action that focuses target workspace and pane/job.

**Acceptance**
- Clicking completion event restores target workspace.
- Relevant pane can be focused where possible.

### P5-006 — Workspace activity feed
**Why**  
Users need a compact "what happened here" history.

**Depends on**  
P5-001, P3-011

**Deliverable**  
Workspace-scoped recent activity timeline.

**Acceptance**
- Shows jobs, notifications, major provider events.
- Sorted and readable.

### P5-007 — Preview health monitoring
**Why**  
Preview crashes/reload failures should be visible.

**Depends on**  
P3-008

**Deliverable**  
Basic health/error signals for preview target.

**Acceptance**
- Broken preview state is visible.
- Workspace receives status signal.

### P5-008 — Command palette / quick actions
**Why**  
Power users need a fast text entry point besides sidebar.

**Depends on**  
P2-009

**Deliverable**  
Command palette with actions for opening workspaces, splitting panes, creating presets.

**Acceptance**
- Can trigger common navigation and layout commands.

### P5-009 — Overview improvements
**Why**  
Initial overview shell will be too thin once the app is real.

**Depends on**  
P2-009, P5-004

**Deliverable**  
Richer overview cards showing workspace status, active provider, preview availability.

**Acceptance**
- Overview is genuinely useful for switching and scanning.

### P5-010 — Sidebar performance and large-count polish
**Why**  
Projects/workspaces will grow.

**Depends on**  
P1-009, P5-004

**Deliverable**  
Virtualization or performance cleanup if needed.

**Acceptance**
- Sidebar remains smooth with larger lists.

### P5-011 — Pane preset save/load
**Why**  
Users will want preferred layouts.

**Depends on**  
P2-011, P3-014

**Deliverable**  
Save custom workspace layout preset.

**Acceptance**
- User can save and reapply a preset.

### P5-012 — Basic workspace actions
**Why**  
Product should support the normal lifecycle of workspaces.

**Depends on**  
P1-003

**Deliverable**  
Rename, archive, close, reopen workspace flows.

**Acceptance**
- Users can manage workspace lifecycle without manual DB edits.

---

## Phase 6 — Multi-window and serious usability pass

### P6-001 — Window registry service
**Why**  
Need explicit ownership model before detaching workspaces.

**Depends on**  
P1-003

**Deliverable**  
Registry of open windows and workspace ownership.

**Acceptance**
- Workspace can be associated with one window.
- Ownership persisted.

### P6-002 — Detach workspace to new window
**Why**  
Multi-monitor users need dedicated workspace windows.

**Depends on**  
P6-001, P1-006

**Deliverable**  
Action to open workspace in its own window.

**Acceptance**
- New window opens with selected workspace.
- Original window no longer renders that workspace as active duplicate.

### P6-003 — Prevent duplicate workspace windows
**Why**  
Product rule says one workspace, one window.

**Depends on**  
P6-001, P6-002

**Deliverable**  
Guard logic and focus-existing-window behavior.

**Acceptance**
- Attempting to open same workspace twice focuses existing owner window.

### P6-004 — Reattach workspace to main window
**Why**  
Users need to move work back.

**Depends on**  
P6-002

**Deliverable**  
Move workspace back into another window/main window.

**Acceptance**
- Workspace can leave detached window cleanly.

### P6-005 — Restore windows on relaunch
**Why**  
Multi-window becomes annoying if restore is broken.

**Depends on**  
P6-001, P6-002

**Deliverable**  
Window restoration using saved ownership.

**Acceptance**
- Relaunch restores previously detached windows or gracefully falls back.

### P6-006 — Global notification routing
**Why**  
Notifications must work across windows.

**Depends on**  
P5-001, P6-001

**Deliverable**  
Notification dispatch that can focus owning window/workspace.

**Acceptance**
- Clicking notification focuses the correct window.
- Notification still appears if workspace lives in another window.

### P6-007 — Window-aware overview and sidebar behavior
**Why**  
Multi-window changes navigation expectations.

**Depends on**  
P6-001, P2-009

**Deliverable**  
UI indicators showing where workspaces live.

**Acceptance**
- User can tell which window owns a workspace.
- Jumping to workspace focuses correct window.

### P6-008 — Multi-window process sanity pass
**Why**  
Terminal/provider/preview services must not break after detach/reattach.

**Depends on**  
P6-002, P6-004

**Deliverable**  
Stability work for runtime services across window moves.

**Acceptance**
- Workspace jobs survive window moves.
- Terminal and preview reconnect or remain stable.

### P6-009 — Usability pass on hotkeys and discoverability
**Why**  
Spatial model needs to be learnable, not just clever.

**Depends on**  
P5-008, P6-002

**Deliverable**  
Shortcut help overlays, labels, and affordance cleanup.

**Acceptance**
- Core shortcuts are discoverable.
- Help surface exists.

### P6-010 — Basic onboarding flow
**Why**  
Product complexity will otherwise overwhelm new users.

**Depends on**  
P6-009

**Deliverable**  
First-run walkthrough or guided setup.

**Acceptance**
- User can add project, create workspace, open terminal/chat/preview from onboarding.

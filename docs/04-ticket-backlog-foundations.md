# Ticket Backlog — Foundations (Phases 0–2)

Format:

- **ID**
- **Title**
- **Why**
- **Depends on**
- **Deliverable**
- **Acceptance**

---

## Phase 0 — Spec freeze and spikes

### P0-001 — Create decision log and scope file
**Why**  
Prevent drift before implementation starts.

**Depends on**  
None.

**Deliverable**  
`docs/decisions/` folder with the locked product decisions and non-goals.

**Acceptance**
- Product category, core panes, stack, preview limitation, workspace/window rules documented.
- Non-goals explicitly written.

### P0-002 — Electron shell spike
**Why**  
Prove the desktop shell can host the app cleanly.

**Depends on**  
P0-001

**Deliverable**  
Minimal Electron app with renderer shell and dev workflow.

**Acceptance**
- App launches from one command.
- Hot reload/dev workflow acceptable.
- IPC round trip proven.

### P0-003 — Monaco pane spike
**Why**  
Verify editor embedding is easy enough for the chosen shell.

**Depends on**  
P0-002

**Deliverable**  
Minimal Monaco-backed editor pane.

**Acceptance**
- Syntax highlighting works.
- Open file text into editor works.
- No obvious blocker for theme/layout resizing.

### P0-004 — xterm.js + PTY spike
**Why**  
Prove terminal is viable early.

**Depends on**  
P0-002

**Deliverable**  
Minimal terminal pane with live shell.

**Acceptance**
- Launches shell on target OS.
- Input/output works.
- Resize handling works.
- Process can be killed.

### P0-005 — Preview spike
**Why**  
Verify preview pane can show local runtime surfaces safely.

**Depends on**  
P0-002

**Deliverable**  
Preview surface loading a local URL.

**Acceptance**
- Localhost page renders.
- Reload works.
- Basic isolation policy decided.

### P0-006 — Persistence spike
**Why**  
Avoid rewriting state persistence later.

**Depends on**  
P0-002

**Deliverable**  
Basic SQLite-backed storage layer.

**Acceptance**
- Can store and reload projects/workspaces.
- Migration strategy chosen.

### P0-007 — CLI executable resolution spike
**Why**  
Provider adapters depend on stable executable lookup.

**Depends on**  
P0-002

**Deliverable**  
Utility layer to find, validate, and launch external binaries.

**Acceptance**
- Can resolve configured executable path.
- Validation error is human-readable.
- Launching a test command works.

### P0-008 — Domain schema draft
**Why**  
Layout, notifications, jobs, and providers all depend on shared types.

**Depends on**  
P0-006

**Deliverable**  
Initial TypeScript domain model definitions.

**Acceptance**
- Project, Workspace, LayoutNode, Pane, Job, Notification types exist.
- Obvious gaps are listed.

---

## Phase 1 — App skeleton and workspace domain

### P1-001 — App shell scaffolding
**Why**  
Need stable app-level shell before feature work.

**Depends on**  
P0-002, P0-008

**Deliverable**  
Root application frame with sidebar rail area and main content area.

**Acceptance**
- App renders without mock-only hacks.
- Layout scales to window resize.

### P1-002 — Project repository layer
**Why**  
Projects are grouping objects and creation sources.

**Depends on**  
P0-006, P0-008

**Deliverable**  
CRUD layer for projects.

**Acceptance**
- Create/read/update/delete project functions exist.
- Project list loads on app start.

### P1-003 — Workspace repository layer
**Why**  
Workspace is the first-class working object.

**Depends on**  
P0-006, P0-008

**Deliverable**  
CRUD layer for workspaces with `windowId` field.

**Acceptance**
- Create/read/update/delete workspace functions exist.
- Workspace links to project.

### P1-004 — Workspace creation flow
**Why**  
The product must create/open workspaces early.

**Depends on**  
P1-002, P1-003, P0-007

**Deliverable**  
UI flow for creating a workspace from a project/branch/worktree config.

**Acceptance**
- User can create a workspace.
- Workspace stores branch name and worktree path.
- Failure paths are surfaced cleanly.

### P1-005 — App boot restore
**Why**  
Product must survive relaunches.

**Depends on**  
P1-002, P1-003

**Deliverable**  
Restore previously known projects/workspaces on app launch.

**Acceptance**
- Relaunch shows existing sidebar structure.
- Last selected workspace can be restored or intentionally ignored by design.

### P1-006 — Workspace selection state
**Why**  
Later navigation depends on stable current selection logic.

**Depends on**  
P1-003

**Deliverable**  
Shared store for current project/current workspace/current pane.

**Acceptance**
- Selection changes are reflected in UI.
- Selection persists where appropriate.

### P1-007 — Main content placeholder workspace view
**Why**  
Need a placeholder shell before pane system exists.

**Depends on**  
P1-006

**Deliverable**  
Workspace landing surface with summary cards/placeholders.

**Acceptance**
- Selected workspace renders content area.
- Empty state is not confusing.

### P1-008 — Sidebar rail foundation
**Why**  
Sidebar is a permanent product structure.

**Depends on**  
P1-001, P1-002, P1-003

**Deliverable**  
Collapsed sidebar rail and expandable container shell.

**Acceptance**
- Rail is always visible.
- Expand on hover works.
- Pin open works.

### P1-009 — Project/workspace tree in sidebar
**Why**  
Navigation must be visible before keyboard polish.

**Depends on**  
P1-008, P1-006

**Deliverable**  
Tree UI showing projects and their workspaces.

**Acceptance**
- Projects group workspaces correctly.
- Current workspace is visually obvious.
- Status placeholder badges can render.

### P1-010 — Workspace summary model
**Why**  
Sidebar and overview need compact status data.

**Depends on**  
P1-003

**Deliverable**  
Derived summary selector/model for workspace status.

**Acceptance**
- Summary includes branch, status, active jobs count placeholder.
- View can consume without deep data pulls.

---

## Phase 2 — Layout, navigation, sidebar, overview shell

### P2-001 — Layout tree schema and persistence
**Why**  
Split panes require a durable layout model.

**Depends on**  
P0-008, P1-003

**Deliverable**  
Layout node schema persisted per workspace.

**Acceptance**
- Horizontal and vertical split nodes supported.
- Pane leaf nodes supported.
- Layout restores after relaunch.

### P2-002 — Layout renderer
**Why**  
Need visible split tree before any real pane work.

**Depends on**  
P2-001

**Deliverable**  
Recursive renderer for split tree and pane placeholders.

**Acceptance**
- Split tree renders nested layouts.
- Resizes are stable.

### P2-003 — Pane placeholder system
**Why**  
Real panes come later; composition system must exist first.

**Depends on**  
P2-002

**Deliverable**  
Pane placeholder component with type badge and focus state.

**Acceptance**
- Placeholder can represent any pane type.
- Focus ring/selection style exists.

### P2-004 — Split/close/resize operations
**Why**  
User must be able to shape a workspace.

**Depends on**  
P2-002, P2-003

**Deliverable**  
Commands for split horizontal, split vertical, close pane, adjust weights.

**Acceptance**
- User can split and close panes without corrupting layout.
- Last pane protection rule defined.

### P2-005 — Pane focus navigation
**Why**  
Left/right pane navigation is a core product promise.

**Depends on**  
P2-002, P2-003

**Deliverable**  
Focus movement logic for pane neighbors.

**Acceptance**
- `Alt + Left/Right` works.
- Up/down neighbor behavior for pane focus is defined or intentionally absent.
- Focus state is never ambiguous.

### P2-006 — Workspace switching shortcuts
**Why**  
Workspaces need fast keyboard switching.

**Depends on**  
P1-006, P1-009

**Deliverable**  
Workspace next/previous shortcut handling.

**Acceptance**
- User can cycle workspaces in current project.
- Current workspace updates correctly in main area and sidebar.

### P2-007 — Ctrl-hold project jump hints
**Why**  
Fast project switching is a deliberate product decision.

**Depends on**  
P1-009

**Deliverable**  
Sidebar overlay showing numeric hints when Ctrl is held.

**Acceptance**
- Hold Ctrl reveals numbers.
- Pressing number jumps project.
- Releasing Ctrl hides hints.

### P2-008 — Sidebar interaction polish
**Why**  
The sidebar is a constant product element.

**Depends on**  
P1-009, P2-007

**Deliverable**  
Keyboard focus, hover intent, pin behavior, selection handling.

**Acceptance**
- Hover does not flicker badly.
- Keyboard access is usable.
- Pinned open state persists.

### P2-009 — Overview shell
**Why**  
Large workspace counts need a global switcher.

**Depends on**  
P1-010, P1-009

**Deliverable**  
Initial overview/modal switcher with projects and workspaces.

**Acceptance**
- Open overview with shortcut.
- Jump to workspace from overview.
- Current selection is obvious.

### P2-010 — Workspace state badges
**Why**  
Later jobs/notifications need visible anchors in sidebar and overview.

**Depends on**  
P1-010

**Deliverable**  
Badge slots and status colors/states for workspace summaries.

**Acceptance**
- Sidebar supports job count, error state, running state placeholders.
- Overview supports same status signals.

### P2-011 — Layout presets
**Why**  
Most users will want common pane arrangements quickly.

**Depends on**  
P2-004

**Deliverable**  
Preset layouts such as chat+terminal, chat+terminal+git, editor+preview+terminal.

**Acceptance**
- User can apply preset to workspace.
- Preset produces correct split tree.

### P2-012 — State repair for invalid layouts
**Why**  
Split trees will get corrupted during development.

**Depends on**  
P2-001, P2-002

**Deliverable**  
Repair/normalize logic for malformed layout states.

**Acceptance**
- Bad or partial layout data does not brick workspace rendering.
- Fallback layout is created when needed.

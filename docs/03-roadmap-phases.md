# Phased Delivery Plan

This roadmap assumes:

- one-person core team
- heavy AI assistance for implementation
- battle-tested components reused aggressively
- strict scope discipline
- Windows/macOS/Linux support target, but platform parity may lag during early phases

## Timeline honesty

Rough, realistic ranges:

- **Prototype**: 4–8 weeks
- **Personal daily-driver alpha**: 3–5 months
- **Private alpha for others**: 6–9 months
- **Public beta with multi-window**: 9–15 months

These ranges assume you do not rebuild editor/terminal primitives and you keep preview limited.

## Phase map

### Phase 0 — Spec freeze and spike
Goal:

- lock product boundaries
- prove stack choices
- avoid building the wrong thing

Deliverables:

- technical decision records
- Electron spike
- Monaco spike
- xterm spike
- preview spike
- initial domain schema

Exit criteria:

- Electron shell runs
- Monaco pane renders
- terminal pane renders through PTY
- preview loads local URL
- no stack blocker found

### Phase 1 — App skeleton and workspace domain
Goal:

- build the app shell
- establish durable domain model
- make workspace the core object

Deliverables:

- project/workspace storage
- window/app shell
- sidebar rail shell
- workspace creation/open/close
- base routing/state

Exit criteria:

- user can create/import a project
- user can create a workspace
- user can reopen app and recover workspace list/state
- no panes yet beyond placeholders

### Phase 2 — Layout, navigation, sidebar, overview shell
Goal:

- make the app feel spatial and usable before real tool depth

Deliverables:

- split tree layout engine
- pane focus movement
- sidebar with project/workspace tree
- hover/pin states
- overview switcher shell
- direct project jump hints

Exit criteria:

- user can split panes
- user can switch pane focus with keyboard
- user can switch workspaces
- user can jump projects from sidebar hints
- structure feels coherent before tool integrations deepen

### Phase 3 — Core panes
Goal:

- make the shell actually useful

Deliverables:

- terminal pane
- git pane
- preview pane
- editor pane
- jobs pane
- basic logs pane

Exit criteria:

- user can do real work in one workspace
- git + terminal + preview + editor + jobs all function
- pane combinations are stable

### Phase 4 — Chat and provider adapter layer
Goal:

- turn the shell into an AI-native product

Deliverables:

- chat pane
- provider abstraction
- first provider integration
- streaming output model
- job creation from chat
- command and diff surfacing

Exit criteria:

- user can prompt from chat pane
- provider actions create trackable jobs
- file changes and command activity appear in workspace context
- one provider works end-to-end

### Phase 5 — Notifications, completion UX, workflow polish
Goal:

- make long-running parallel work actually manageable

Deliverables:

- workspace-level notifications
- job history
- actionable toasts/inbox
- overview improvements
- better workspace switching
- preview health signals

Exit criteria:

- a finished job is hard to miss
- user can jump from notification to target workspace/pane
- job history is useful rather than noisy

### Phase 6 — Multi-window and serious usability pass
Goal:

- support multi-monitor users without destroying the model

Deliverables:

- detach workspace to window
- window ownership rules
- restore detached windows
- global notification routing
- focus/follow behavior

Exit criteria:

- a workspace can move to its own window
- the same workspace cannot open in two windows
- notifications still behave sanely across windows

### Phase 7 — Hardening, packaging, and private alpha
Goal:

- get it from clever prototype to something people can live in

Deliverables:

- crash handling
- state repair
- installer packaging
- logs/support bundle
- basic onboarding
- settings hygiene
- platform cleanup

Exit criteria:

- installable on all target platforms
- settings do not feel random
- recovery from bad state is possible
- enough stability for external testers

## Suggested milestone naming

- M0: Stack proven
- M1: Workspace shell alive
- M2: Spatial shell usable
- M3: One real workspace useful
- M4: AI loop functional
- M5: Parallel work manageable
- M6: Multi-monitor capable
- M7: Private alpha

## Strict scope cuts if timeline slips

Cut in this order:

1. pane-local tabs/stacks
2. editor improvements beyond basic Monaco
3. OpenCode adapter
4. Codex adapter
5. multi-window
6. advanced preview debugging
7. overview animation polish

Never cut:

- workspace model
- split layout
- terminal
- git
- preview
- notifications
- one provider working end-to-end

## Phase dependencies summary

- Phase 2 depends on Phase 1 domain stability
- Phase 3 depends on Phase 2 layout/navigation
- Phase 4 depends on Phase 3 jobs and pane infrastructure
- Phase 5 depends on Phase 4 job events and provider lifecycle
- Phase 6 depends on Phase 1–5 state model discipline
- Phase 7 depends on everything else

## MVP line

The first version that actually proves the product is:

- Phase 1 complete
- Phase 2 complete
- Phase 3 complete
- Phase 4 with **one** provider
- partial Phase 5 for notifications

If that is good, the product is real.
If that is weak, more features will not save it.

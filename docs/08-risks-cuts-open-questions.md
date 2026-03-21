# Risks, Cuts, and Open Questions

## 1. Main risks

### Risk A — Product identity drift
The product can easily drift into:

- a bad editor
- a bad browser
- a bad terminal multiplexer
- a thin wrapper over existing tools

**Mitigation**
- keep workspace orchestration as the center
- make every feature answer: "Does this reduce fragmentation between workspaces, jobs, and review?"

### Risk B — Layout system complexity
Split trees can get ugly fast.

**Mitigation**
- keep layout tree simple
- add pane-local stacks later
- add repair logic early

### Risk C — Provider abstraction lies
Adapters may look unified on paper but differ too much in practice.

**Mitigation**
- implement one provider first
- design around normalized job lifecycle, not provider parity fantasies

### Risk D — Preview scope creep
Preview can drift toward "browser inside app."

**Mitigation**
- enforce preview-only framing
- externalize non-project browsing

### Risk E — Multi-window chaos
Multi-window can wreck the state model if introduced too early.

**Mitigation**
- build workspace-owned runtime services first
- enforce one-workspace-one-window rule

### Risk F — Notification spam
Notifications can become noise and train users to ignore them.

**Mitigation**
- workspace-level grouping
- severity levels
- history/inbox
- actionable focus return

### Risk G — Overbuilding the editor
This is a trap because existing editors are already deep and battle-tested.

**Mitigation**
- keep Monaco basic
- no early LSP rabbit hole
- use editor for inspection and edits only

## 2. Things to cut first if behind

Cut in this order:

1. pane-local tab stacks
2. advanced editor features
3. OpenCode adapter
4. Codex adapter
5. detachable multi-window
6. fancy overview visuals
7. advanced preview diagnostics

## 3. Things not to cut

Never cut these and expect the product to still prove itself:

- workspace first-class model
- sidebar + overview
- split pane layout
- terminal pane
- git pane
- preview pane
- jobs model
- one provider end-to-end
- notifications tied to jobs/workspaces

## 4. Open questions that do not block phase 0–2

### Q1 — Pane-local tabs or no?
Recommendation:
- no in early build
- revisit after real workspace use

### Q2 — Should a window host multiple workspaces or one only?
Recommendation:
- support multiple in main window
- detached windows may be one-workspace-only initially

### Q3 — How aggressive should job notifications be?
Recommendation:
- start conservative
- add severity classes
- avoid notification spam by default

### Q4 — Should editor writes auto-refresh preview?
Recommendation:
- rely mostly on dev server/hot reload initially
- do not invent heavy coupling before needed

### Q5 — How much Git write support in v1?
Recommendation:
- safe basics first
- inspect, stage, unstage, discard selected
- deeper flows later

## 5. Honest feasibility notes

### What is very achievable
- Electron shell
- sidebar + overview
- split layout
- Monaco
- xterm.js terminal
- git pane via CLI
- preview pane
- one provider adapter
- jobs/notifications

### What is achievable but expensive
- robust multi-window
- three provider adapters with high polish
- deep Git operations
- excellent cross-platform terminal behavior

### What is dangerous for a solo builder
- plugin ecosystems
- collaboration
- fully general embedded browser
- "build a better VS Code" thinking
- too much provider-specific UI logic

## 6. Product test that matters most

The product is working when this loop feels better than using separate tools:

1. open workspace
2. ask AI to do work
3. watch/inspect in terminal and jobs
4. review in git/editor
5. validate in preview
6. get notified when background work finishes
7. jump between parallel workspaces without losing the plot

If this loop is not clearly better, more features will not save it.

## 7. Recommended internal repos / packages

Suggested package split once codebase grows:

- `app-shell`
- `domain-model`
- `workspace-runtime`
- `pane-kit`
- `provider-adapters`
- `git-service`
- `terminal-service`
- `preview-service`
- `notifications`

This is optional early. Do not microservice your desktop app.

## 8. Recommended first dogfood workflow

When the first usable alpha exists, dogfood these scenarios:

1. one workspace, terminal + git + preview + chat
2. two workspaces in one window, both with running jobs
3. project jumping via sidebar + Ctrl hints
4. notification from background provider task back into git review
5. preview broken state and recovery
6. detach workspace to second window later

## 9. Final blunt guidance

Keep asking:

- Is this a better way to supervise AI coding work?
- Or is this just another way to arrange panes?

Build only the first kind.

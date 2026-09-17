# Fleet drawer verification

Verified on Linux on 2026-09-18 for beads `aide-7kw` and `aide-imi`.

## Behavior

The Agent fleet toolbar button opens Plan first. The graph shows dependencies,
reported completion, selected-node evidence, and explicit user acceptance.
Live flow shows a connected orchestrator, required Jev, routing decision,
configured agent branches, and outcome. Active paths animate from correlated
runtime activities. Node selection reveals recorded reasons and evidence.
The chronological log stays collapsed. Reduced-motion preferences stop traces.
Configured branches survive restart, and saved activity remains still.
Missing provider usage or prices keep total cost incomplete.

Main validates plan tools and persists fleet state in the existing session JSON.
Acceptance survives restart without starting a provider. Changed nodes invalidate
their acceptance and dependent acceptance. Unrelated accepted nodes remain intact.
Planned consultations require a node id and stop at the persisted attempt limit.
Different task titles or dependencies reset the count for a reused node id.

New panes, splits, and added views receive unique instance IDs. Separate Agent
panes cannot share a session accidentally. Saved-task reopen preserves its ID.

## Checks

- Node 24.17.0 Vitest: 599 tests across 94 files passed with global Git config disabled.
- The real Claude MCP transport advertised the plan schema, accepted a valid plan,
  and rejected a dependency cycle before calling the manager.
- TypeScript and the production build passed.
- Biome passed with 16 existing warnings and two informational findings.
- React Doctor 0.7.1 completed with zero errors and 218 advisory warnings.
- Renderer budget passed: initial JavaScript 1247.37 kB and CSS 523.55 kB.
- Electron suite: all 33 journeys passed in one run. The focused drawer journey
  also passed with held Jev preparation and an interrupted consultation.
- Drawer checks cover Plan-first navigation, node selection, disabled acceptance,
  paused Jev preparation, active consultation, decision reasons, reduced motion,
  interruption, unknown costs, Escape and focus return, pane isolation, restart,
  and a narrow viewport.
- Screenshots were inspected at 1280 by 800 and 760 by 620. Provider responses in
  the screenshots are synthetic test fixtures.

## Fleet and Jev

Sol high implemented the shared policy and drawer in separate worktrees.
Terra high implemented the provider tools and reviewed the integrated UI.
The root agent integrated main-process state, IPC, persistence, and desktop tests.
Independent review found three runtime defects; regression tests cover each fix.

Jev 1.13.0 classified the persistence boundary and opinion permission constraint.
The request took 0.882 seconds with 6568 input tokens and 72 output tokens.
The complete result is in `verification/fleet-drawer-jev-2026-09-18.json`.
Jev also classified four synthetic activity cases in 0.715 seconds with 630 input
and 118 output tokens. The current consultation was active; historical starts,
configured-only branches, and completed work were static. The result is in
`verification/fleet-flow-jev-2026-09-18.json`.
These measurements do not establish a speed or cost saving against a baseline.

Sol high implemented the flowcharts and fixed shared pane identity allocation.
Terra high reviewed runtime correlation and the graph. Regression checks cover
exact consultation identity, context preparation before a provider turn,
parallel returns, long dependency routes, and state after restart.

## Screenshots

![Plan and acceptance](verification/fleet-plan-2026-09-18.png)

![Live flow and incomplete costs](verification/fleet-live-2026-09-18.png)

![Narrow drawer after restart](verification/fleet-narrow-2026-09-18.png)

## Remaining scope

`aide-3zf` tracks cost-complete budget admission. The current scorecard reports
known costs without promising a hard dollar spending cap. Opinion agents retain
their existing read-only permissions. Coding-worker worktrees and public release
signing remain separate from this drawer.

---
name: prd-to-beads
description: Break a PRD into thin vertical-slice beads with dependencies and acceptance criteria. Use when a PRD is ready to become executable work.
---

Turn a PRD into independently grabbable beads.

Process:

1. Read the PRD from `docs/prd/` or the user-provided path.
2. Explore the current codebase and existing beads so you do not duplicate work.
3. Break the PRD into tracer-bullet vertical slices. Do not create horizontal layer tickets.
4. For each proposed slice, define:
   - Title
   - Execution mode: `AFK` or `HITL`
   - Blockers
   - Acceptance criteria
   - User stories covered
5. Check the granularity with the user if the decomposition is ambiguous.
6. Create beads in dependency order using `bd create`, then wire blockers with `--deps` or `bd dep`.

Vertical-slice rules:

- A slice must cut through all relevant layers end to end.
- A completed slice must be demonstrable or directly verifiable.
- Prefer many thin slices over a few fat slices.
- Prefer `AFK` slices unless a real product or design decision requires `HITL`.

Repo-specific rules:

- Use beads, not GitHub issues.
- Attach the slice to the correct phase epic when possible.
- Put `Execution mode: AFK` or `Execution mode: HITL` at the top of the bead description.
- Include quality gates in acceptance criteria when they matter: `bun test`, `bun run build`, `bunx @biomejs/biome check .`, and `npx -y react-doctor@latest .`.
- Avoid creating pane-heavy tickets before navigation and workspace behavior are adequately represented.

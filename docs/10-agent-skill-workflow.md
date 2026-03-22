# Agent Skill Workflow

This repo uses a beads-native adaptation of Matt Pocock's software creation flow.

The goal is to make agent work predictable, scoped, and reviewable before code is written.

## Workflow

### 1. `grill-feature`

Use for new ideas, refactors, and any feature where scope is still fuzzy.

Output:

- locked decisions
- open questions
- recommended defaults

### 2. `write-prd`

Use when the feature needs a durable planning artifact.

Output:

- a PRD in `docs/prd/`
- user stories
- interaction model
- implementation decisions
- testing decisions

### 3. `prd-to-beads`

Use when the PRD is ready to become executable work.

Output:

- thin vertical-slice beads
- dependencies
- acceptance criteria
- `AFK` or `HITL` execution mode

### 4. `ship-bead`

Use when implementing one ticket.

Output:

- claimed bead
- code and tests
- quality gates run
- one focused commit
- closed bead

### 5. `deepen-architecture`

Use after a surge of development or when the repo feels hard to navigate.

Output:

- deep-module refactor candidates
- recommended interface direction
- follow-up bead or design note

## Default Routes

### Large feature

`grill-feature -> write-prd -> prd-to-beads -> ship-bead -> deepen-architecture`

### Medium feature

`grill-feature -> prd-to-beads -> ship-bead`

### Small bug or scoped fix

`ship-bead`

### Weekly maintenance

`deepen-architecture`

## Repo Rules

- beads is the execution system
- PRDs live in `docs/prd/`
- one commit per completed bead
- use Bun and Vite by default
- after meaningful implementation changes run:
  - `npx -y react-doctor@latest .`
  - `bunx @biomejs/biome check .`
- before closing a code bead, run the relevant checks such as:
  - `bun test`
  - `bun run build`

## Product Bias

- navigation and workspace flow are first-class
- panes are secondary to navigation quality
- workspace is the top-level runtime object
- keyboard and focus behavior should be explicit in planning artifacts

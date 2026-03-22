---
name: deepen-architecture
description: Find architecture friction and propose deeper module boundaries that make the repo easier to test and easier for agents to navigate.
---

Use this skill after a burst of feature work or when the codebase feels seam-heavy and hard to reason about.

Process:

1. Explore the codebase and note where understanding one concept requires bouncing across many files.
2. Find shallow modules, seam-heavy logic, and boundaries that make testing harder than it should be.
3. Present a numbered list of deepening candidates with:
   - the cluster of modules involved
   - why they are coupled
   - the testing impact
   - the likely payoff
4. For the selected candidate, compare multiple interface shapes.
5. Recommend one direction and explain why.
6. Record the result as either:
   - a bead for a refactor slice, or
   - a design note in `docs/` if more planning is required first.

Repo-specific focus:

- Favor boundaries that clarify workspace, navigation, layout, and execution flow.
- Prefer deeper modules with simple public interfaces over file-count optimization.
- Replace shallow internal tests with boundary tests when the deeper module is in place.

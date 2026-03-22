---
name: ship-bead
description: Execute one bead safely using TDD, repo quality gates, commit-per-ticket discipline, and beads state updates. Use when implementing scoped work.
---

Use this skill to implement exactly one bead at a time.

Process:

1. Claim the bead with `bd update <id> --status in_progress`.
2. Read the bead, the relevant docs, and the existing code.
3. Follow a vertical TDD loop:
   - write one test for one behavior
   - make it pass with minimal code
   - refactor only while green
4. Implement only the scope needed for the bead.
5. After meaningful changes, run:
   - `npx -y react-doctor@latest .`
   - `bunx @biomejs/biome check .`
6. Run the relevant project checks before closing the bead, usually:
   - `bun test`
   - `bun run build`
7. Commit one focused change for the bead using a conventional commit.
8. Close the bead with `bd close <id>` and sync with `bd sync`.

Repo-specific rules:

- One commit per completed bead.
- Do not batch unrelated work into one bead or one commit.
- Include the bead ID in the commit message when practical.
- Preserve any existing user work you did not create.
- At session end, follow `AGENTS.md` and push the finished work.

---
name: grill-feature
description: Stress-test a feature or refactor for this repo until scope, navigation behavior, data flow, and acceptance criteria are clear. Use when planning new product work.
---

Use this skill before planning or coding a non-trivial feature.

Process:

1. Read the relevant docs and code first. Prefer answering questions by exploring the repo over asking the user.
2. Interrogate the feature until there is a shared understanding of:
   - user goal
   - entry points and navigation flow
   - keyboard behavior
   - persistence needs
   - failure states
   - what is explicitly out of scope
3. Walk the design tree branch by branch. Do not accept vague answers if the vagueness changes implementation.
4. For each open question, provide a recommended default answer.
5. End with a compact artifact containing:
   - Locked decisions
   - Open questions
   - Recommended defaults
   - Suggested next step: `write-prd`, `prd-to-beads`, or direct implementation

Repo-specific priorities:

- Navigation and workspace flow come before pane sophistication.
- Workspace is the top-level runtime object.
- Prefer Bun, Vite, Electron, React, TypeScript, and Biome.
- If a question is already answered by `docs/` or `docs/decisions/`, treat that as the default unless the user overrides it.

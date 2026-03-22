---
name: write-prd
description: Turn a clarified feature idea into a durable PRD for this repo. Use when a feature needs a written spec before tickets are created.
---

Use this skill after `grill-feature` or whenever a feature needs a durable planning artifact.

Process:

1. Read the relevant product docs, architecture docs, and existing decisions.
2. If the feature is still underspecified, run the equivalent of `grill-feature` first.
3. Sketch the major modules or subsystems that will change. Favor deep, testable module boundaries over many shallow seams.
4. Write the PRD to `docs/prd/<slug>.md`.
5. Use this template:

<prd-template>

# <Feature Name>

## Problem Statement

Describe the problem from the user's point of view.

## Solution

Describe the intended behavior from the user's point of view.

## User Stories

Use numbered user stories in the format:

1. As a <actor>, I want <behavior>, so that <benefit>

Make this list extensive enough to drive ticket creation.

## Navigation and Interaction Model

Document the spatial model, navigation rules, shortcut expectations, focus behavior, and key state transitions.

## Implementation Decisions

Capture stable technical decisions without tying them to exact file paths.

## Testing Decisions

Capture which behaviors matter most, what boundary tests should exist, and what quality gates define done.

## Out of Scope

List the cuts and non-goals explicitly.

## Further Notes

Anything else that should survive handoff.

</prd-template>

Repo-specific rules:

- PRDs live in `docs/prd/`, not GitHub issues.
- Reference existing docs instead of duplicating settled product decisions.
- For this repo, always call out navigation, workspace, and keyboard behavior if they are affected.

# ADR 0001: Product Scope and Non-Goals

- Status: Accepted
- Date: 2026-03-21
- Sources: `docs/01-product-decisions.md`, `docs/03-roadmap-phases.md`, `docs/08-risks-cuts-open-questions.md`

## Context

The repo already defines the product direction at a high level, but implementation needs a concise scope file that makes the first build decisions hard to misread.

## Decision

The product is a cross-platform, Electron-first, AI-native coding shell.

It is optimized for:

- workspace orchestration
- AI-assisted coding
- chat-driven task steering
- terminal-heavy workflows
- git review
- local preview and validation
- jobs, logs, and notifications

The first meaningful tool surfaces are:

- chat
- terminal
- git
- preview
- editor
- jobs
- logs

The product differentiates on:

- workspace-first operating model
- pane-oriented layout and navigation
- job orchestration
- workspace-scoped notifications
- provider adapter layer

## Non-goals

The initial product is not:

- a full traditional IDE
- a full browser
- a window manager
- a terminal multiplexer replacement
- a VS Code replacement on day one
- a plugin marketplace
- a collaboration platform
- a cloud sync product

## Consequences

- Features that pull the app toward browser scope, editor scope, or plugin scope should be rejected unless they directly improve the core workspace supervision loop.
- Preview remains limited to workspace-related runtime surfaces rather than general browsing.
- Early milestones should optimize for one strong end-to-end workflow instead of breadth.

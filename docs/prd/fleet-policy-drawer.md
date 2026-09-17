# Fleet policy and execution drawer

## Problem

Aide conversations expose model replies without a durable plan, dependencies,
routing explanations, or accepted outcomes. Token totals alone cannot show
whether another consultation helped finish the task.

## Behavior

The shell opens a right drawer with Plan selected and Live flow available.
Plan shows the orchestrator's architecture summary, dependency graph, status,
evidence, and user acceptance. Live flow shows actual Jev preparation, model
consultations, provider turns, errors, and concise routing explanations.
Selecting a node shows its details. The active workspace and pane own the view.
Closing the drawer returns focus. Narrow windows retain access to Close.

The orchestrator publishes plans through validated provider tools. Main stamps
runtime events and persists the plan in existing session JSON. Old sessions
remain readable. Plans reject duplicate identifiers, missing dependencies,
cycles, and oversized payloads. Model reports cannot accept their own results.
Changed reports invalidate acceptance. Dependencies must be accepted first.

## Fleet policy

`src/shared/fleet-policy.json` owns defaults for Aide and repository fleet work.
Sol medium is the normal worker recommendation. Risk can justify high or xhigh
immediately. Reasoning failures justify more effort; repeated wrong hypotheses
justify an available Opus alternate. Missing context requires retrieval.
Infrastructure failures stop dispatch. Architecture decisions return to the
orchestrator. Explicit configured agents retain their model selections.

Jev preparation remains mandatory in the production dispatch path. Existing
agents provide read-only opinions. The selected orchestrator retains write
permissions. Limit parallel consultations, attempts per plan node, and elapsed
time for each consultation. Record actual model and effort alongside the
recommendation, even when the user chooses a different model.

## Scorecard and evidence

Show accepted versus reported completion, attempts, elapsed provider time,
tokens, and available cost estimates. Costs include failed work and Jev where
reported. Unknown prices remain unknown. Conversation cost divided by accepted
nodes is an allocation, not precise per-node billing. Truncated event history
shows the dropped count and preserves attempt counts separately.

## Acceptance

- Both providers expose plan and progress tools with the same validation.
- Plans and user acceptance survive restart without starting a provider.
- Required preparation, consultations, and failure events reach the live view.
- Policy limits reject excess attempts and concurrent consultation.
- The drawer opens on Plan, switches tabs, selects nodes, and supports keyboard close.
- Tests cover malformed plans, acceptance invalidation, runtime failures,
  persistence, pane isolation, and the Electron interaction.

## Limits

This slice does not grant opinion agents filesystem writes. Automated coding
workers need isolated worktrees and their own permission flow. Provider prices
are incomplete, so the scorecard cannot promise a hard dollar spending cap.
Routing recommendations use declared rules rather than learned benchmark scores.
Public release signing and cross-platform acceptance remain separate gates.

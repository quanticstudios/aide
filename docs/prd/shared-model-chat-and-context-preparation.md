# Shared model chat and context preparation

Status: Draft. Shared chat and a Linux private-team alpha are recommended
defaults pending confirmation. No runtime implementation is included.

## Problem Statement

Developers need a second model's opinion without copying a conversation between
panes. Changing the selected model must give the receiving model enough context
to answer the next message. A visible transcript alone does not meet that need.

Coding models also spend tokens reading optional evidence. Aide needs to measure
complete task cost and select useful original excerpts before model execution.

## Solution

Extend the existing managed-agent pane with one shared conversation, a default
model, and explicit recipients for individual messages. Start with the existing
Claude and Codex providers. Provider aliases resolve to configured model IDs;
autocomplete also exposes those model IDs when a user wants a specific model.

Examples:

```text
How should we handle session expiry?       -> conversation default
@Codex critique Claude's proposed approach -> Codex for this message
@Claude revise the plan using that concern -> Claude for this message
```

A mention does not change the conversation default. The existing model picker
sets the default explicitly. Display the selected recipients before submission
and label each answer with the provider and actual model used.

Prepare task context inside Aide. Deterministic retrieval runs first. An optional
Jev selector ranks excess optional excerpts. Required project instructions and
explicitly referenced evidence remain included. Return original text with paths
and line ranges, never a selector-generated summary.

## User Stories

1. As a developer, I want ordinary messages to use my selected default model,
   so that I do not need to choose a recipient each time.
2. As a developer, I want to mention another model in the same conversation,
   so that I can request a second opinion with the relevant history included.
3. As a developer, I want to address both configured models,
   so that I can compare their answers to the same question.
4. As a developer, I want recipient and model labels on each answer,
   so that I can distinguish the advice I receive.
5. As a developer, I want the conversation to survive app restart,
   so that I can continue reviewing earlier decisions.
6. As a developer, I want to cancel or retry one response,
   so that a failed provider does not discard another model's answer.
7. As a developer, I want second opinions to use read-only permissions by default,
   so that asking for advice does not start competing file edits.
8. As a developer, I want Aide to select relevant evidence automatically,
   so that I can describe the task without managing the context selector.
9. As a maintainer, I want usage and cost estimates for failed and successful
   attempts, so that retries count toward the cost of an accepted fix.
10. As a workspace owner, I want to control external context processing,
    so that code reaches TypeSafe only under the workspace's approved policy.

## Navigation and Interaction Model

- Preserve the workspace and surface hierarchy in the accepted
  [spatial shell decision](../decisions/0004-spatial-shell-hierarchy-and-camera-model.md).
  Extend the managed-agent pane rather than adding a separate chat product.
- New conversations inherit the workspace's saved provider/model choice.
  Persist the conversation default separately from per-message recipients.
- Offer recipient autocomplete when the composer starts with `@` or after
  another recipient. Treat email addresses, code blocks, and ordinary embedded
  `@` text as message content. Selected recipients are explicit composer data.
- Arrow keys navigate suggestions. Enter or Tab selects a suggestion without
  submitting the message. Escape closes suggestions without clearing the draft.
  Enter submits when suggestions are closed. Shift+Enter inserts a newline.
- Preserve draft text, cursor, and scroll position when changing recipients.
  Announce selection and response state through accessible labels/live regions.
- Unknown explicit recipients and unavailable models produce an actionable
  composer error. Preserve the draft and do not silently substitute a provider.
- Multiple recipients receive the same immutable pre-response conversation
  snapshot. Their answers remain separate. Partial failure retains successful
  answers and offers retry only for the failed response.
- Default second-opinion requests to read-only operation. Build mode targets one
  model. Reject multi-recipient Build requests with an explanation in the composer.
- Serialize Build turns within a conversation. Require completed or cancelled
  turns before changing their settings. Keep provider permissions authoritative.
- Persist committed messages before dispatch. On restart, mark unfinished
  responses interrupted. Never automatically replay commands or approvals.
- Keep notifications attached to the owning workspace. Detaching a window must
  not create a second owner of the conversation or its provider processes.

## Implementation Decisions

### Conversation ownership

The main process owns conversation state and recipient routing. Reuse SQLite,
the current IPC/event pattern, provider capability resolution, and existing
Claude/Codex adapters. The renderer submits a message and explicit recipients;
it does not choose workspace roots or construct provider history.

Persist messages, response status, provider/model attribution, the default
selection, and usage records. Keep provider-native session identifiers separate
from the Aide conversation identifier. Resume provider sessions where supported.
If resumption fails, retain the transcript and show that a fresh session starts.

Before dispatch, give each recipient the original request, applicable project
instructions, and relevant committed conversation history. Include attributed
answers from other models. Do not transfer hidden reasoning, native tool-call
IDs, approval state, or another provider's privileged message roles. Treat
transferred answers as quoted conversation content, not new system instructions.

Apply a documented history budget. Include the current question and user-pinned
messages; show omitted-history state rather than claiming the full conversation
reached the model. Track the last delivered conversation revision for resumed
sessions to avoid replaying the same history on every turn.

### Usage accounting

Record provider, actual model ID, attempt, runtime generation, input/output
tokens, cache-read and cache-creation tokens, and available USD estimates.
Capture failed and cancelled attempts when the provider supplies usage.
Unavailable usage remains unknown rather than zero.

Normalize cumulative provider reports within their native query/session scope.
Do not add each cumulative report as a new charge. Handle reset and restart
boundaries explicitly. Provider switches retain earlier usage records.
Separate provider-reported estimates from authoritative billing and from
subscription capacity. Include context-selector calls in task totals.

### Context preparation

Use one main-process preparation service before eligible coding requests and
expose the same service as a query-only `find_relevant_context` tool for Claude.
Use the existing managed-session dispatch path. Preserve the visible user
message, normal file tools, permission behavior, and cancellation.

Retrieve from the authorized workspace only. Reuse path containment checks;
exclude ignored files, secrets, binary content, and symlink escapes. Limit file
count, excerpt size, total input size, and elapsed retrieval time. Identify each
excerpt by path, line range, and content revision. Invalidate stale results.

Skip Jev when the eligible candidates already fit the context budget. The fixed
rubric asks whether an identified excerpt helps investigate or implement the
task. Required instructions and explicit evidence never compete for ranking.
Preserve a deterministic baseline allocation when applying selection.

Use the following developer-controlled rollout modes:

- `off`: deterministic preparation only, with no Jev calls.
- `shadow`: record Jev selection but deliver the deterministic result.
- `active`: deliver the evaluated selection.

Start with two calls per task and a two-second per-call deadline, subject to
synthetic validation. Cache exact requests by task, snapshot, model, rubric,
and candidate content. A timeout, malformed response, or exhausted budget uses
the deterministic fallback. Cancellation stops dispatch rather than falling
through to an unwanted coding request.

Keep the TypeSafe credential in main-process credential storage. Do not place
it in renderer state, transcripts, logs, or repository configuration. Live
validation starts with synthetic input. External workspace processing defaults
off until the workspace policy permits TypeSafe processing.

### Delivery order

1. Correct usage accounting with cumulative, failure, and provider-switch checks.
2. Persist shared conversations and prove cross-provider history delivery.
3. Add a default model and single-recipient mentions in the existing composer.
4. Add two-recipient read-only comparison with independent failure/cancellation.
5. Implement deterministic context preparation and the Claude query-only tool.
6. Add Jev behind `off`/`shadow`/`active` modes and validate synthetic requests.
7. Run the paired evaluation before enabling Jev for approved workspaces.

Each slice needs a bead with acceptance criteria before implementation. The
conversation work and context work reuse accounting but can ship separately.

## Testing Decisions

- An end-to-end conversation must show Claude a fact, ask Codex about it, and
  verify the Codex adapter receives that fact. Seeing it in the UI is insufficient.
- Test default persistence, per-message override, recipient attribution,
  autocomplete keyboard behavior, unavailable recipients, and literal `@` text.
- Test restart recovery, failed resume, late provider events, duplicate dispatch,
  cancellation, per-recipient retry, and partial comparison failure.
- Prove second-opinion tools cannot write files or start arbitrary commands.
- Test cumulative usage updates, failed results, cache creation, query resets,
  absent usage, and provider switches without double-counting.
- Test retrieval containment, secret exclusion, mandatory evidence preservation,
  changed files, Jev response validation, deadlines, budgets, and cancellation.
- Compare the current workflow, deterministic preparation, and Jev selection.
  Hold coding model, effort, permissions, task start state, context budget,
  and independent acceptance tests constant between deterministic and Jev runs.
- Use 30–50 paired representative tasks as an initial pilot. Measure total
  estimated model cost per accepted fix, acceptance rate, extra investigation,
  latency, and human correction time. Record failures and uncertainty.
- Treat 20% lower cost versus deterministic preparation as a proposed activation
  target, not a forecast. Define acceptable quality/latency thresholds before
  the pilot. Keep Jev off when deterministic preparation performs equally well.
- Run repository quality gates and the applicable Electron scenarios before
  closing implementation beads. Validate with real provider sessions before
  claiming production readiness.

## Out of Scope

- Automatic model downgrades, autonomous model debates, or automatic synthesis
- Jev as a chat participant, approval authority, or patch-completion judge
- A new orchestration server, provider wrapper product, or general plugin system
- Concurrent editing by multiple recipients of a comparison request
- Bug-to-test relevance grading before the context-selection pilot succeeds
- Cloud conversation sync or shared multi-user conversations

## Further Notes

Locked requirements are the existing managed-agent UI, easy access to two
models, a default recipient, optional mentions, and context selection before
expensive model reading. Shared history, comparison defaults, and release
audience remain proposed decisions until confirmed.

Open questions and recommended defaults:

- Shared conversation or independent conversations? Use shared conversation.
- Initial providers? Use the installed Claude and Codex integrations; discover
  model choices through their existing capabilities.
- Initial audience? Use a small trusted Linux team before public distribution.
- Mention behavior? Override only the current message; retain the default.
- Opinion permissions? Use read-only tools with one writer for Build turns.
- Jev activation? Keep it off until external processing is approved and the
  pilot meets predeclared quality and cost thresholds.

The supplied text describes a starter package with 35 tests, but the supplied
attachments contain only duplicate prose. Inspect the actual package if it
becomes available; do not treat its claimed test count as Aide verification.
Confirm API semantics and a pinned available model against official TypeSafe
documentation during implementation. [TypeSafe](https://typesafe.ai/) describes
Jev as a typed decision model, which supports its proposed internal role.

Suggested next step: confirm the product defaults, then use `prd-to-beads` to
create the slices above. The [readiness assessment](../19-production-readiness.md)
lists the release work separately.

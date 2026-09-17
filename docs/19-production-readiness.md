# Aide production readiness

Assessment date: 2026-09-17. Source commit:
`cab2381945c0d07c1eca8636c4d73313b1bf0296` on `main`.

## Verdict

Aide has a working desktop foundation and release machinery. A public production
release is not verified. Shared multi-model context and Jev preparation require
implementation. A controlled Linux private alpha is the first practical target.

The feature scope is in the
[shared-model chat and context-preparation PRD](prd/shared-model-chat-and-context-preparation.md).

## Verified implementation

| Area                  | Evidence                                                                   | Limit                                                                                               |
| --------------------- | -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Claude and Codex      | `src/main/managed-session-manager.ts` implements both backends             | One active backend per managed session                                                              |
| Model selection       | `ManagedAgentPane.tsx` and provider capabilities resolve selectable models | Claude's list uses version-gated definitions; live entitlement validation still matters             |
| Provider switching    | `switchSessionProvider` preserves visible transcript entries               | Starts a fresh backend without sending the retained transcript                                      |
| Conversation recovery | Main owns an in-memory session map                                         | No durable shared transcript or provider resume path in this flow                                   |
| Usage                 | Claude aggregates input/output/cache-read usage on successful results      | Drops model identity, cache creation, cost, and failed-result usage; switching clears current usage |
| Jev                   | No integration found in application code or dependencies                   | Proposal only; no supplied starter package to inspect                                               |
| Desktop release       | Linux/macOS packaging and signed OTA workflows exist                       | Workflow existence does not prove signed public distribution or upgrades                            |

## Checks run

The local runtime is Node `26.8.1` and Bun `1.4.2`. The repository pins Node
`24.17.0` and Bun `1.3.14`. These results assess this checkout on the available
runtime; repeat release acceptance with the pinned toolchain.

| Check                           | Result                                                          |
| ------------------------------- | --------------------------------------------------------------- |
| `bun run build`                 | Passed, including TypeScript and main runtime import validation |
| `bun run check`                 | Passed with 16 warnings and 2 informational findings            |
| `bun run test:node`             | 427 passed, 3 failed across 68 test files                       |
| `bun run test:packaging`        | 30 passed                                                       |
| `bun run check:dependencies`    | Passed                                                          |
| `bun audit --audit-level high`  | Failed; audit reports 28 high-severity advisories               |
| Electron E2E                    | Not run locally; `xvfb-run` is unavailable                      |
| Live provider/TypeSafe requests | Not run                                                         |
| Packaged install, upgrade, soak | Not run in this assessment                                      |

Two database failures use July 24 health events and call a reader that defaults
to today's date. The reader deletes events older than 30 days. Tests must control
their clock instead of depending on the calendar. The Git diff failure expects
`b/` prefixes while this machine sets `diff.mnemonicPrefix=true`; make the test
or command contract independent of global Git configuration.

The audit lists findings in runtime and development dependency paths, including
`fast-uri`, `ip-address`, `js-yaml`, `@xmldom/xmldom`, `brace-expansion`,
`browserslist`, `nanoid`, `sharp`, `tar`, and `undici`. These are audit findings,
not proof that each advisory is exploitable through Aide. They fail the existing
high/critical dependency gate and need remediation plus a fresh audit.

## Remote release evidence

- [CI for the assessed main commit](https://github.com/quanticstudios/aide/actions/runs/30126337697)
  succeeded. That historical result does not override today's audit or local
  calendar-dependent failures.
- [A manual packaging run](https://github.com/quanticstudios/aide/actions/runs/30106623189)
  succeeded for Linux x64 and macOS x64/arm64 at a different commit. This run is
  a manual dispatch, not evidence of the current signed stable release path.
- The GitHub release listing is empty at assessment time.
- The Linux packaged OTA drill workflow has no returned runs at assessment time.
- The health Worker configuration contains `REPLACE_WITH_*` deployment values.
  Remote account configuration and protected signing inputs remain unverified.

## Release work

The exported beads contain 131 closed, 16 open, and 4 in-progress records.
Those counts include parent issues and are not a completion percentage.

1. Restore a reproducible green baseline: resolve dependency advisories and the
   three local failures; rerun pinned-toolchain CI and Electron acceptance.
2. Complete or explicitly defer the recorded private-alpha work: damaged-state
   recovery, Electron/IPC hardening, settings/onboarding, per-turn diffs, editor,
   and detach/reattach/restore behavior. Reconcile stale ticket status against
   actual code before estimating each item.
3. Implement shared conversations, per-message model routing, and restart
   recovery from the feature PRD. Prove history delivery across providers.
4. Implement usage accounting and deterministic preparation. Add Jev only after
   synthetic validation, then run the approved paired task pilot.
5. Complete packaged acceptance and real-provider dogfood. Fix the recorded E2E
   teardown flake and prove state preservation across crashes and restarts.
6. For public OTA distribution, provision the protected release environment,
   owned hostnames, signing inputs, and health service. Run bootstrap, upgrade,
   revocation, and recovery on every supported target. Verify native macOS
   signing/notarization; record rollout evidence before promotion.

Existing follow-up records include `aide-dfe.2` through `aide-dfe.7`,
`aide-czz.2` through `aide-czz.4`, `aide-1se`, `aide-k8d.9`, `aide-k8d.10`,
`aide-x2h.7`, and `aide-yms`. The local `bd` executable is unavailable, so live
issue state, new issue creation, and `bd sync` cannot be verified here. Create
beads for the current audit failures, test determinism, and feature slices once
the CLI is restored. This document is a handoff, not a replacement issue tracker.

## Planning estimate

Assuming one experienced developer, a Linux private-team release, existing
Claude/Codex accounts, and no major architecture surprises:

| Work                                                             | Provisional engineering effort |
| ---------------------------------------------------------------- | ------------------------------ |
| Existing alpha hardening and gate repair                         | 1–2 weeks                      |
| Shared conversation, mentions, and recovery                      | 1–2 weeks                      |
| Accounting, deterministic preparation, and Jev pilot integration | 1–2 weeks                      |

Budget roughly 3–6 engineering weeks for the combined private pilot, with real
dogfood and paired-task evaluation as exit gates. Public Linux/macOS delivery is
roughly 6–10+ weeks total under the same staffing assumption, subject to native
test access and release credentials. These ranges are planning judgments, not
measured delivery forecasts. Ticket decomposition and acceptance runs must
replace them before committing to a release date. No Jev saving is established.

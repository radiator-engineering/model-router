# Model router v2 implementation handoff

Status: Offline phases 1–3 implemented, October 31, 2026. Production v2 application and phases 4–7 are not implemented. These notes retain the checkpoint/comparison contract and record the first milestone below; they do not authorize live inference or rollout.

## Read first

1. [Design brief](design-brief.md): selected architecture and ordered file plan.
2. [Decision contract](decision-contract.md): precedence, eligibility, outcomes, review and migration semantics. Current contract version: 3.
3. [Runtime contracts](runtime-contracts.md): exact catalog migration/projection, candidate/check inputs, review checkpoints and pin purpose.
4. [C4 overview](c4-overview.md): component ownership and a concrete pinned-author/reviewer sequence.
5. [Validation plan](validation.md) and [harness findings](../r-and-d/03-claude-code-mods-harness-validation.md): evidence already collected and remaining gates.

The brief selects architecture; the decision contract owns behavior; runtime contracts own stored data and authority-bearing inputs. Resolve an actual contradiction explicitly. Research rankings and model names do not grant workload approval. The [resolved EGO report](../../ego_review_report.md) records six earlier fixes; these final clarifications have not received a fresh subagent audit.

## Final implementation decisions

| Topic | Initial behavior |
|---|---|
| Review timing | Per-assignment routing can recommend/require review, but launches occur only at explicit candidate checkpoints. Multi-turn work accumulates under the enrolled scope. No timer, edit, classifier flag or turn ending starts a reviewer. |
| Review scope | Review the exact frozen candidate revision and relevant context. A broader change needs an explicit scope update/enrollment; do not infer all dirty files as its scope. |
| Reviewer selection | Every reviewer/targeted verifier is its own review-purpose assignment through the same eligibility contract. Execution pins do not choose its model. Initial public pin commands target execution; trusted coordinator metadata can supply a review-specific assignment pin. |
| Startup and recovery | One serialized coordinator launch path; persist intent before spawn and deduplicate candidate/revision/stage. Uncertain startup after reload remains incomplete. Do not blindly launch a duplicate reviewer. |
| Repair | Keep candidate identity and counters across revisions. Checks alone cannot renew review; targeted independent closure needs explicit authorization and must stay within the recorded findings/invariants. |
| Default engine | Keep `policyEngine=legacy`, existing legacy options/defaults, `routeSubagentEffort=false`, and `reviewMode=recommend`. No implicit live shadow calls or automatic reviewers. |

These rules are incorporated into the decision/runtime contracts and brief; this handoff is not a competing policy implementation.

## Comparison testing

Keep engine selection and legacy routing mode as separate controls inside the existing plugin. Load one plugin copy per Claude Code session.

| Configuration | Executes | Measures |
|---|---|---|
| `legacy` + Basic | Existing tier policy | Legacy execution baseline |
| `legacy` + Custom | Existing preferences and Basic fallback | Existing custom-policy baseline |
| `legacy` + Observe | Basic, with Custom recommendations logged | Basic-vs-Custom decision disagreements |
| `v2-shadow` + selected legacy mode | Unchanged selected legacy behavior | V2-vs-legacy decisions; additional classifier overhead when opted in |
| `v2` | Enforced v2 contract | V2 execution outcomes on qualified paths |

Legacy mode does not choose another execution policy inside v2. Shadow never starts v2 review, checks, resource reservations or acceptance, and it does not establish counterfactual completion quality. Keep the legacy classifier payload unchanged. A separate live v2 classifier call requires opt-in.

Initial comparisons use manual selection and deterministic offline replay. No randomized allocation service, statistical dashboard, new experiment command family or exact historical-version loader is required. Preserve exact releases as separate source/configuration snapshots when needed; retaining the legacy selector does not preserve every past plugin release.

Decision/trial records identify applied and proposed engine, effective legacy mode where relevant, plugin/source revision, contract/policy/catalog fingerprints, assignment/parent/candidate/revision identity, pin purpose/origins, mutation switches, classifier configuration, review settings, and observed harness/proxy versions. Missing provenance remains unknown; do not fabricate revision or environment facts. Record classifier, author, reviewer, repair and targeted-verification consumption separately; remaining provider quota can stay unknown.

For completion comparisons, use a preselected assignment and identical starting repository/context in isolated sessions or worktrees. Record a trial ID and the starting revision in the evaluation record. Hold permissions, budgets, review treatment and check definitions constant when comparing routing. Compare review treatment in a separate experiment. Explicit pins constrain an experiment and must be reported. Engine changes do not reset candidate counters or transfer review evidence; mark mixed-policy candidates and exclude them from single-policy results.

## First coding milestone

Start with phases 1–3 of the brief: normalized classifier contract, deterministic catalog migration/projection, and pure policy/replay. Finish the registered offline checks for each phase before moving to pins, harness application and review coordination in phases 4–7.

Before editing runtime code:

- Inspect `git status`; preserve existing spec/research work. A checkout of HEAD alone may omit uncommitted design artifacts. If creating a branch, use the `codex/` prefix.
- Record the current offline baseline and freeze representative legacy routing/classifier regression fixtures before refactoring. Add no new questions to the legacy classifier request.
- Use the documented Node version and `sfw` for package-manager commands. If `sfw` blocks one, report its reason and ask; do not bypass it. No new runtime package dependency is planned.
- Keep pure selection free of I/O and Node APIs; harness operations stay behind typed adapters. Register new tests with the actual runner in the same phase they appear.

Current baseline commands, from the repository root with Node 23.6+:

```sh
node scripts/smoke.mjs
node scripts/build-catalog.mjs --check
```

At the end of this milestone, those commands must still exercise legacy regressions and the newly registered suites. The planned `node scripts/replay-v2.mjs` must also run without inference and report fixed expected outcomes. The existing [native harness probes](../../experiments/harness-contracts/README.md) remain supporting evidence; the later native v2 suite must exercise the implemented adapter itself.

Use clearly synthetic catalog approvals and policy values only in fixtures. The real v1 migration produces empty approvals/environments and unknown time/path scope. Do not seed production approvals, invent freshness/context facts, or weaken eligibility to make a demo route successfully. V2 automatic selection may correctly return `unavailable` until qualified records exist.

## Regression cases to carry forward

- Execution pins remain stable through the author's tool loop and do not select a reviewer; conflicting fixed fields or unknown origins cannot be silently rewritten.
- Many author turns produce no independent reviewer before an explicit checkpoint; required acceptance remains blocked while waiting.
- Duplicate checkpoint/completion events and uncertain reload do not create duplicate calls or completed review from incomplete evidence.
- Changed covered content/configuration makes checks/review stale. Out-of-scope repair, a new material finding or exhausted allowance blocks acceptance.
- Legacy Basic/Custom/Observe retain their behavior and default controls; shadow changes neither the legacy request nor its workflow side effects.
- Every pure suite actually runs. Record its case count; a passing runner that never imported the new suite is not verification.

## Live validation boundary

Offline coding is not blocked by missing provider calibration. Keep unqualified application paths disabled or in explicitly opted-in shadow evaluation. Native event origins, effective effort, proxy forwarding/fallback, real reviewer restrictions and reliable tool completion still need the recorded live checks before promotion. A passing stubbed probe is not evidence that a provider path enforces a pin or budget.

The next session should report the implemented phases, exact checks/case counts, preserved defaults and remaining evidence gates. It must not call the whole system qualified because offline tests pass.

## Offline milestone result

Implemented on branch `codex/v2-phases-1-3`, preserving the existing uncommitted spec/research files:

1. **Phase 1:** normalized classifier/snapshot/decision contracts and independent TypeSafe/Gateway v2 questions/normalization. Unknown dimensions/confidence stay unknown. No v2 network transport is wired into the plugin.
2. **Phase 2:** deterministic schema-v1 migration, full-document v2 validation/generation and exact legacy projection. The committed catalog has empty approvals/environments and unknown imported timestamps, families and paths. Generation preserves JSON payloads as data, including own `__proto__` keys.
3. **Phase 3:** pure precedence/eligibility/four-outcome selection, purpose-scoped pins as inputs, exact bounded fallback authorization, review disposition and deterministic replay. Registered regressions cover fixed fields, invalid/unknown inputs, primary-vs-alternative authority, capability/context/resources and independent reviewer selection. Durable pins, dispatch, counters and review execution remain later-phase work.

Baseline before runtime refactoring: **82/82** offline tests and catalog generation check passed on Node **23.11.0**. `tests/fixtures/legacy-regression.json` freezes four classifier request shapes, 28 routing outputs, five response-reading examples and 15 Custom recommendations. The four registered frozen-regression tests check those groups; the existing Basic/Custom/Observe hook/control suites remain registered.

Final milestone commands (Node 23.11.0, no live inference):

```sh
node scripts/smoke.mjs                    # 196/196
node scripts/build-catalog.mjs --check    # matches
node scripts/replay-v2.mjs                # 48/48 fixed outcomes
```

Smoke suite counts: policy **42**, catalog **23**, task routing **17**, router controls **15**, frozen legacy regression **4**, v2 classifier **12**, v2 policy/replay **83**. The replay's 45 synthetic and three production-catalog cases are decision tests, not completion-quality trials. Positive approvals are confined to fixtures. Replay records source/plugin/Node facts, file fingerprints, controls/lineage and candidate diagnostics; unobserved harness/proxy facts remain null. Reports are under ignored `test-results/`.

The focused pure-code type check passed with installed TypeScript **7.0.2**:

```sh
tsc --ignoreConfig --noEmit --allowImportingTsExtensions \
  --target es2023 --lib es2023,dom --module esnext \
  --moduleResolution bundler --strict --noUncheckedIndexedAccess \
  hooks/v2/contract.ts hooks/v2/classifier.ts hooks/v2/policy.ts \
  hooks/v2/policy-data.ts hooks/model-catalog.ts
```

This uses standard globals such as `structuredClone`; it does not qualify a harness adapter. The separate `tsc -p . --noEmit` check **fails** with the current generated configuration (import-extension flags, Node/test/JS declarations and strict-index errors); its output is retained locally in `test-results/v2-repository-typecheck.txt`. Plugin structural validation passes with listing warnings for the absent icon/local OS metadata and advice on legacy gating-hook error handlers. No metadata files or settings were removed to silence those warnings.

**Preserved:** plugin identity/version, manifest options/defaults, active legacy Basic/Custom/Observe behavior and classifier payload. New engine/review/subagent-effort controls are not installed in this milestone; the intended `legacy`/`recommend`/`false` defaults still belong to phase 4. There are no automatic v2 shadow calls, reviewers, checks or reservations, and no new runtime dependencies, credential or proxy-setting changes.

**Remaining:** phase 4 controls and identity-bound durable pins; phase 5 native adapter, actual assignment association, deadline/cancellation, request blocking and guarded shadow/application; phase 6 candidate/check/coordinator/acceptance lifecycle; phase 7 released usage documentation. Live origin/effort/forwarding/fallback/tool-completion/reviewer-restriction checks and real workload/context/freshness/resource calibration are still required before enabling any affected path. Offline success grants no production workload approval and proves no counterfactual completion benefit.

## Suggested next-session request

> Read docs/v2/implementation-handoff.md and its linked contracts. Continue with phase 4 of the v2 brief: durable purpose-aware pins and controls with registered offline tests. Preserve the completed phase 1–3 checks, existing work, legacy behavior/defaults and classifier payload. Keep application and automatic review disabled; do not run live inference, invent approvals, change credentials/proxy settings or claim native enforcement before the phase 5–6 and live gates. Report exact counts and remaining limitations.

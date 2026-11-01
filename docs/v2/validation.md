# Model router v2 validation plan

Status: Configured native routing and bounded review functionally verified, November 1, 2026. Empirical workload-quality certification remains separate.

Keep capability/integration checks separate from model-quality experiments. The current checkpoint below records actual script and interactive evidence; historical sections preserve prior offline-only results. This document grants no additional model spending.

The [official design brief](design-brief.md) selects the implementation architecture, controls, artifact acceptance boundary, and delivery sequence. Remaining items here qualify those paths; they do not leave the plugin/component choice open.

## Initial findings (historical, October 31)

The [Mods validation report](../r-and-d/03-claude-code-mods-harness-validation.md) combines official documentation, generated contracts, primary community tests/experiments, and native offline probes. On Claude Code 2.1.316, all 10 [contract probes](../../experiments/harness-contracts/README.md) and both upstream fable-pin tests passed. These results use downstream stubs, without live model calls.

| Area | Established path | Remaining evidence |
|---|---|---|
| Pinning | Router-owned controls and request rewrites; native model-switch events expose source | Actual picker/default/fast-mode/resume behavior and effort origins across surfaces |
| Effort | Main and subagent step rewrites; agent definition/registration effort; Agent invocation effort | Message timing, caps, re-entry, and actual proxy/provider forwarding |
| Blocking | Prompt drop, spawn denial, and synthetic streamed response before dispatch; tested guard error handlers | Live dispatch traces, headless behavior, later Mod composition, and engine/proxy fallback |
| Review | In-process coordinator can register/spawn reviewers and receive completion events | Live tool restrictions, lifecycle races, cancellation, artifact revision tracking, acceptance gates, and cross-family identity |

The earlier blanket claim that subagents have no effort parameter was incorrect. The narrower Mods `agent.spawn` interface lacks a direct effort field; the harness offers other effort paths. Review orchestration can live inside a Mod. Required review still needs a controlled acceptance boundary, since a post-turn annotation cannot retract streamed text.

## Harness and proxy questions

| Question | Evidence to collect | Design consequence |
|---|---|---|
| Can each classifier result be tied to one main or delegated assignment? | Hook declarations and queued-prompt, continuation, fork, and late-response checks on recorded versions | Preserve instead of applying an ambiguous result |
| Can the adapter distinguish native manual model/effort choices from defaults and previous automatic changes? | Effective settings precedence and event origins for launch arguments, native selection, and session controls | Map verified origins to pins; preserve unknown-origin fields |
| Can hooks block dispatch or request clarification? | Minimal demonstrations of both outcomes without accidental model execution | Keep unsupported enforced policies in shadow mode |
| What model and effort changes can each boundary apply? | Main-turn and subagent request traces, including inherited/default effort | Qualify complete configurations; reject unenforceable effort requirements |
| Do tool calls, results, images, streaming, interruptions, and continuation survive translation? | End-to-end traces through each proposed harness/proxy path | Record compatibility by feature and tested environment |
| Can requested and resolved identities and effective effort be observed? | Non-sensitive response metadata or request traces | Preserve unknowns; verify family independence only where evidence supports it |
| Can the orchestrator create a separate reviewer and track artifact revisions and acceptance? | A bounded author–review–repair demonstration with an unavailable-review case | Start with recommendations; enable automatic review only on a supported integration |
| What usage and quota data can be read without consuming or altering records? | Installed-version documentation and a verified non-consuming observation path | Retain static preference until accounting can enforce declared budgets |
| Where do retries or substitutions already occur? | Effective proxy configuration and controlled failures | Ensure retries preserve identity and substitutions follow explicit authorization |

Record exact harness, plugin, proxy, model, and effort configurations. Check official contracts against local behavior. Do not poll consuming usage queues during a read-only audit or expose credentials in evidence.

## Policy values to settle

The decision contract proposes a `0.8` inference-confidence threshold for replay, no substitution by default, and one substitution when explicitly authorized. These are starting choices, not calibrated results.

For evidence-only admission, set evidence-backed availability freshness durations and compatibility version ranges. Router fallback grants remain explicit; context and ordinary transport/provider limits are host-owned. Review triggers recommend by default; explicit user requirements or approved standing policy can require review. Define accounting units and protected reserves before enabling hard resource budgets. The brief defines router-owned pin commands; mapping native controls to them still needs the origin checks above.

## Offline implementation evidence (October 31, 2026)

The pre-refactor baseline was **82/82** tests on Node **23.11.0**, with generated catalog equality passing. The frozen legacy fixture now checks four backend/request combinations, 28 tier/effort/risk results, five response-reading cases and 15 Custom recommendations without changing the legacy classifier payload.

Historical phases 1–3 checkpoint (`8e19c72`):

| Check | Result and scope |
|---|---|
| `node scripts/smoke.mjs` | **196/196** registered cases: legacy policy 42; catalog 23; task routing 17; controls 15; frozen legacy regression 4; v2 classifier 12; v2 policy/replay 83. Each suite reports its count; zero registered cases fail the run. |
| `node scripts/build-catalog.mjs --check` | Passed: full schema-v2 editable/generated equality. Legacy snapshot is unchanged; migration supplies no approvals or environments. |
| `node scripts/replay-v2.mjs` | **48/48** fixed outcomes, including all four outcomes. Of these, 45 use synthetic evidence and three use the production catalog; no inference or task execution occurs. |
| Focused pure-module TypeScript check | Passed with installed TypeScript 7.0.2, explicit ES2023/DOM standard libraries, strict/no-unchecked-index settings and `.ts` imports enabled. This checks pure code, not a native harness adapter. |
| `claude plugin validate` | Passed structural validation; it still reports legacy gating-hook advice and local listing warnings (missing icon and OS metadata files). It is not a live enforcement test. |
| `tsc -p . --noEmit` | **Does not pass** with the current generated configuration: `.ts` import configuration, absent Node/test declarations, implicit JS-module declarations and strict-index errors remain. The smoke runner does not type-check tests. |

The focused type-check invocation and milestone limitations are recorded in the [handoff](implementation-handoff.md#offline-milestone-result). Reports stay under ignored `test-results/`. The catalog review exposed generated `__proto__` handling, padded-effort migration and non-JSON/cyclic payload issues; the fixes have registered regressions. Policy regressions also cover unauthorized primary substitution, scoped fallback permission, fixed/unknown-origin fields, context and reviewer independence, contradictory compatibility records, and invalid configuration.

These results cleared only the first offline coding milestone. At that checkpoint, the plugin manifest and active legacy hooks/defaults were unchanged, and v2 controls/persistence/application and coordinator behavior were not yet implemented or qualified by those runs. Freshness, capacity and approvals for real workloads remain absent. No live classifier, provider, proxy-setting or credential changes were made.

## Phase-4 evidence (October 31, 2026)

The historical phase-4 registered smoke checkpoint was **234/234** on Node 23.11.0: the 196 prior cases, 23 additional control cases and 15 purpose-aware pin cases. Catalog generation equality and **48/48** fixed replay outcomes still pass, with no inference and no production catalog approvals. Runtime modules also pass strict/no-unchecked-index type checking against the installed **2.1.316** authoring API, and structural plugin validation passes with all affected routing/control gates registering `.catch` handlers. The missing icon and ignored/local OS metadata remain listing warnings; the repository-wide generated-config/test type-check limitation is not cleared by this narrower runtime-module check.

Implemented controls persist intent, not model/reviewer execution. Session/next pin state is versioned and conversation-bound; persistent values use governed native settings with user/policy provenance. Tests cover purpose/scopes, duplicate assignment snapshots, unknown origins, reload/clear/resume, stale/concurrent/failed writes, managed constraints, inactive coordinator commands and pre-dispatch/error-handler blocking for unsupported engines. Legacy behavior/defaults and classifier payload regressions remain registered. See the [phase-4 handoff](implementation-handoff.md#phase-4-implementation-result) and [storage/control contract](runtime-contracts.md#phase-4-controls-and-pin-storage).

At that checkpoint the v2 adapter/shadow path and coordinator were still pending; the phases 5–7 checkpoint below supersedes that implementation status. No live control-origin, effective-effort, proxy/fallback, reviewer-tool or model-quality qualification was performed, and `reviewMode=automatic` alone grants no launch authority.

## Implementation contract checks

Use the [runtime contracts](runtime-contracts.md) and the brief's [phase checkpoints](design-brief.md#phase-checkpoints) as implementation inputs. Register each suite when its phase introduces it; a passing runner that omits that suite does not satisfy the checkpoint.

Verify deterministic v1 migration, exact legacy projection, unknown evidence preservation, and generated-document equality. Candidate/check tests must cover trusted origins, ambiguous selection, untracked/deleted paths, traversal and symlink rejection, unavailable check provenance, governed execution, quoting, failed or indeterminate completion, and content changed during checks.

Review tests must establish that checks alone cannot renew review after repair. Exercise authorized independent targeted closure on the exact repaired revision, out-of-scope changes, new material findings, stale context, and exhausted verification allowance. Failure or missing authorization must leave acceptance blocked. These checks now have registered pure, adapter and native coverage; the earlier supporting probes alone did not establish them.

## Checkpoints and comparisons

Verify that multiple author turns and ordinary edits cause no reviewer dispatch before a checkpoint. Cover explicit and authorized automatic checkpoints, failed checks, duplicate commands/completion, edits during review, reload after uncertain spawn, and counters retained across revisions. Test that execution pins do not select reviewers, review-specific pins still satisfy independence, and fixed/unknown-origin fields remain protected.

Use the [comparison rules](implementation-handoff.md#comparison-testing). Capture legacy regression outputs before changing implementation. Shadow must preserve the legacy classifier request and perform no v2 workflow side effects. Separate decision disagreements from completed-work outcomes; record all classifier, author, reviewer, repair, and verification usage. Use isolated execution trials, known starting revisions, and fixed review treatment when comparing routing policies. Do not interpret a mixed-policy candidate as a single-policy result.

## Evaluation sequence

1. **Offline decision replay.** Turn the contract's acceptance examples into fixtures. Exercise all four outcomes, fixed fields, conflicting pins, missing evidence, unknown quota, reviewer independence, and exhausted fallback limits. Compare with the active policy without generating solutions.
2. **Compatibility checks.** Verify the exact configurations and request paths proposed for initial use. A successful text/tool request establishes only that tested path, not broad workload quality.
3. **Small paired execution pilot.** Start with six preselected assignments run under Sonnet medium and Opus medium, with identical starting repositories, requirements, tools, and operating budgets. Expand only when instrumentation is useful. Qualify mechanical-work models separately.
4. **Specialist and reviewer comparisons.** Preselect scarce-provider cases. Review the same correct and defective artifacts with qualified reviewers, including artifacts from both families. Measure false alarms and confirmed defects; keep planted and naturally occurring defects separate.
5. **Shadow evaluation and constrained rollout.** Compare proposed and applied decisions. Promote only when the adapter enforces the required behavior and held-out results support the policy's declared quality/resource trade-off.

The [follow-up research](../r-and-d/02-follow-up-recommendations.txt) proposes a larger pilot ceiling. It remains optional research input. Set experiment scope and resource limits explicitly before running live attempts.

## Measurements and promotion

Measure classification quality, execution quality, and full policy quality separately. Record first-pass and final completion, required clarification, repair effort, confirmed defects, false review alarms, latency, tool calls, retries, cache behavior, observable token use, and scarce-provider consumption. Count truncated and budget-exhausted attempts as visible outcomes. Missing counterfactual runs remain missing.

Control repository revision, starting context, tool permissions, prompt format, and budget. Keep cold-start and resumed-session results separate. Keep related task variants in the same calibration or holdout split. Do not interpret API prices as subscription consumption or import benchmark headline scores as acceptance targets.

Before a constrained rollout, require no observed critical regression, no silent pin or substitution failures, supported enforcement, and an identifiable benefit on intended assignments. Set numerical quality margins and resource targets before a larger held-out evaluation. A small pilot does not establish general reliability.

## Research result format

For each follow-up, record: question; source or experiment; date and exact environment; observed result; limitations; and affected spec sections. Distinguish a documented API capability, a locally observed behavior, and a proposed policy choice. Update the v2 specs when a finding changes the design, while preserving [research provenance](../r-and-d/README.md).

## Phases 5–7 offline checkpoint

October 31, 2026, Node **23.11.0**, installed authoring API/native host **2.1.316**, TypeScript **7.0.2**:

| Check | Result and limits |
|---|---|
| `node scripts/smoke.mjs` | **299/299**, 12 explicitly registered suites; includes 17 assignment/record, 10 artifact, 13 verification and 25 review cases. Earlier legacy, controls, pin and policy suites remain registered. No live calls. |
| `node scripts/test-v2-native.mjs` | **18/18** actual-registration contracts across two native suites, with isolated copied modules, synthetic approvals/facts and external-operation stubs. Covers shadow opt-in/no side effects, dispatch association, pin consumption, blocked requests, scoped registration, uncertain-start recovery, native completion correlation, deadlines, stale evidence, explicit acceptance and indeterminate Bash completion. No inference. |
| Catalog/replay | Generated catalog equality; **48/48** deterministic saved outcomes. Production environments and approvals are still empty. |
| Strict runtime types | All `hooks/*.ts` and `hooks/v2/*.ts` checked against the installed declaration with strict/no-unchecked-index, ES2023/DOM, bundler resolution and `.ts` imports. This is not a repository-wide generated-config/test typecheck. |
| Structural validation | Actual plugin and isolated native fixture validate. Local listing warnings about missing icon and ignored OS metadata are not release qualification. |

Smoke reports include suite counts, fixture/code hashes and version/source provenance. Native validation/test logs stay in ignored `test-results/`; temporary plugin directories are removed. The old 10-probe suite is supporting evidence, not a substitute for the actual registration tests.

**Historical boundary at that checkpoint:** the native default held real v2/reviewer paths and required checks could not pass. No live trial had run. November 1 explicitly delegated ordinary host responsibilities, implemented configured admission and actually bounded native completions, and established terminal check receipts. The current section below supersedes that disabled-path status. Offline implementation alone still grants no empirical workload approval.

## Configured native integration — November 1, 2026

### Revised ownership

The owner rejected router-owned context fitting and explicitly approved delegation of ordinary request token/tool/time caps, provider substitutions and server-tool behavior to Claude Code/proxy/provider. These are no longer blanket gates on chat. Pins/switches, explicit hard restrictions/reservations, router-selected fallback grants and finite review/check/acceptance permissions remain enforced. Review token allowances were **not** relaxed: the default uses native `model.complete`, which actually accepts maxTokens/timeout.

Configured routing reuses existing model preferences and known model-profile compatibility, reporting `qualification=configured`. Evidence-only selection retains scoped timed compatibility/approvals. No workload approvals, environments, freshness observations or context facts were fabricated. Context-null/oversized regressions establish that diagnostic estimates never affect selection or preservation. Rule conditions are canonical in policy-data; configured options remap preferences, not a parallel selector. The 0.8 per-required-dimension threshold remains unchanged.

### Final script checks

Environment: Node **23.11.0**, Claude Code/native authoring API **2.1.316**, TypeScript **7.0.2**, plugin **0.7.3**, policy `v2-configured-2026-11-01.1`. Source changes are local after `7f4a69f`.

| Check | Result and scope |
|---|---|
| `node scripts/smoke.mjs` | **309/309** across 12 explicitly registered suites: policy 42, catalog 23, task-routing 17, controls 42, legacy-regression 4, classifier 12, v2-policy 84, pins 15, harness 18, artifacts 10, verification 17, review 25. No inference. |
| `node scripts/build-catalog.mjs --check` | Passed; editable/generated equality, unchanged legacy snapshot and no new approvals/environments. |
| `node scripts/replay-v2.mjs` | **48/48** fixed outcomes: 45 synthetic evidence cases and three production configured cases (two select, one preserve). Decision replay, not completed-work comparisons. |
| `node scripts/test-v2-native.mjs` | **21/21** native actual-registration tests, two files. External operations stubbed; default-workflow cases exercise production configured policy and completion-backed review, while agent-backed adapter cases remain explicitly synthetic. No inference. |
| Strict runtime TypeScript | Passed for all `hooks/*.ts`/`hooks/v2/*.ts` against the installed API, strict/no-unchecked-index, ES2023/DOM, bundler resolution and `.ts` imports. Root generated-config/test typing limitations remain separate. |
| `claude plugin validate .` | Passed structural validation, including new native model calls. Existing missing-icon and ignored `.DS_Store` listing warnings remain; this is not directory submission approval. |

Final offline report is `test-results/2026-11-01T08-14-49-791Z-offline-69870-offline.json`; native log is `test-results/2026-11-01T08-14-50.205Z-native.log`. Private reports/debug logs remain ignored, not published. Governed-check tests include real local execution of the exact generated wrapper and reject forged/nonterminal/interrupted receipts. Runtime status tests reject unapplied proposals and another conversation's records.

### Live scripted CLI checks

Each probe explicitly loads this checkout, uses existing credentials, runs in `dontAsk` with narrow allowed tools and has a $1 CLI budget plus 90-second process deadline. No saved settings, credentials or proxy configuration are changed. These runs were authorized by the owner and consume real classifier/model allowance.

| Case | Observed result |
|---|---|
| Literal, 08:06:49 UTC | Exact red→blue response; CLI reported Haiku, one turn; passed. |
| Governed Bash tool loop, 08:06:52 UTC | Exact `ROUTER_TOOL_OK`, two turns, one stable reported Opus model; passed. This run preserved Opus, not a claimed Haiku switch. |
| Subagent model, 08:06:59 UTC | One real child, answer `3`, reported Opus + Haiku; passed. |
| Separate subagent effort, 08:07:06 UTC | One child defined at high; debug request evidence shows routed Haiku **medium**, answer `3`; passed. Observed serving effort remains unavailable. |

These four final probes reported about **$0.314** combined CLI model cost, excluding classifier costs; API list-price accounting is not subscription consumption or a savings claim. Reproduce with the four explicitly live commands in the [development guide](../development.md#explicit-live-cli-and-manual-verification).

### Actual interactive Claude Code session

A separate tmux-controlled Claude Code 2.1.316 session loaded this checkout with debug logs, without bypassing permissions:

1. Reproduced the original v2 prompt-drop failure, then confirmed ordinary v2 selected Haiku medium and returned exact `blue` after the fix.
2. Staged an explicit next Haiku model pin, ran one actual Bash `printf ROUTER_PIN_TOOL_OK`, received the exact marker under v2 Haiku medium, then confirmed `Next execution assignment: none`. The changed-model tool loop completed without an unexpected-target hold.
3. Enrolled a healthy one-file candidate; one fresh capped full reviewer returned zero findings, status became ready, and explicit acceptance succeeded.
4. Enrolled a defective one-file candidate requiring exactly `blue` plus newline. Full review reported a confirmed defect; bounded Sonnet repair used governed Write. Actual bytes were inspected as `62 6c 75 65 0a`. The owner explicitly approved **that candidate's** scope attestation. Independent targeted verification closed it, and explicit acceptance succeeded with full/repair/targeted counters each one.

The scope approval was not standing authorization for other candidates. No model self-attestation, automatic commit, publication or additional candidate budget was inferred. These are evidence of their recorded exact revisions; later configuration/source changes require current recapture, not reuse of stale approval. Historical findings remain distinct from current unresolved findings. Captures stay under ignored `test-results/manual-*`.

### What this does and does not establish

Configured v2 is usable on these tested native interactive/headless paths; bounded default review/repair/targeted acceptance works. Legacy defaults and classifier regression fixtures remain preserved. No new dependencies or global configuration changes were needed.

This is **functional integration evidence**, not a held-out routing/classification/reviewer-quality benchmark, universal proxy-feature certification or proof of pre-dispatch provider substitution prevention. Native picker/default/fast-mode/SDK origin mapping, image paths and other providers/surfaces remain unmeasured. Native completion metadata has no actual-serving-model field; it remains null, and configured family checks are not proof of upstream identity. Full cross-process accounting and universal publication guards remain out of scope. The paired quality/resource evaluation above is required before numerical benefit or broad workload-approval claims, not a blocker on ordinary configured routing.

## Clear and simple-answer regression — November 1, 2026

Policy revision **v2-configured-2026-11-01.2** supersedes the earlier `.1` checkpoint above. A native interactive session launched on GPT-6.1 Sol/high reproduced both reported symptoms before the fix:

- `/clear` followed by `Spell Strawberry` held before dispatch. The debug cause was `pin/settings authority unavailable`. The host contract explicitly states that clear changes conversation identity without `session.start`; the router had invalidated its cached controls but only restored them on startup or a control command. Assignment pin reads now restore the current identity through the existing serialized/provenance-checked loader. No old session/next intent is copied to the new conversation.
- After restoring context, the same prompt classified role `simple-answer` at 1.00, bounded span 0.97 and specification 0.68. The irrelevant specification gate caused preservation. The simple-answer rule now requires confident role/span only; the 0.8 threshold, known hard constraints and higher-priority consequential-work rule are unchanged.

New tests were run **before** the fix: the pure spelling test failed (`preserve` versus `select`), and the native clear test forwarded zero requests instead of two. After the fix, **311/311** offline, **22/22** native and **48/48** replay pass, with catalog equality, strict runtime types and plugin validation. The native clear regression changes identity without startup and verifies two subsequent turns and isolation of old session/next pins.

Live retest without restart or an intervening status command: `/clear` → `Spell Strawberry` selected **Haiku medium**, returned `S-T-R-A-W-B-E-R-R-Y`, and no association hold occurred. The next C4 explanation preserved **GPT/high** with an explicit `unchanged (no_matching_rule)` line. Explanations still have no v2 rule; no new explanation policy or lowered confidence threshold was inferred from this fix. A setup failure is now labeled setup-incomplete rather than falsely reported as a missing classification association.

Evidence remains private under `test-results/clear-*`, `test-results/manual-clear-debug.log` and `test-results/manual-clear-fixed.txt`. The owned interactive session exited normally. Saved defaults, credentials, proxy settings and unrelated reports were not changed; the fixes remain local/uncommitted.

## Lightweight communication — November 1, 2026

Policy **v2-configured-2026-11-01.3** broadens v2 `simple-answer` to standalone greetings and thanks, not arbitrary short inputs. The existing `simpleAnswerModel` preference is exposed as **Simple answers & chat model**; no new role/model option or default scope is introduced. Native configured routing prefers a declared low configuration, otherwise medium. Fixed effort and pins remain literal. Legacy question payload/defaults are unchanged; unknown/low-confidence classifications still preserve.

The first live `Yo` probe recognized the role at 0.99 but left span unknown and correctly preserved GPT/high. Execution-span guidance was then clarified: a standalone social reply is bounded even without a coding task; unspecified continuations/approvals remain unknown. No observation was synthesized and the 0.8 threshold was not lowered. A subsequent live `Yo` request starting on GPT/high selected **Haiku/low**, returned a social reply and reported Haiku usage. Separate live probes confirmed `Thanks!` → **Haiku/low**, but `Continue.` → unchanged **GPT/high**. These are development regressions, not held-out quality or savings measurements.

Offline coverage includes classifier instructions, grouped greeting/thanks/continuation/approval fixtures, low-effort preference selection, model-option overrides, absent-low fallback, disabled effort routing, effort pins, unknown/low-confidence preservation and native-menu visibility. Final checks: **314/314** offline, **22/22** native, **48/48** replay, catalog equality, runtime strict types and plugin validation. The repeatable `test-v2-live.mjs --confirm-live --greeting` probe requires actual Haiku usage plus outgoing low-effort evidence; the separate subagent-effort probe now expects low for its simple answer. Private evidence is under `test-results/chat-*` and timestamped live logs.

## Expanded role coverage — November 1, 2026

Policy **v2-configured-2026-11-01.4** extends only the v2 role vocabulary to **17 roles plus unknown**. Legacy remains eight roles with unchanged request payloads/defaults and an exactly unchanged raw legacy catalog snapshot. New roles cover planning, research, writing, summarization, translation, extraction, data analysis, mathematics and operations. Existing explanation, bounded investigation and ordinary review now have explicit Sonnet rules. The [research/boundary record](../r-and-d/04-jev-options-and-role-coverage.md) documents the 255-option API ceiling, limitations of the evidence and primary-deliverable tie-breaks.

Eight v2 model preferences are exposed in the native menu without changing settings scope or granting spending authority. Working defaults use Sonnet/medium for bounded explanation/analysis/review, Terra/medium for prose/research/operations, Luna/low for source-grounded transformations, and Opus/medium for planning/orchestration/extended work. Fable/high is an explicit long-horizon option, not an automatic alternative: its compatibility probe returned 429, usage credits required, so no successful compatibility was fabricated.

Terra/medium and Luna/low passed bounded text plus governed Bash round trips on Claude Code 2.1.316. Their v2 records bind exact configuration, observed time, reported model and harness version, leaving proxy version/serving effort unknown and empirical approvals/environments empty. Negative tests reject future, mismatched-harness, mismatched-request-effort and wrong-reported-model evidence. These records do not promote the legacy profiles.

Final validation:

| Check | Result and limits |
|---|---|
| Offline registered suites | **320/320**; includes role vocabulary/boundaries, every configured mapping, model overrides, fixed fields/pins, resource restrictions, consequential precedence, unavailable Fable and fail-closed live-probe arguments. |
| Native actual-registration contracts | **23/23**; production-catalog scenarios dispatch Sonnet, Terra and Luna through real hooks with external operations stubbed. |
| Saved decision replay | **48/48**; compares policy decisions, not completed-work quality. |
| Live Jev role fixtures | **36/36** expected role labels; **zero unexpected unknowns**, two intentional unknown continuation/approval controls. **33/34** known roles meet the unchanged 0.8 threshold; the screenshot-only description is correctly labeled visual-analysis but remains low-confidence (0.59). |
| Classifier latency | Mean about **112 ms** in this development fixture run, not an SLA or accuracy–option-count curve. |
| Live CLI routing | Explanation → Sonnet/medium; writing → Terra/medium; extraction → Luna/low; actual harmless Bash operations loop → Terra/medium. Existing literal replacement and separate child-effort probes also passed. |
| Catalog/types/plugin/docs | Generated equality, runtime strict TypeScript, structural plugin validation, local Markdown paths/headings and whitespace checks passed. Existing root declaration/listing limitations remain separate. |

The first classification pass used a broader data-analysis label for a formal proof (correct label under that draft, confidence 0.57). Mathematics was then made explicit rather than lowering the confidence threshold. Fixtures are development regressions, not a held-out benchmark; this iteration must not be presented as generalization evidence. Live role probes assert dispatch and simple integration, not completion-quality superiority. Native model-role configuration does not launch an independent review call or authorize operations outside normal host permissions.

Private evidence: `test-results/roles-final-classifier.log`, its timestamped live-v2 report, `roles-final-native.log`, `roles-final-*` validation logs and `roles-live-*.json`. Work is local on `codex/v2-role-coverage`; credentials, proxy configuration, billing and unrelated draft reports were not changed.

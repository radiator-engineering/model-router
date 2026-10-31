# Model router v2 validation plan

Status: Initial Mods contract validation and offline implementation phases 1–3 complete; native v2 adapter, coordinator and live integration checks pending. Date: October 31, 2026.

Validate the v2 design against the installed harness and proxy before implementing application behavior. Keep capability checks separate from model-quality experiments. This plan records the questions to answer; it does not claim the answers or authorize live model spending.

The [official design brief](design-brief.md) selects the implementation architecture, controls, artifact acceptance boundary, and delivery sequence. Remaining items here qualify those paths; they do not leave the plugin/component choice open.

## Initial findings

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

Set evidence-backed availability freshness durations, context margins, compatibility version ranges, transport retry limits, and approved fallback alternatives. Review triggers recommend by default; explicit user requirements or approved standing policy can require review. Define accounting units and protected reserves before enabling hard resource budgets. The brief defines router-owned pin commands; mapping native controls to them still needs the origin checks above.

## Offline implementation evidence (October 31, 2026)

The pre-refactor baseline was **82/82** tests on Node **23.11.0**, with generated catalog equality passing. The frozen legacy fixture now checks four backend/request combinations, 28 tier/effort/risk results, five response-reading cases and 15 Custom recommendations without changing the legacy classifier payload.

Current checkpoints:

| Check | Result and scope |
|---|---|
| `node scripts/smoke.mjs` | **196/196** registered cases: legacy policy 42; catalog 23; task routing 17; controls 15; frozen legacy regression 4; v2 classifier 12; v2 policy/replay 83. Each suite reports its count; zero registered cases fail the run. |
| `node scripts/build-catalog.mjs --check` | Passed: full schema-v2 editable/generated equality. Legacy snapshot is unchanged; migration supplies no approvals or environments. |
| `node scripts/replay-v2.mjs` | **48/48** fixed outcomes, including all four outcomes. Of these, 45 use synthetic evidence and three use the production catalog; no inference or task execution occurs. |
| Focused pure-module TypeScript check | Passed with installed TypeScript 7.0.2, explicit ES2023/DOM standard libraries, strict/no-unchecked-index settings and `.ts` imports enabled. This checks pure code, not a native harness adapter. |
| `claude plugin validate` | Passed structural validation; it still reports legacy gating-hook advice and local listing warnings (missing icon and OS metadata files). It is not a live enforcement test. |
| `tsc -p . --noEmit` | **Does not pass** with the current generated configuration: `.ts` import configuration, absent Node/test declarations, implicit JS-module declarations and strict-index errors remain. The smoke runner does not type-check tests. |

The focused type-check invocation and milestone limitations are recorded in the [handoff](implementation-handoff.md#offline-milestone-result). Reports stay under ignored `test-results/`. The catalog review exposed generated `__proto__` handling, padded-effort migration and non-JSON/cyclic payload issues; the fixes have registered regressions. Policy regressions also cover unauthorized primary substitution, scoped fallback permission, fixed/unknown-origin fields, context and reviewer independence, contradictory compatibility records, and invalid configuration.

These results clear only the first offline coding milestone. The plugin manifest and active legacy hooks/defaults are unchanged. V2 engine selection, native pin persistence/application, governed checks, reviewer lifecycle and candidate acceptance are not implemented or qualified by these runs. Freshness, capacity and approvals for real workloads remain absent. No live classifier, provider, proxy-setting or credential changes were made.

## Implementation contract checks

Use the [runtime contracts](runtime-contracts.md) and the brief's [phase checkpoints](design-brief.md#phase-checkpoints) as implementation inputs. Register each suite when its phase introduces it; a passing runner that omits that suite does not satisfy the checkpoint.

Verify deterministic v1 migration, exact legacy projection, unknown evidence preservation, and generated-document equality. Candidate/check tests must cover trusted origins, ambiguous selection, untracked/deleted paths, traversal and symlink rejection, unavailable check provenance, governed execution, quoting, failed or indeterminate completion, and content changed during checks.

Review tests must establish that checks alone cannot renew review after repair. Exercise authorized independent targeted closure on the exact repaired revision, out-of-scope changes, new material findings, stale context, and exhausted verification allowance. Failure or missing authorization must leave acceptance blocked. These are planned checks; the prior harness probes do not establish them.

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

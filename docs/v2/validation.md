# Model router v2 validation plan

Status: Follow-up research backlog. Date: October 31, 2026.

Validate the v2 design against the installed harness and proxy before implementing application behavior. Keep capability checks separate from model-quality experiments. This plan records the questions to answer; it does not claim the answers or authorize live model spending.

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

Set availability freshness durations, context margins, compatibility version ranges, transport retry limits, and approved fallback alternatives. Decide which review triggers are required. Define accounting units and protected reserves before enabling hard resource budgets. Native pin commands and UI details depend on the origin checks above.

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

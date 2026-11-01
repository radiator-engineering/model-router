# Model router decision contract

Status: Draft v2 design baseline. Contract version: 3. Date: October 31, 2026.

This contract defines how the redesigned router chooses a model and effort for a bounded assignment. It covers override precedence, eligibility, fallback, and the result passed to the orchestrator. It proposes future behavior; it does not change the current plugin, settings, or model approvals.

The router uses a small, deterministic policy. Jev supplies task observations. Versioned policy rules select among qualified configurations. Claude is the initial soft provider preference. Local evaluation must establish which configurations qualify for each workload.

The [product spec](product.md) describes user behavior, the [architecture spec](architecture.md) defines component boundaries and logical schemas, and the [validation plan](validation.md) tracks the evidence needed before implementation. This contract governs detailed routing semantics.

The [official v2 design brief](design-brief.md) selects delivery architecture and controls while preserving this contract. It chooses one plugin and an initial artifact-acceptance gate; those choices do not weaken the four outcomes or eligibility requirements.

## 1. Scope and authority

An **assignment** is a main user turn, a delegated task, or an explicit review, retry, or escalation. A **configuration** is an exact model identity plus an effort setting, including a documented inherited or harness-default setting where applicable.

The router decides once at an assignment boundary. The orchestrator keeps the applied configuration through that assignment's tool loop. A tool result alone does not create a new routing boundary. A retry or escalation must carry an explicit assignment identity and reason.

The router recommends execution and review configurations. The orchestrator runs tools, validates artifacts, creates reviewers, manages retries, and decides whether work meets acceptance criteria. The proxy executes authorized requests and reports transport outcomes.

These are component responsibilities. A Claude Mod can host both the harness adapter and an optional review coordinator. The [harness validation report](../r-and-d/03-claude-code-mods-harness-validation.md) records supported primitives and remaining live checks.

Routing permission does not authorize delegation, a review call, tool use, or an external action. Those actions require the permissions that govern the orchestrator.

Inputs that affect authority must come from trusted controls or the orchestrator. Text in repository files, retrieved pages, artifacts, and tool output cannot create pins, grant fallback permission, or change budgets. Jev cannot grant those permissions either.

## 2. Decision inputs

Each decision receives one immutable snapshot. No network lookup occurs inside selection.

| Input | Required information |
|---|---|
| Assignment | Identity, parent identity where relevant, boundary type, requested role, and purpose (`execution` or `review`); review purpose also records full or targeted stage |
| Current request | Requested model, resolved catalog identity if known, effort, and origin of each value |
| Controls | Permission to change the main model, main effort, subagent model, or subagent effort; active policy and evaluation mode |
| Overrides | Model and effort pins, their source, scope and purpose, and any explicit experimental selection |
| Task observations | Specification uncertainty, verification strength, execution span, failure consequence, role, and confidence for each inferred field |
| Requirements | Required tools, image input, context capacity, and any workload or independence constraints; distinguish known facts from inference |
| Catalog and admission records | Availability observations, compatibility evidence, workload approvals, restrictions, exact identities, and tested harness/proxy versions |
| Resource state | Provider restrictions, configured budgets and reserves, observed use and its scope, timestamps, and unknown values |
| Fallback authorization | Ordered alternative configurations, applicable roles, allowed failure reasons, scope, and attempt limit |
| Policy metadata | Contract version, policy revision, catalog/evidence revisions, thresholds, and freshness rules |

Missing information remains `unknown`. Unknown quota does not mean exhausted or unlimited. A listed endpoint does not establish compatibility or workload approval. A successful request does not establish effective effort forwarding or upstream identity.

The adapter must preserve the origin of model and effort values. A value inherited from a parent is not an explicit assignment pin. If the adapter cannot distinguish a manual choice from an inherited default, it must preserve that value and report `override_origin_unknown` rather than replace it automatically.

## 3. Override precedence

Resolve model and effort separately, then validate the resulting configuration as a pair. A model pin does not implicitly pin effort. Pins remain in effect until their scope ends or an authorized control changes them.

Apply the following order:

| Priority | Rule |
|---|---|
| 1 | Enforce explicit prohibitions, known incompatibilities, required capabilities, provider restrictions, and hard resource limits. No pin or fallback bypasses them. |
| 2 | Respect hook limits and routing switches. A switch that is off prohibits mutation of that field. It does not clear a hard constraint. |
| 3 | Apply an explicit assignment pin, then a session pin, then a persistent manual pin. A more specific pin replaces a less specific pin for the same field. |
| 4 | Use the approved workload rule's permitted configurations. A configured workload preference chooses the primary configuration within that set. |
| 5 | Apply the soft Claude preference, then a stable configuration ID to break remaining ties. |

The harness resolves its own settings precedence before supplying the snapshot. The router records the effective value and source; it does not invent a competing merge of Claude Code settings files. Runtime router controls take effect at the next assignment boundary.

Resolve pins within the assignment purpose. Router-owned pin commands initially target `execution`, including ordinary author/delegated work. They do not pin independent reviewers or targeted verifiers. Review-specific assignment pins must come from trusted coordinator metadata; no separate public reviewer-pin command is introduced initially. Record purpose in persisted pins and diagnostics. This does not authorize changing a fixed or unknown-origin outgoing field: an inherited execution model cannot be mistaken for reviewer pin intent, and an unenforceable reviewer configuration remains unavailable.

Conflicting pins at the same scope produce `clarify`; the router does not choose arbitrarily. An explicit OpenAI pin overrides the soft Claude preference. A failed pin produces `unavailable` unless an applicable fallback authorization explicitly covers that pinned request.

Turning model routing off preserves the model. Effort routing may still operate if its switch is on and the resulting pair qualifies. Turning effort routing off preserves effort; the router must reject an automatic model change that cannot support that effort. It cannot clear or silently normalize a fixed field.

If a pin differs from a fixed outgoing field, return `unavailable` with `routing_fixed`. The adapter must reconcile the pin and control before dispatch. When both fields are fixed and already agree with the pins, preserve the request after checking known hard constraints and mandatory requirements; automatic workload approval is not a condition for leaving an inherited request unchanged.

Manual selections must pass compatibility, capability, availability, and hard resource checks. They do not need automatic workload approval. A manual selection of a compatible configuration without workload evidence must be explicit experimental use and must appear as such in the decision record. Experimental use cannot bypass required review or other acceptance controls.

## 4. Eligibility checks

Evaluate every proposed automatic configuration through the same checks, including legacy tier candidates, risk responses, specialist choices, reviewers, and fallback alternatives. Record every failed check. A preferred model receives no exemption.

| Check | Pass condition | Effect of missing evidence |
|---|---|---|
| Identity and enablement | The entry is enabled, unrestricted for the assignment, and resolves to an exact catalog identity | Reject automatic selection |
| Availability | Successful availability verification meets the policy's freshness rule, and no later applicable failure contradicts it | Reject automatic selection; manual use requires at least advertised availability under the policy's freshness rule |
| Harness and proxy compatibility | Evidence covers the installed versions and required request path | Reject selection, including experimental use |
| Tools and modality | Evidence supports every required tool and input modality | Reject selection |
| Context fit | A conservative input and output estimate fits the verified limit and configured margin | Reject selection when fit cannot be established |
| Effort | Evidence supports the exact requested effort or the documented inherited/default behavior through this request path | Reject the pair; never assume levels are equivalent across models |
| Workload admission | The configuration has approval for the role and operating conditions | Reject automatic selection; explicit experimental use is permitted after the other checks pass |
| Resources | Provider restrictions and locally enforceable hard limits permit the attempt, including any protected reserve | Reject when required accounting cannot establish permission |
| Review independence | A required independent reviewer has the required distinct family and a known identity | Reject that reviewer; never report independence as verified from an alias alone |

Policy must state freshness durations, context margins, and supported version ranges. An absent required limit makes that check unknown. Published specifications can support a capacity record, but local compatibility still needs evidence for the configured request path.

Unknown live provider quota does not block an otherwise eligible configuration under a static provider policy. A hard local budget requires reliable accounting for its declared scope. If reliable accounting is absent, the router cannot claim to enforce that budget or spend against it. Local accounting covers tracked work only.

The selector returns any resource reservation it needs. The orchestrator must acquire that reservation atomically before dispatch. If concurrent use invalidates the snapshot, it requests a new decision; it cannot dispatch using the stale approval.

### Admission states

Use `discovered`, `compatible`, `locally-evaluated`, `approved`, and `restricted-or-retired` as distinct records or states. Approval names the workload, effort, operating budget, and relevant environment. It does not approve every effort or role for that model.

Discovery and evidence refreshes do not promote models automatically. A policy revision grants automatic routing permission. This draft grants no new approvals and does not convert existing text/tool smoke checks into workload qualification.

### Inherited requests

`preserve` means the router makes no change. It does not certify the inherited request as qualified. This distinction lets classifier failures leave a working conversation intact without inventing evidence about its quality.

A known hard failure on the inherited request still produces `unavailable`. Unknown workload quality alone can permit preservation. Unknown required compatibility or capability produces `unavailable` when a trusted requirement makes that check mandatory. With no new requirement or known hard failure, the router may preserve an inherited request and report the unverified checks.

## 5. Classification and selection rules

Jev reports observations with per-field confidence. The policy derives the configuration; the classifier does not name models or prescribe budgets.

| Observation | Values |
|---|---|
| Specification uncertainty | Explicit, inferable, unresolved, unknown |
| Verification strength | Strong executable checks, partial checks, judgment required, unknown |
| Execution span | Bounded, several dependent steps, cross-component or extended, unknown |
| Failure consequence | Reversible local effect, consequential effect, unknown |

Keep required tools, modality, and context fit as eligibility constraints. Keep role as a workload lookup key. Do not sum these observations into a universal difficulty score.

Policy rules must name the observations they use and their confidence thresholds. For the first replay, use `0.8` as a provisional threshold for every inferred field needed to authorize a change, require clarification, or add a review requirement. Missing confidence does not pass. Trusted structured requirements do not need classifier confidence. Calibration may change thresholds through a policy revision. Rules must have an explicit priority; conflicting rules at the same priority make the policy invalid.

Apply these rules in order:

1. Validate the snapshot and resolve authority, fixed fields, and pins.
2. Check hard constraints that already apply to the current or pinned request. Do not wait for classification to enforce a known prohibition.
3. Return `clarify` if a material unresolved requirement prevents a meaningful choice or changes required behavior. Include the missing decision. Merely low classifier confidence does not establish a missing requirement.
4. If all controllable fields are fixed, apply the preservation rule in section 3. If a pin fully determines the configuration, validate it directly. Otherwise find the highest-priority workload rule whose required observations pass their thresholds.
5. If no rule applies, classification times out, output is invalid, or the classification cannot be tied to this assignment, return `preserve` unless an existing hard constraint requires `unavailable`.
6. Resolve one primary configuration using override precedence before eligibility filtering. Validate the complete pair after respecting fixed fields. Do not select one half of an ineligible pair.
7. If the primary passes, return `preserve` when it equals the current request. Otherwise return `select` with the permitted changes. Include the successful checks in either result.
8. If the preferred candidate fails, evaluate only authorized fallback alternatives. If none qualifies, return `unavailable`. Retaining an otherwise eligible current configuration is allowed only when the workload rule lists it as an alternative.

A workload rule must distinguish its permitted primary configurations from authorized failure alternatives. Membership in the primary set does not grant fallback permission. A default preference outside that set or absent from the catalog is a configuration failure, not permission to use an unrelated tier policy.

Consequence sets validation requirements independently of execution difficulty. It cannot bypass eligibility, a fixed field, or a pin. A deterministic test failure normally returns to the author for a bounded repair. Escalation needs a named reason, such as a failed repair or a demonstrated capability gap.

The initial workload hypotheses remain: Haiku for exact, readily checked work; Sonnet for specified execution; Opus at medium effort for orchestration and broader assignments; Astra for qualified specialist work. The policy can apply each hypothesis only after its configuration qualifies for the relevant conditions.

## 6. Decision results

Every result includes the assignment identity, input snapshot fingerprint, versions, effective controls, resolved override sources, reason codes, failed or unknown checks, and review disposition. The same normalized snapshot and policy must yield the same result and candidate order.

| Result | Required content | Orchestrator action |
|---|---|---|
| `select` | Exact requested configuration, allowed field changes, selection rule, checks, and resource reservation requirements | Apply the changes at this boundary after acquiring required resources |
| `preserve` | Unchanged requested configuration, preservation reason, and qualification status | Continue unchanged; do not describe preservation as new approval |
| `clarify` | The material missing decision or conflicting pins, plus a concise question | Resolve the question before dispatching this assignment |
| `unavailable` | The blocked requirement or configuration, rejected alternatives, and a useful remedy | Stop this assignment; do not silently choose another model |

`select` is permission to request a configuration, not proof of what served it. Record the requested identity and effort separately from the upstream resolved identity and effective effort. Unknown upstream values remain unknown.

Primary reason codes include `rule_selected`, `already_selected`, `routing_fixed`, `override_origin_unknown`, `configuration_invalid`, `classification_timeout`, `classification_invalid`, `classification_unmatched`, `classification_uncertain`, `no_matching_rule`, `requirement_unresolved`, `override_conflict`, `model_disabled`, `availability_unknown`, `model_unavailable`, `compatibility_unknown`, `capability_missing`, `context_fit_unknown`, `effort_unsupported`, `workload_unapproved`, `budget_denied`, `accounting_unknown`, `independence_unverified`, and `fallback_exhausted`.

Adapters may add detailed diagnostics without changing these meanings. Logs must distinguish the proposed result, the applied request, and the observed transport result. They must exclude credentials and raw prompt content by default.

If a hook cannot enforce `clarify` or `unavailable`, that adapter cannot enable the corresponding enforced routing policy. A debug warning followed by dispatch is not enforcement. It may evaluate the contract in shadow mode while the existing active policy remains explicit.

For Claude Mods, use each event's own short-circuit result: `{ drop }` before prompt submission, `{ deny }` before agent spawn, or a synthetic `turn.step` response that never calls `next`. Carry the policy outcome separately; a synthetic `end_turn` does not mean the task succeeded. Enforced guards need suitable error handlers. A denial after dispatch cannot reverse the request or its effects.

## 7. Fallback and retry behavior

Fallback is an authorized change of configuration after a specified failure. A transport retry keeps the same requested model and effort. Credential rotation counts as a retry only if the resolved model and permitted account/resource scope remain valid.

Each fallback authorization must contain:

- The original selection or workload rule it covers, including whether it covers explicit pins.
- The exact ordered alternative configurations and allowed failure reasons.
- The assignment scope, expiry or policy revision, and maximum number of substitutions.
- Whether a provider or family change is permitted.
- Any changed review requirements or resource restrictions.

Default substitution permission is **none**. When explicitly enabled, the proposed initial limit is **one substitution per assignment**, shared across retries and escalations of that assignment. A new child identity does not reset the limit. Transport retry policy must separately state a finite retry count and deadline.

Count a substitution when the orchestrator dispatches an alternative, including an alternative chosen before the first request. Checking and rejecting an alternative without dispatch does not consume the limit. Examine alternatives in their authorized order and select the first that passes every check. An exact pin never receives an alternative from a general workload list unless that authorization explicitly covers the pin.

| Failure | Default behavior |
|---|---|
| Classifier timeout, malformed output, or uncertain observations | Preserve the current request, subject to known hard constraints |
| Invalid catalog, policy, or controls | Report a configuration failure; do not dispatch under an invalid redesigned policy |
| Preferred configuration lacks evidence or is restricted | Use an authorized, eligible alternative; otherwise return `unavailable` |
| Transient transport error | Retry the same configuration within the transport retry policy |
| Confirmed quota exhaustion or disabled upstream model | Use an alternative only when authorization covers that failure; otherwise stop |
| Explicit pin fails | Stop unless fallback permission explicitly includes that pin |
| Required independent reviewer cannot run | Mark review incomplete and block acceptance; substitution must still satisfy independence |
| All alternatives fail, or the substitution limit is reached | Return `unavailable` with `fallback_exhausted` |

Transport failures do not trigger an unannounced switch inside a tool loop. The orchestrator records the failed attempt and creates an explicit retry boundary. Any replacement must support continuation with the existing context and tool state. If that compatibility is unknown, stop rather than replaying tools automatically.

No retry or substitution may silently broaden provider permissions, consume a protected reserve, or mark an unfinished review complete. Quality failure is not a transport failure and cannot trigger fallback unless an explicit escalation rule permits it.

Configured engine and proxy fallback must follow the same authorization. Resolve any substitution path that runs beneath the Mod's interception before enabling enforced pins or resource restrictions. Observing a different model later is a diagnostic, not proof that the first substitute request was prevented. Check actual outgoing targets without reclassifying every tool step.

## 8. Review disposition

Attach one review disposition to the execution decision: `not-requested`, `recommended`, or `required`. Include the trigger, reviewer eligibility requirements, and whether a distinct family is mandatory. Only a trusted policy or explicit user requirement can make review required.

A separate reviewer assignment uses the same selection contract. A recommended review does not automatically spend allowance. A required review can follow execution, but the orchestrator cannot accept the artifact while that review remains incomplete.

Routing each assignment does not authorize review each turn. Accumulate work under the explicitly enrolled candidate scope. Start review only on `/router review <candidate-id>` or a trusted, authorized workflow checkpoint for that candidate. A risk classification, elapsed time, an edit, `turn.complete`, or author text saying "done" is not a checkpoint. A required review can wait for the checkpoint, but acceptance stays blocked.

`reviewMode=off` suppresses automatic recommendations, not explicit review requests or mandatory requirements. `recommend` never auto-launches; `automatic` still requires standing authorization, a qualified path, and the explicit workflow checkpoint. Run required checks before launching review. Failed checks return control with evidence; they do not grant a new repair/model call.

Serialize review startup and deduplicate by candidate, frozen revision, and full/targeted stage. Edits during a review make it stale; cancel where possible and discard stale completion for acceptance. Never automatically restart on every edit. A new checkpoint and applicable authorization are required, with the same candidate attempt counters. The [checkpoint interface](runtime-contracts.md#review-checkpoints) defines the input and recovery rules.

Name the acceptance boundary: a controlled artifact completion, guarded external action, or validated buffered response. The initial v2 delivery selects controlled artifact acceptance; buffering and universal publication guards are deferred. `turn.complete` alone cannot withhold an answer that already streamed. Track the reviewer lifecycle and artifact revision independently of the author's final message.

The proposed initial triggers are authorization boundaries, destructive migrations, concurrency or idempotency, consequential architecture assumptions, and material requirement ambiguity that remains after clarification. Strong deterministic checks may remove an optional review trigger only when the workload rule permits it.

Reviewers receive requirements, the artifact or diff, relevant context, and executed test evidence. Initially omit the author's persuasive rationale and self-assessment. Findings identify the requirement or invariant, location, consequence, evidence status, and verification step. Evidence status is `confirmed-defect`, `plausible-risk`, `requirement-ambiguity`, or `preference`. No minimum finding count applies.

The proposed initial bound is one review pass, one repair pass, then targeted verification. Further escalation requires unresolved material evidence and separate authorization. Family diversity alone does not establish correctness.

After repair, deterministic checks alone do not renew required independent review. A bounded independent targeted-verification step may renew review for the exact repaired revision only when the approved workflow explicitly authorized that step, its reviewer meets the required independence and capability checks, and every repair change falls within the originally recorded findings and affected-invariant scope. The verifier receives the original findings, old and new revision manifests, the repair diff, relevant requirements/context, and fresh executed check evidence.

Record a new revision-bound verification result. Mark the repaired candidate ready only if the verifier confirms closure of every material finding, reports no new material issue, and all current required checks pass. Broader changes, changed unrelated context, inconclusive verification, absent authorization, or a new material issue leave acceptance blocked pending a separately authorized review. Never carry the old review's completed status onto the repaired revision.

This targeted closure step is distinct from the single broad review pass and single repair pass. It is still a model assignment with an explicit resource allowance and finite operating limits. If it was not authorized, the bounded workflow ends blocked; it does not silently add another review or waive the requirement.

The [runtime contracts](runtime-contracts.md#candidate-enrollment) define candidate enrollment, revision manifests, trusted-check authority, and explicit selection. Missing or ambiguous enrollment returns `clarify`; invalid scope or unavailable required checks returns `unavailable`. Candidate data cannot supply commands or waive policy.

## 9. Modes and migration

Keep the current Basic, Custom, and Observe behavior unchanged while drafting and replaying this contract. Current Observe still applies Basic routing; it is not a global dry run.

Introduce contract evaluation separately from application. A shadow result records what this contract would decide, alongside the active policy's applied request. Shadow `clarify` and `unavailable` results do not block the active request. Logs must name both policies so that a shadow decision cannot appear enforced.

Use `policyEngine=legacy|v2-shadow|v2` with default `legacy`. The existing Basic/Custom/Observe setting remains effective under legacy, including the applied side of shadow. It does not select a second policy inside enforced v2. Shadow never starts v2 reviewers, checks, reservations, or candidate acceptance; a separate live classifier call still needs evaluation opt-in.

Engine changes apply at the next assignment boundary. They do not reset attempt counters, move an in-flight assignment to another engine, or approve existing candidates. Record mixed-policy candidates and exclude them from single-policy quality comparisons. Initial comparison uses manual configuration and offline replay; randomized allocation and a statistical experiment service are deferred.

Enabling the redesigned policy requires adapter support for all four results and the eligibility inputs its rules need. After enablement, every automatic path must use this contract. There is no implicit escape to Basic routing. Legacy behavior can remain a separately selected rollback policy with its own visible identity.

## 10. Acceptance examples

These examples define future decision tests. They assume fresh evidence and sufficient resources unless a row says otherwise. Model names describe workload hypotheses, not approvals granted by this draft.

| Case | Expected result |
|---|---|
| Exact mechanical edit; required observations pass; Haiku configuration has workload approval | `select` Haiku with the approved effort, or `preserve` if already selected |
| Specified change; Sonnet qualifies; current model is Opus; routing permits change | `select` the approved Sonnet configuration |
| Explicit OpenAI pin; compatible and workload-approved; policy otherwise prefers Claude | Honor the pin |
| Explicit compatible but workload-unapproved configuration, with experimental use requested | Honor experimental selection and record its status |
| Explicit OpenAI pin; confirmed exhaustion; no fallback authorization | `unavailable`; no Claude substitution |
| Sonnet preference fails availability; one authorized Opus alternative passes | `select` Opus; record the rejected preference and fallback authorization |
| Preferred model fails; current model is usable but no rule authorizes retaining it | `unavailable` |
| Model switch off; effort switch on; approved effort rule applies to current model | Keep model; change only effort |
| Model pin differs from outgoing model; model routing switch is off | `unavailable` with `routing_fixed`; no hidden mutation |
| Both switches off; inherited request has no known hard failure or unmet mandatory requirement | `preserve`; record unverified qualification without granting approval |
| Effort switch off at an unsupported level for the proposed model | Reject that pair; use an authorized compatible alternative or return `unavailable` |
| Subagent rule requires medium effort; hook cannot establish or set it | Reject that pair; do not claim medium effort |
| Forked subagent inherits model; hook cannot change it | `preserve` unless a known hard requirement fails; then `unavailable` |
| Classifier times out; current request has no known hard failure | `preserve` with `classification_timeout` and any unverified checks |
| Two queued prompts prevent a reliable classification-to-assignment match | `preserve` with `classification_unmatched` |
| Same-scope pins conflict | `clarify` with `override_conflict` |
| Required behavior depends on an unresolved authorization requirement | `clarify`; a stronger model cannot choose the requirement |
| Task requires images; preferred candidate has unknown image compatibility | Reject that candidate; authorized eligible alternative or `unavailable` |
| Quota unknown; static policy permits provider; all other checks pass | Proceed without claiming known remaining quota |
| Hard local budget requires accounting; accounting is unavailable | `unavailable` with `accounting_unknown` |
| Required cross-family review has only same-family candidates | Reviewer assignment is `unavailable`; execution artifact remains unaccepted |
| Repaired revision passes deterministic checks but lacks renewed independent review | Keep acceptance blocked; the old review does not cover the repair |
| Authorized qualified targeted verifier closes all material findings within repair scope; current required checks pass | Record new revision-bound review evidence and permit the repaired candidate to become ready |
| Repair exceeds recorded scope, changes unrelated context, or reveals a new material issue | Keep acceptance blocked pending a separately authorized review |
| Candidate selection is missing or ambiguous | `clarify`; do not choose an arbitrary latest candidate |
| Required trusted check lacks verified provenance or reliable completion status | `unavailable`; no assumed check pass |
| Proxy returns a different model than requested | Record an unexpected substitution; stop continuation unless an existing authorization covers that exact alternative and all checks pass |
| Repeated evaluation with identical normalized inputs and versions | Identical result, reasons, and candidate order |
| Routing controls change during a tool loop | Keep the applied configuration; use the updated controls at the next assignment boundary |

## 11. Decisions to settle before implementation

This draft proposes pins over soft preferences, no default substitution, a provisional `0.8` confidence threshold, and separate execution and review decisions. The following details still need concrete values or local verification:

- Initial workload rules, approved configurations, and review triggers that are required rather than recommended.
- Availability freshness durations, context margins, and version ranges for compatibility evidence.
- Live behavior of documented model-switch origins, effort control paths, assignment identity, and short-circuit outcomes across supported surfaces.
- Which resource limits can be enforced with available non-consuming telemetry, and which reserves to protect.
- The exact fallback alternatives, eligible failure reasons, and finite transport retry policy.

Resolve these through policy data and adapter checks before enabling application. Offline replay can begin with explicit test values. This contract requires no live model experiment to review its precedence and failure behavior.

## Offline implementation status — October 31, 2026

Phases 1–7 now have implementation and offline checks. This does not enable production v2: legacy remains the default, real environments/approvals remain empty, native origin/context/token-cap/fallback qualification and governed-check terminal success remain unavailable, and no live quality experiment was run. Review mode alone grants no spend; unsupported author/reviewer/repair/verification paths hold. See the [final offline checkpoint and remaining live gates](validation.md#phases-57-offline-checkpoint), [runtime integration](runtime-contracts.md#phases-57-native-integration) and [usage/rollback](../usage/router-controls.md#v2-controls-and-pins) for the implemented boundary.

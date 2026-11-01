# Model router v2 product spec

Status: Draft design baseline. Date: October 31, 2026.

The [v2 design brief](design-brief.md) is the official design entry point. This supporting spec owns user behavior; the brief selects the control interfaces and delivery sequence. The controls and candidate syntax are implemented offline; real model/reviewer application remains qualification-gated. See the implementation-status section below.

V2 routes software and product assignments through a small, inspectable policy. It uses Jev to classify the work, checks model eligibility, and selects a qualified configuration while respecting manual control. It makes model selection, preservation, clarification, and failure visible to the user.

The initial resource policy prefers Claude. OpenAI remains available for explicit selections, qualified specialist assignments, and authorized independent review or escalation. Model preferences are hypotheses to test on local work.

## Problem and goals

The current router combines task preferences with a separate Basic tier policy. Its task labels help distinguish work, but they do not fully express uncertainty, verification strength, execution span, or consequence. V2 puts every automatic selection through one contract.

The product must:

- Choose an adequate, qualified configuration for the assignment while conserving scarce provider capacity.
- Keep model and effort stable through an assignment's tool loop.
- Respect explicit user choices and explain any condition that prevents their use.
- Distinguish missing requirements from work that needs more computation.
- Make independent review useful through verifiable findings and bounded follow-up work.
- Permit shadow evaluation and an explicit rollback without changing existing routing during design work.

## Assignment model

An assignment is a main user turn, delegated task, or explicit review, retry, or escalation. Jev describes its role, specification uncertainty, verification strength, execution span, and failure consequence. Required tools, image support, and context fit are separate eligibility constraints.

A configuration combines an exact model with its effort setting and tested request path. Approval applies to a defined workload and operating conditions. Model discovery alone grants no automatic routing permission.

The initial hypotheses are Haiku for exact, readily checked work; Sonnet for specified execution; Opus at medium effort for orchestration and broader assignments; and Astra for qualified specialist work. V2 does not assume that these preferences prove quality or that named effort levels are equivalent across models.

## User controls

Keep independent controls for main model routing, main effort routing, and subagent model routing. V2 adds a separate subagent-effort permission, initially off. Classification and logging can continue while mutation controls are off. Changes affect the next assignment boundary.

A **pin** fixes model, effort, or both at assignment, session, or persistent scope. Assignment pins take precedence over session pins, which take precedence over persistent pins. More specific pins replace only the fields they name. Removing a pin restores the less specific setting or automatic policy.

The user must be able to inspect the effective pins, their scope, routing permissions, active policy, and last applied decision. For example: “Pinned: Opus, medium effort, this session.” A model mentioned in ordinary task text does not become a pin. Initial router pin commands target execution work; they do not choose independent reviewers or targeted verifiers. Status identifies pin purpose, and review-specific assignment pins require trusted coordinator metadata.

Router-owned controls provide explicit pins. The brief defines proposed `pin`/`unpin` commands with next-assignment, session, and persistent scopes, plus policy-engine and review controls. Native model-switch events expose source and requested/resolved model fields, so supported native choices can also map to pin intent. Effort sliders, startup choices, fast-mode changes, and external control need more precise provenance checks; a model-switch source alone does not prove a persistent pin. The existing procedure remains available: turn routing off for the field and make the native selection.

Pins override soft preferences. Known incompatibility, a mandatory capability requirement, or a hard resource limit can still prevent execution. The router must report that condition rather than silently substitute a model.

## Decision behavior

| Outcome | User-visible behavior |
|---|---|
| `select` | Apply the permitted model or effort changes and explain the rule |
| `preserve` | Continue with the unchanged request and explain why; distinguish unverified preservation from qualification |
| `clarify` | Ask for the material missing decision before executing the assignment |
| `unavailable` | Explain the blocked configuration or requirement and how it can be resolved |

Classifier timeout or low confidence usually preserves the request. A known hard failure still stops it. A missing requirement that changes behavior calls for clarification. Consequence can require stronger validation without automatically forcing a more expensive author model.

Fallback permission defaults to none. An authorized fallback names exact alternatives, applicable failures, scope, and a finite limit. A pinned request needs authorization that explicitly covers the pin. A transport retry keeps the same model and effort.

## Independent review

The router attaches a review disposition: `not-requested`, `recommended`, or `required`. A recommendation does not automatically launch a model call. A trusted policy or explicit user requirement can make review required.

The initial delivery supports review recommendations. The selected v2 architecture adds an optional coordinator module inside the existing plugin: it registers reviewers, starts authorized assignments, collects completion events, and tracks review state. Automatic execution depends on live validation and standing or assignment-specific authorization. If a user requires review and no supported path can complete it, the work must remain visibly unreviewed and unaccepted.

Required review initially gates a router-managed artifact record through an explicit acceptance action. A post-turn message can report status but cannot withhold text that already streamed. Response buffering and universal publication guards are outside the initial scope; this gate does not commit, publish, or stop external actions outside the workflow.

Enroll that record through `/router candidate register <manifest-path>` and select it through `/router review <candidate-id>`. The no-argument review command works only with exactly one current candidate. The [runtime contracts](runtime-contracts.md#candidate-enrollment) define scope, requirements, revision identity, and trusted checks. Candidate data cannot define commands or waive policy.

A broader change can span several author turns under one candidate. Review starts only when the user requests it or an authorized workflow emits an explicit candidate checkpoint. A turn ending, an edit, or a risk flag does not launch review. Required review may wait for that checkpoint while acceptance stays blocked. [Checkpoint and recovery rules](runtime-contracts.md#review-checkpoints) prevent duplicate or stale reviews.

Potential triggers include authorization changes, destructive migrations, concurrency or idempotency, consequential architecture assumptions, and material uncertainty after clarification. Which triggers require review remains a policy decision to validate.

An independent reviewer receives requirements, the artifact or diff, relevant context, and executed test results. Its initial context excludes the author's persuasive rationale and self-assessment. Reviewer selection requires relevant capability; a distinct family is an additional constraint when required.

Findings distinguish confirmed defects, plausible risks, requirement ambiguity, and preferences. Each substantive finding includes a location, consequence, and verification step. No supported findings is a valid result. The initial bound is one review pass, one repair pass, then targeted verification. Further work needs unresolved material evidence and authorization.

Repair invalidates prior review. Deterministic checks alone cannot renew it. An explicitly authorized independent targeted verifier may cover the exact repaired revision only within the original findings and affected invariants, with all material findings closed and current required checks passing. Broader changes, stale context, inconclusive verification, or new material findings leave acceptance blocked pending separately authorized review. [Decision-contract §8](decision-contract.md#8-review-disposition) defines the renewal rule and finite allowance.

## Representative assignments

These examples assume qualified configurations, sufficient resources, and enabled routing.

| Assignment | Expected behavior |
|---|---|
| Exact replacement in named files with a predetermined check | Select the approved Haiku configuration |
| Build a form from exact references and acceptance tests | Select the approved Sonnet configuration |
| Trace a cross-component token-refresh race | Select a qualified investigation configuration; assess review needs separately |
| Change access permissions without specifying who may access what | Clarify the authorization requirement |
| Same form task with an eligible explicit OpenAI pin | Honor the pin |
| Pinned provider has confirmed exhaustion and no allowed substitute | Report `unavailable` |

## Scope and acceptance

V2 includes classifier observations, deterministic policy, shared eligibility checks, explicit pins, decision records, bounded fallback, and review recommendations. Automated reviewer execution is conditional on orchestration support. Learned routing scores, live leaderboard-driven changes, universal review, and live quota optimization are outside the initial scope.

Before application, demonstrate that all four outcomes work, automatic paths share eligibility checks, pins and fixed fields survive routing, and model/effort remain stable through the tool loop. Required review must never become implicit approval when it cannot run. Shadow results must remain distinct from applied requests.

Offline replay validates decision behavior. [Harness research](../r-and-d/03-claude-code-mods-harness-validation.md) identifies supported Mod primitives and records offline native-host probes; it does not establish provider translation or review quality. Paired execution trials evaluate completed work, including repair, latency, and provider consumption. A small pilot can justify a constrained rollout; it cannot establish general reliability. The [validation plan](validation.md) defines the evidence needed before promotion. The [decision contract](decision-contract.md) owns detailed routing semantics.

## Offline implementation status — October 31, 2026

Phases 1–7 now have implementation and offline checks. This does not enable production v2: legacy remains the default, real environments/approvals remain empty, native origin/context/token-cap/fallback qualification and governed-check terminal success remain unavailable, and no live quality experiment was run. Review mode alone grants no spend; unsupported author/reviewer/repair/verification paths hold. See the [final offline checkpoint and remaining live gates](validation.md#phases-57-offline-checkpoint), [runtime integration](runtime-contracts.md#phases-57-native-integration) and [usage/rollback](../usage/router-controls.md#v2-controls-and-pins) for the implemented boundary.

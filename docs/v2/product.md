# Model router v2 product spec

Status: Draft design baseline. Date: October 31, 2026.

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

Keep independent controls for main model routing, main effort routing, and subagent model routing. Classification and logging can continue while mutation controls are off. Changes affect the next assignment boundary.

A **pin** fixes model, effort, or both at assignment, session, or persistent scope. Assignment pins take precedence over session pins, which take precedence over persistent pins. More specific pins replace only the fields they name. Removing a pin restores the less specific setting or automatic policy.

The user must be able to inspect the effective pins, their scope, routing permissions, active policy, and last applied decision. For example: “Pinned: Opus, medium effort, this session.” A model mentioned in ordinary task text does not become a pin.

Native model and effort choices should map to pins when the harness exposes their origin reliably. Until that behavior is verified, the existing procedure remains available: turn routing off for the field and make the native selection. V2-specific command syntax and menu changes remain a follow-up design task.

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

The initial delivery supports review recommendations. Automatic execution depends on a validated orchestrator integration and standing or assignment-specific authorization. If a user requires review and no integration can complete it, the work must remain visibly unreviewed and unaccepted.

Potential triggers include authorization changes, destructive migrations, concurrency or idempotency, consequential architecture assumptions, and material uncertainty after clarification. Which triggers require review remains a policy decision to validate.

An independent reviewer receives requirements, the artifact or diff, relevant context, and executed test results. Its initial context excludes the author's persuasive rationale and self-assessment. Reviewer selection requires relevant capability; a distinct family is an additional constraint when required.

Findings distinguish confirmed defects, plausible risks, requirement ambiguity, and preferences. Each substantive finding includes a location, consequence, and verification step. No supported findings is a valid result. The initial bound is one review pass, one repair pass, then targeted verification. Further work needs unresolved material evidence and authorization.

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

Offline replay validates decision behavior. Paired execution trials evaluate completed work, including repair, latency, and provider consumption. A small pilot can justify a constrained rollout; it cannot establish general reliability. The [validation plan](validation.md) defines the evidence needed before promotion. The [decision contract](decision-contract.md) owns detailed routing semantics.

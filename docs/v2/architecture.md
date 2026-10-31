# Model router v2 architecture spec

Status: Draft design baseline. Date: October 31, 2026.

The architecture separates task observation, deterministic selection, and execution. Jev classifies assignments. The policy engine selects configurations from an immutable snapshot. A harness adapter applies or blocks the decision, and the orchestrator manages tools, review, repair, and acceptance.

The [decision contract](decision-contract.md) governs precedence and failure behavior. The schemas below describe logical interfaces to implement after harness validation. They do not claim that the current plugin or Jev endpoint already uses these shapes.

## Components and ownership

| Component | Responsibility |
|---|---|
| Harness adapter | Read trusted controls and request origins, identify assignments, supply requirements, apply permitted changes, and enforce blocking outcomes |
| Classifier adapter | Send the allowed assignment context to Jev, translate its answers, validate values/confidence, and enforce the classification deadline |
| Policy engine | Resolve pins, select a workload rule, evaluate eligibility and authorized alternatives, and return one decision without I/O |
| Catalog and policy data | Store model identities, availability, compatibility, evidence, workload approvals, preferences, and resource rules as distinct records |
| Orchestrator | Dispatch requests, acquire resource reservations when needed, run tools and checks, create authorized reviewer assignments, and manage acceptance |
| Proxy | Carry out the authorized model request, handle bounded transport retries, and expose observable outcomes without choosing a different model implicitly |
| Decision recorder | Distinguish classifier observations, proposed decisions, applied requests, and observed upstream results |

```mermaid
flowchart TD
    H[Harness assignment boundary] --> S[Trusted request and policy snapshot]
    H --> J[Jev classifier adapter]
    J --> O[Validated task observations]
    S --> P[Deterministic policy engine]
    O --> P
    P --> D{Decision}
    D -->|select or preserve| A[Harness and orchestrator apply request]
    D -->|clarify| Q[Resolve missing decision]
    D -->|unavailable| U[Stop assignment and explain]
    A --> X[Proxy and provider]
    X --> T[Tools and verification]
    T --> R{Authorized review needed}
    R -->|yes| H2[New reviewer assignment through same contract]
    R -->|no| C[Assess acceptance]
    H2 --> C
```

Review execution in this flow requires an orchestration integration. A hook that can only select models cannot supply the whole workflow.

## Classifier interface

The input contains the assignment text and relevant context. Trusted controls, pins, credentials, and budgets stay outside the classifier input. Send only the context needed to classify; configured external classification sends that content to its backend.

```ts
type ClassifierInput = {
  prompt: string
  context?: string
}

type Observation<T> = {
  value: T
  confidence: number | null // Finite 0–1; null means unavailable
}

type TaskRole =
  | 'implementation' | 'investigation' | 'review' | 'orchestration'
  | 'visual-analysis' | 'file-scout' | 'simple-answer' | 'explanation'

type ClassifierOutput = {
  role: Observation<TaskRole>
  specification: Observation<
    'explicit' | 'inferable' | 'unresolved' | 'unknown'
  >
  verification: Observation<'executable' | 'partial' | 'judgment' | 'unknown'>
  executionSpan: Observation<'bounded' | 'dependent-steps' | 'extended' | 'unknown'>
  consequence: Observation<'reversible' | 'consequential' | 'unknown'>
}
```

The adapter maps these fields to Jev questions and normalizes the returned answers. API transport details remain in that adapter. Jev names no models and grants no execution, fallback, or review permission. Policy combines its observations with trusted requirements. Policy must not interpret a missing observation or confidence as a confident low-demand result.

For example, an exact replacement in three files might yield implementation, explicit specification, executable verification, bounded execution, and reversible consequence, with high confidence. The policy can then choose an approved mechanical-work configuration. The classifier does not choose Haiku itself.

## Policy interface

The policy input adds the current request, per-field origins, controls, scoped pins, mandatory requirements, catalog/admission records, resource snapshot, fallback authorization, and versions. [Decision inputs](decision-contract.md#2-decision-inputs) define the complete snapshot.

The following union shows the outcome-specific payload. Every outcome also carries assignment identity, versions, snapshot fingerprint, override sources, reason codes, eligibility diagnostics, and review disposition as specified in the contract.

```ts
type Configuration = {
  model: string // Exact catalog/request identity
  effort: {
    source: 'explicit' | 'inherited' | 'harness-default'
    value: string | null // Unknown never proves an effort requirement
  }
}

type OutcomePayload =
  | { outcome: 'select'; configuration: Configuration;
      changes: { model?: string; effort?: string } }
  | { outcome: 'preserve'; configuration: Configuration;
      qualification: 'verified' | 'unverified' }
  | { outcome: 'clarify'; question: string }
  | { outcome: 'unavailable'; blocker: string; remedy: string }

type ReviewDisposition = {
  disposition: 'not-requested' | 'recommended' | 'required'
  trigger: string | null
  distinctFamily: boolean
}
```

These types are a compact interface outline, not a complete storage schema. A preserve result's `verified` status means the available checks establish eligibility for this assignment; it does not certify the completed artifact. A select result must include any resource reservation requirements in its decision metadata.

The selection sequence is: resolve authority and fixed fields; check known hard constraints; clarify material missing decisions; resolve pins or a workload rule; choose a primary configuration; check eligibility; then evaluate only authorized alternatives if the primary fails. The same normalized snapshot must produce the same result.

## Pin flow

Pins enter through trusted user controls or explicit orchestrator metadata. For example, this user intent fixes both fields for a session:

```json
{
  "scope": "session",
  "model": "claude-opus-5-5",
  "effort": "medium"
}
```

The adapter adds the pin's origin and scope identity. It resolves assignment over session over persistent pins for each field. A task-specific model pin can replace the session model without clearing a session effort pin; the resulting pair must still qualify.

An automatic selection made earlier is not a manual pin. If origin is unknown, preserve the field and explain the limitation. A switch that is off forbids mutation. A pin that conflicts with a fixed outgoing field produces an explicit failure rather than a hidden change. Pin UI and native selection detection need harness validation.

## Execution and review flow

1. Capture controls and request state at an assignment boundary. Tie classifier output to that exact assignment; discard ambiguous or late output.
2. Evaluate the decision. For selection, acquire any required resource reservation before dispatch. For clarification or unavailability, stop that assignment through a supported harness mechanism.
3. Keep the applied model/effort stable across the assignment's tool loop. Record requested values separately from any observable upstream identity and effective effort.
4. Run available deterministic verification. A reproducible failure normally returns to the author for bounded repair.
5. When authorized, create a separate reviewer assignment using the same policy. Supply requirements, artifact/diff, context manifest, and executed test evidence tied to the artifact revision.
6. Verify material findings and perform any bounded repair. Recheck changed artifacts. Acceptance depends on required checks and completed required review.

Each substantive review finding contains its requirement or invariant, artifact location, consequence, evidence status, and smallest useful reproduction or verification step. Distinguish suggested tests from executed results. Record actual reviewer identity where observable; unknown identity cannot establish required family independence.

Review execution state is separate from the routing disposition. The orchestrator tracks whether review is pending, running, completed, or blocked, and invalidates affected evidence when the artifact changes. A completed review can report no supported findings. A recommendation alone never marks review completed.

## Data and failure boundaries

Keep availability, compatibility, evaluation evidence, workload approvals, preferences, and resource policy separate. Discovery updates availability only. Approval names a configuration, workload, environment, and operating conditions. Dynamic credentials and account usage stay outside committed model evidence.

Start with static provider preference. Add locally enforced budgets only where accounting can support their units and scope. Unknown live quota remains unknown. If hard budget enforcement needs a reservation, the orchestrator owns the atomic accounting operation; the policy engine only evaluates the snapshot and requests the reservation.

Classifier failure usually preserves the request, subject to mandatory checks. Invalid policy data blocks the redesigned policy. An unavailable preferred model does not escape to Basic routing. Transport retries retain identity and effort; substitution requires exact authorization and an explicit retry boundary. Continuation must preserve tool state without silently replaying external actions.

## Integration and rollout

The existing code has main-turn and subagent hooks, task preferences, a catalog, and separate mutation controls. It does not yet implement these logical interfaces or the review workflow. The current code also treats subagent effort as outside the spawn hook's control; v2 must not promise effort enforcement without evidence for the installed harness.

First evaluate v2 in shadow mode alongside the active policy. Current Observe mode still applies Basic routing and must retain that meaning. Shadow records never appear as applied changes. Enable application only after the adapter can enforce the outcomes required by its policy. Keep legacy routing as an explicit rollback selection.

The [validation plan](validation.md) covers hook support, pin origins, identity and effort translation, review orchestration, telemetry, and quality comparisons. Those findings can change the integration design while preserving explicit control and observable failure behavior.

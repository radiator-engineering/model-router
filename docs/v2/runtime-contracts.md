# Model router v2 runtime contracts

Status: Proposed v2 implementation contract. Approved document amendments: October 31, 2026. These are data/API contracts, not implementation code or workload approvals.

The [design brief](design-brief.md) owns the delivery plan. This document defines storage, migration, candidate enrollment, and trusted-check inputs. The [decision contract](decision-contract.md) governs eligibility and acceptance semantics.

## Catalog document version 2

The destination document has these required top-level fields:

```text
CatalogV2 {
  schemaVersion: 2,
  legacy: ModelCatalogV1,
  models: ModelIdentity[],
  environments: Environment[],
  availability: AvailabilityObservation[],
  configurations: Configuration[],
  compatibility: CompatibilityObservation[],
  evidence: Evidence[],
  approvals: WorkloadApproval[]
}
```

`ModelCatalogV1` and its profiles retain their current fields and validators. `legacy` is a lossless snapshot for the explicit legacy policy; it is not inferred from v2 records. Edits to v2 observations do not silently rewrite that snapshot. Updating legacy behavior requires an explicit legacy-snapshot edit. No credential, account identifier, or remaining allowance belongs in either document.

### Record fields

All fields below are required unless marked optional. `null` means unknown; it never passes a mandatory eligibility check. Timestamps use UTC ISO 8601, dates use `YYYY-MM-DD`, integers are finite, and references must resolve. Collections have unique IDs and canonical output sorts them by ID. Model IDs remain exact, case-sensitive strings.

| Record | Fields |
|---|---|
| `ModelIdentity` | `id` (exact model ID), `provider` (string), `family` (string or null), `enabled` (boolean) |
| `Environment` | `id`, `harnessVersion`, `proxyVersion`, `requestPath`, `evidenceIds` (nonempty ID list); versions and path are exact strings |
| `AvailabilityObservation` | `id`, `modelId`, `status` (`unknown`, `advertised`, `verified`, `unavailable`), `observedAt` (timestamp or null), `validUntil` (timestamp or null), `evidenceId` |
| `Configuration` | `id`, `modelId`, `effort` (token below), `requestPath` (string or null) |
| `CompatibilityObservation` | `id`, `configurationId`, `environmentId` (ID or null), `status` (`unverified`, `verified`, `incompatible`), `toolCalling`, `imageInput`, `streaming`, `continuation`, `interruptions`, `effectiveEffortVerified` (each boolean or null), `contextWindowTokens` (positive integer or null), `supportedEfforts` (effort-token list), `evidenceIds` |
| `Evidence` | `id`, `source` (`legacy-import`, `manual`, `evaluation`), `checkedDate` (date or null), `observedAt` (timestamp or null), `environmentId` (ID or null), `notes`, `payload` (JSON data preserving the underlying claim) |
| `WorkloadApproval` | `id`, `configurationId`, `environmentId`, `role` (existing `TaskRole`), `policyRuleIds` (nonempty list), `state` (`approved`, `restricted`, `retired`), `evidenceIds` (nonempty list), `checkedAt`, `validUntil`, `limits` (below) |

An effort token is exactly one of `level(value)` for a supported named level, `budget(value)` for a nonnegative integer, `default`, or `unknown`. Stored JSON uses `{ "kind": "level", "value": "medium" }`, `{ "kind": "budget", "value": 4096 }`, `{ "kind": "default" }`, or `{ "kind": "unknown" }`. A default token requires evidence of that request behavior; unknown does not establish support.

Approval limits contain positive integers `maxInputTokens`, `maxGeneratedTokens`, `maxToolCalls`, and `maxWallTimeMs`, plus an integer `outputReserveTokens` and a `contextMarginFraction` in `[0,1)`. Output reserve must be positive and at least the generated-token ceiling. These values and dates are evidence-bearing policy data; the schema supplies no invented capacity or approval defaults.

An availability status records a claim. Automatic eligibility additionally requires a valid observation time, unexpired bound, and no later contradictory applicable observation. Compatibility additionally requires the exact environment/path and all mandatory features. `verified` without that evidence is not sufficient. Policy-rule IDs are cross-validated against the loaded policy revision before selection.

### Stable IDs

Migration derives IDs without randomness, wall-clock time, or heuristic parsing of notes:

- Model identity: the existing model ID.
- Legacy evidence: `legacy/` plus URI-encoded model ID.
- Legacy availability: `availability/legacy/` plus URI-encoded model ID.
- Configuration: `configuration/` plus URI-encoded model ID, `/`, canonical effort token, `/`, URI-encoded request path or the literal `unknown`.
- Legacy compatibility: `compatibility/legacy/` plus the configuration ID encoded as one URI component.

Canonical effort tokens are `level-<URI-encoded-level>`, `budget-<base-10-integer>`, `default`, and `unknown`. New manual/evaluation records use a caller-supplied unique ID; duplicate IDs or dangling references fail validation. The caller must not reuse a legacy namespace for a new observation. IDs are opaque data, never paths to execute or read.

### Schema-v1 migration

`migrateCatalogV1(input)` first validates the old catalog, clones it into `legacy`, and produces the following records. Invalid v1 input fails before any output write.

| Old field | Destination |
|---|---|
| `id`, `provider`, `enabled` | Same values in `ModelIdentity`; `family: null` until identity evidence exists |
| `availability` | Historical availability status; both time bounds null; reference the imported evidence |
| `claudeCodeCompatibility` | Same compatibility claim for each imported configuration; environment null |
| `capabilities.reasoningEfforts` | One level configuration per value, with unknown request path; if empty, one unknown-effort configuration |
| `capabilities.toolCalling` | Same observed value in compatibility; no extra feature support inferred |
| `capabilities.contextWindowTokens` | Same capacity claim in compatibility, still gated by environment evidence |
| Other capability fields and cost fields | Preserved in `legacy` and the imported evidence payload; no strength ranking or admission inferred |
| `evidence.checkedAt` | `checkedDate`; `observedAt` remains null because a date does not supply an observation time |
| `evidence.source`, `evidence.notes` | Preserve original source and notes in the evidence payload/notes; outer source is `legacy-import` |

All other compatibility booleans are null. Imported `supportedEfforts` contains only the old declared effort values. `environments` and `approvals` are empty. Notes mentioning a version do not create a verified environment, and legacy availability never gets an invented expiry. Thus migration cannot automatically qualify an execution configuration.

### Reader and projection APIs

- Keep `ModelCatalog` and `ModelProfile` as the legacy types consumed by `recommendTask`.
- `parseCatalog(input)` accepts v1 or v2 and returns a validated deep-cloned legacy catalog: the v1 input or v2 `legacy` snapshot.
- `validateCatalog(input)` accepts the same versions and returns all diagnostics; for v2 it validates the whole document and its legacy snapshot.
- `parseCatalogV2(input)` accepts only version 2 and returns its validated deep clone.
- `projectLegacyCatalog(v2)` returns a deep clone of `v2.legacy` with no status reconstruction from v2 observations.
- `parseCatalogDocument(input)` validates and preserves the input schema version. The catalog generator uses this API, so it emits the complete v2 data rather than dropping it through the legacy projection.

The existing hook can keep using `parseCatalog` on the generated data for legacy routing. The v2 adapter uses `parseCatalogV2`. The smoke runner must pass `parseCatalog(rawJson)` to legacy `recommendTask`; it must stop passing version-2 raw JSON directly. Replay similarly names the projection it evaluates.

Required fixtures cover a verified model with a date-only check, an advertised/unverified model with no efforts, and an explicit unsupported capability. Assert deterministic migration, unchanged legacy snapshot/projection, empty approvals, unknown environment/timestamps, rejection of dangling or duplicate IDs, and equality between editable and generated documents. A document-to-projection-to-document cycle is not lossless and must not be used as a round-trip assertion.

## Offline selection interfaces (phases 1–3)

The catalog readers/migration above and the pure modules under `hooks/v2/` are implemented offline. Candidate enrollment, trusted checks, pin persistence and harness/coordinator application below remain future interfaces. None of these types grants authority to prompt or repository text.

- `contract.ts` owns normalized observations, literal effort tokens, `PolicySnapshot`, `PolicyDecision` and their validators. Snapshot time is supplied explicitly. Assignment metadata includes parent/lineage, execution/review purpose, full/targeted review stage, an optional trusted requested role and the known author family. A trusted role can replace an inferred role; it does not fill missing inferred dimensions.
- `classifier.ts` builds a **separate** v2 request and normalizes TypeSafe/Gateway answers. Invalid/missing dimensions become `unknown` with null confidence; legacy-tier-only output cannot authorize v2 routing. Gateway confidence comes from the chosen unique maximum of a valid normalized distribution. The existing legacy request is unchanged. Transport, the 800 ms deadline and late-result handling still belong to the later harness adapter, not the pure normalizer.
- `decide(snapshot, policy, catalog)` performs no I/O or clock reads. It validates inputs, resolves per-field purpose-matching pins/fixed fields, chooses one primary before eligibility, and returns all four outcomes with checks and review disposition. Other primary configurations never imply fallback permission. Trusted requirements cover tools, images, streaming, continuation, interruptions, context estimate, missing decisions and required review. `requirements.mandatory` makes unknown required compatibility/capability/effort/context checks block even an inherited request; known hard failures and required reviewer independence block regardless.
- Normalized fallback grants carry a trusted authorization reference, exact original model/effort pair, lineage, policy revision, purpose, allowed roles/failures, ordered alternatives, pin coverage and separate provider/family-change permission. The initial limit is at most one dispatched substitution; rejected checks do not increment it. These grants keep the same standing requirements/resource restrictions. Resolving the authorization reference and persisting dispatched counts are adapter responsibilities; merely supplying matching strings is not authorization.
- Decisions retain effective controls, lineage, fingerprints, override sources, exact requested pairs, candidate diagnostics, approval IDs/finite limits and required reservation intent. A decision does not acquire a reservation, enforce execution limits, observe the serving model, run a check or launch a reviewer. Static unknown quota remains unknown. Hard budgets with unavailable accounting return `unavailable`.

Compatibility checks require scoped, non-future evidence for the exact environment/path. Conflicting applicable compatibility records fail closed because this schema has no supersession field. Availability uses the latest applicable timed observation and explicit expiry; imported unknown times do not qualify. Production `manualLimits` remain unknown rather than fabricated. The rule confidence threshold is the versioned pilot value `0.8`; production rules grant no admission without separate approvals.

`scripts/replay-v2.mjs` runs the saved normalized snapshots against either the explicitly synthetic fixture catalog/policy or the migrated production document. Expectations are fixed in `tests/fixtures/v2-decisions.json`; an empty replay is an error. It reports legacy Basic results only where a saved legacy classification exists and names the legacy projection for provenance. Reports include SHA-256 file hashes and observed source/plugin/Node facts; unavailable harness/proxy facts stay null. The pure 53-bit fingerprints are deterministic identifiers, **not security digests**; later artifact revisions still require SHA-256 as specified below.

## Candidate enrollment

Add the trusted command `/router candidate register <manifest-path>`. Initial command enrollment accepts verified composer-origin user actions only. Internal coordinator enrollment uses the same validator through a typed call and must carry existing assignment authorization; a prompt, tool result, or another plugin cannot mint that authority by invoking a command.

The selected JSON file contains data in this shape:

```json
{
  "schemaVersion": 1,
  "baseRevision": "HEAD",
  "files": ["hooks/task-routing.ts", "tests/task-routing.test.ts"],
  "contextFiles": ["docs/v2/decision-contract.md"],
  "requirements": [{"id": "R1", "text": "Preserve explicit model selections."}],
  "checkIds": ["offline"],
  "requireReview": true
}
```

The registration cannot define commands, change provider permissions, waive required review, or create fallback/budget authority. `requireReview` may only tighten standing requirements. Required check IDs are the union of registration and standing policy. Missing requirements or an ambiguous scope returns `clarify`; invalid data or an unavailable required check returns `unavailable` with a configuration diagnostic. Nothing starts partially.

Resolve `baseRevision` once to a local commit ID. Resolve files/context relative to the repository root; require explicit paths, deduplicate aliases, sort them, and reject traversal or symlinks outside that root. No glob expansion or model-chosen default scope applies. Selected untracked files are included. A base-present file absent from the working tree is a deletion entry; a path absent from both is invalid. Context files must exist. Empty artifact or requirement selections are invalid.

The adapter creates one opaque `cand_<UUID>` ID per accepted enrollment and persists it with the assignment lineage. Revisions and repairs keep that candidate ID and its attempt counters; only a new explicit user enrollment starts a new candidate. The pure selection snapshot treats IDs as supplied data, so deterministic routing does not depend on candidate-ID generation.

`/router review <candidate-id>` names the candidate. For backward-compatible no-argument `/router review`, select only when exactly one current candidate exists in this conversation; otherwise return `clarify` and list the available IDs. Never select an arbitrary latest candidate. `/router accept <candidate-id>` remains explicit and never publishes.

Compute each artifact revision as SHA-256 over canonical JSON containing resolved base commit, sorted artifact/context paths with content hashes or deletion markers, normalized requirements, trusted-check configuration revision, routing policy revision, and reviewer configuration ID. Use UTF-8, fixed object-key order defined by the schema, no insignificant JSON whitespace, and unchanged file bytes. Recompute before accepting. Changed content or configuration makes prior evidence stale, even if no edit hook observed the change.

## Review checkpoints

Normalize an explicit review command or authorized internal workflow event into this typed input:

```ts
type ReviewCheckpoint = {
  candidateId: string
  source: 'user-command' | 'workflow-checkpoint'
  authorizationRef: string
}
```

The adapter verifies the actual command/event origin and resolves the authorization reference. Supplying these strings in a manifest, prompt, or tool result does not establish authority. The authorization must cover the candidate, review stage, tools, and finite model allowance. Automatic workflow checkpoints additionally require automatic mode and standing authorization. A candidate can collect changes over several author turns; elapsed time and a turn's end do not start review.

At a checkpoint, validate enrollment and scope, capture the current artifact/context and configuration snapshot, resolve the qualified reviewer, and freeze the revision before executed checks and reviewer dispatch. If captured content or configuration changes during preparation, checking, or review, mark the evidence stale. Do not silently expand scope or substitute the latest revision for the requested work. Missing scope/requirements produces `clarify`; unavailable authority, required checks, or reviewer path prevents dispatch and blocks required acceptance.

Maintain one serialized coordinator launch path per conversation. Persist a launch intent and its candidate/revision/stage key before calling spawn; duplicate commands and duplicate lifecycle events reuse the existing job/status. Persist attempt counters on the candidate, not the individual turn or revision. After reload, an uncertain launch remains incomplete and is not blindly spawned again. Reconcile through observable host state or explicit recovery; neither an uncertain result nor a late stale callback can become completed review.

The checkpoint does not mint additional repair or targeted-verification allowance. A targeted step requires the existing explicit authorization and the decision-contract renewal conditions. Required check failure does not by itself authorize a new author assignment. Keep an unfinished candidate visibly awaiting a checkpoint or blocked; `ready` retains its existing meaning of all current required checks/review complete.

## Assignment and pin purpose

Add `purpose: 'execution' | 'review'` to normalized assignment and pin records. Review assignments also carry `reviewStage: 'full' | 'targeted'`. This is trusted control metadata, separate from Jev's inferred `TaskRole`. The initial public pin commands create execution-purpose records. Resolve scope precedence only among matching-purpose pins. Full review and targeted verification receive independently qualified configurations; they do not inherit execution-purpose pin intent. A coordinator can supply an explicit review-purpose assignment pin through its trusted typed interface.

Version persisted pin/state records when introducing purpose. Migrate older router-owned pins to execution purpose; preserve unknown native origins as unknown. Session identity, routing permissions, hard constraints, and fixed-field behavior remain unchanged. Show purpose in status so an execution pin never appears to promise a reviewer choice.

## Trusted checks

Add `verificationChecksJson` as a plugin string option with default `{"schemaVersion":1,"checks":[]}`. Accept definitions only from user or managed-policy settings with observable provenance; managed policy takes precedence. Initial enrollment does not trust repository/project/local/flag settings as check-definition authority. If provenance cannot be established for a required check, return `unavailable`.

The value parses as:

```json
{
  "schemaVersion": 1,
  "checks": [
    {"id": "offline", "command": "node scripts/smoke.mjs", "cwd": ".", "timeoutMs": 120000}
  ]
}
```

Require unique IDs, a nonempty literal command string, a repository-relative working directory that resolves inside the root, and an integer timeout from 1 through 600000 milliseconds. Version/hash the normalized configuration. The example is illustrative and is not an automatically installed command.

Invoke the configured literal command through `$.tool.call` for Bash under the normal governed tool path, with `timeout` equal to the configured `timeoutMs`. Prepare the command as a change to the resolved absolute directory followed by the configured literal command. Single-quote the directory and escape each embedded single quote with the standard shell close-quote, escaped-quote, reopen-quote sequence; tests must cover quotes, spaces, dollar signs, backticks, and traversal rejection. Do not append manifest values or model text to the trusted command. Never bypass the permission path with `$.process.run` as a fallback. A denied, interrupted, timed-out, stale, or indeterminate result cannot pass a required check.

Record check ID/configuration hash, candidate/revision, actual command, start/end, host-reported completion status, and available output/exit metadata. Report a pass only from unambiguous successful host completion, never model prose or an assumed exit code. If reliable status is unavailable, the check is unavailable. Empty check lists are allowed only when standing policy requires none; acceptance must then state that no executable checks were required, rather than inventing verification evidence.

Recompute the enrolled artifact/context digest after a check finishes. If the check changed covered content, mark the candidate stale and do not attach a pass to the new revision. Writes outside the enrolled content, such as ignored test logs, do not by themselves change its content digest.

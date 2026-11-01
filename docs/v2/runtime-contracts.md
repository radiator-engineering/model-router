# Model router v2 runtime contracts

Status: Implemented data/API contract, revised November 1, 2026. Configured native integration is available; these contracts do not grant empirical workload approval.

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

Approval limits contain positive integers `maxInputTokens`, `maxGeneratedTokens`, `maxToolCalls`, and `maxWallTimeMs`, plus an integer `outputReserveTokens` and a `contextMarginFraction` in `[0,1)`. The retained schema requires a positive output reserve at least the generated-token ceiling. Context/input reserve/margin values are historical diagnostic metadata, not active router fit checks in either admission profile. Other explicit finite limits remain enforceable where the adapter supports them; no capacity or approval defaults are invented.

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

The catalog readers/migration, pure policy, durable pins, native assignment adapter and candidate/check/review coordinator are implemented. Historical phase-4 descriptions below retain their milestone scope; current native integration is defined at the end. None of these types grants authority to prompt or repository text.

- `contract.ts` owns normalized observations, literal effort tokens, `PolicySnapshot`, `PolicyDecision` and their validators. Snapshot time is supplied explicitly. Assignment metadata includes parent/lineage, execution/review purpose, full/targeted review stage, an optional trusted requested role and the known author family. A trusted role can replace an inferred role; it does not fill missing inferred dimensions.
- `classifier.ts` builds a **separate** v2 request and normalizes TypeSafe/Gateway answers. Invalid/missing dimensions become `unknown` with null confidence; legacy-tier-only output cannot authorize v2 routing. Gateway confidence comes from the chosen unique maximum of a valid normalized distribution. The existing legacy request is unchanged. Transport, the 800 ms deadline and late-result handling still belong to the later harness adapter, not the pure normalizer.
- `decide(snapshot, policy, catalog)` performs no I/O or clock reads. It validates inputs, resolves per-field purpose-matching pins/fixed fields, chooses one primary before eligibility, and returns all four outcomes with checks and review disposition. Other primary configurations never imply fallback permission. Trusted requirements cover tools, images, streaming, continuation, interruptions, missing decisions and required review. Context estimates are diagnostic only. `requirements.mandatory` makes unknown required compatibility/capability/effort checks block even an inherited request; known hard failures and required reviewer independence block regardless.
- Normalized fallback grants carry a trusted authorization reference, exact original model/effort pair, lineage, policy revision, purpose, allowed roles/failures, ordered alternatives, pin coverage and separate provider/family-change permission. The initial limit is at most one dispatched substitution; rejected checks do not increment it. These grants keep the same standing requirements/resource restrictions. Resolving the authorization reference and persisting dispatched counts are adapter responsibilities; merely supplying matching strings is not authorization.
- Decisions retain effective controls, lineage, fingerprints, override sources, exact requested pairs, candidate diagnostics, approval IDs/finite limits and required reservation intent. A decision does not acquire a reservation, enforce execution limits, observe the serving model, run a check or launch a reviewer. Static unknown quota remains unknown. Hard budgets with unavailable accounting return `unavailable`.

Compatibility checks require scoped, non-future evidence for the exact environment/path. Conflicting applicable compatibility records fail closed because this schema has no supersession field. Availability uses the latest applicable timed observation and explicit expiry; imported unknown times do not qualify. Production `manualLimits` remain unknown rather than fabricated. The rule confidence threshold is the versioned pilot value `0.8`; evidence-only rules require separate approvals, while the native configured profile explicitly reports configured qualification.

`scripts/replay-v2.mjs` runs the saved normalized snapshots against either the explicitly synthetic fixture catalog/policy or the migrated production document. Expectations are fixed in `tests/fixtures/v2-decisions.json`; an empty replay is an error. It reports legacy Basic results only where a saved legacy classification exists and names the legacy projection for provenance. Reports include SHA-256 file hashes and observed source/plugin/Node facts; unavailable harness/proxy facts stay null. The pure 53-bit fingerprints are deterministic identifiers, **not security digests**; later artifact revisions still require SHA-256 as specified below.

## Phase-4 controls and pin storage

**Historical phase-4 checkpoint.** The pin/authority rules still apply. Statements below about unimplemented phase-5/6 application/commands describe that earlier milestone and are superseded by [phases 5–7 integration](#phases-57-native-integration).

Phase 4 implements intent/storage, not v2 application. The manifest declares `policyEngine=legacy`, `routeSubagentEffort=false`, `reviewMode=recommend`, empty persistent pins and the empty versioned check configuration. `/router engine`, `review-mode` and `subagent-effort` manage staged session controls; native `/config` manages saved defaults. `save`/`reset` retain their legacy-default scope and do not silently clear pins.

Public `pin model <exact-id>` / `pin effort <level>` and `unpin model|effort` take `--scope next|session|persistent` (default session). Commands require engine-attested composer origin. Public pins always target execution; they cannot supply reviewer purpose, experimental-use permission, budget or fallback authority. Status explicitly labels pins as **staged, not applied by legacy**, shows scopes/sources/fixed fields and reports only the last router-requested legacy configuration, never an invented serving identity.

`hooks/v2/pins.ts` defines `PinState` version 2: `{schemaVersion, conversationId, pins, assignments}`. Conversation records live under `model-router.pins.v2/<URI-encoded-conversation-id>` in the plugin store, containing only pin metadata and frozen assignment bindings. A v1 record at the analogous v1 key can be read/migrated; only its known `router-command` source becomes execution intent. Unknown native origins retain unknown purpose/origin and remain diagnostics, not authoritative pins. Invalid or identity-mismatched records are unavailable and are not silently replaced. The public self-contained type contract mirrors this structure because the Mods loader forbids imports in contract files.

Session/next changes are serialized within the plugin instance, written before acknowledgement and checked against conversation identity/generation before and after asynchronous storage. `session.end` invalidates in-memory context; lazy identity reads also handle clear/resume/branch paths without relying on a new `session.start`. Reload/resume restores only the matching conversation's record; new identities do not copy it. This is not a cross-process atomic budget or coordinator lock.

Persistent pin values have one user-facing authority: their declared native configuration fields. Persistent commands use governed `$.config.set`, respect managed/locked settings, then re-read user/policy sources and verify the exact effective value before acknowledging it. They do not create a competing store default that can outlive a native unpin. A written-but-unverified update is reported as such, not rolled back or silently normalized. Native user/managed values reconstruct execution-purpose provenance; no credentials or account data are copied into pin state.

The pure `bindAssignmentPins` API captures purpose-matching assignment/session/persistent intent once. Only a trusted, eligible user execution association consumes `next`; controls, notifications, delegated work and reviewers cannot consume it. Duplicate active assignment IDs reuse their frozen snapshot, so later pin/control edits cannot change a tool loop. Unknown-origin diagnostics remain separate from policy pins. Up to 64 active bindings are retained, with no live-binding eviction; explicit release and stale-association rejection belong to the phase-5 adapter. **Legacy turns do not consume or apply staged next pins.**

Check-definition authority is read through `$.settings.read({source:'user'})` and `({source:'policy'})`, with managed precedence. Merged project/local/flag options are not evidence of authority. Schema/command/ID/timeout/relative-directory validation happens as data only; root/symlink resolution, command execution and completion evidence remain phase 6. Missing provenance is unavailable, never an empty successful required check.

Non-legacy engine selection from the command/config surface is rejected until phase 5. A startup configuration requesting v2/shadow is held before prompt/model/spawn dispatch, including fail-closed error handlers; it never silently runs Basic as an enforced-v2 fallback. Candidate registration, review and acceptance syntax is recognized and origin-checked but returns `unavailable` without reading files, starting checks/reviewers or accepting anything. The native v2 assignment adapter and coordinator are still not implemented.

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

## Phases 5–7 native integration

`hooks/v2/harness.ts` and `records.ts` own assignment routing/records; `review-harness.ts` connects candidate commands to artifact/check/coordinator modules; `native-review.ts` supplies the default bounded worker. `registerWithAdapters` and its `onRuntimeReady` callback remain code-only seams for trusted embeddings and isolated tests, never JSON/prompt authority.

Main turns bind canonical IDs to unique pending inputs. Delegated starts bind provisional tool-use IDs to acknowledged agent IDs and then canonical child turns. Pin-binding identity stays immutable during relocation and releases on completion. Ambiguous/duplicate associations hold enforced v2 rather than guessing. Classify once, with an 800 ms default deadline; generation, conversation and activation checks reject cancelled/late/reloaded work. No tool result is reclassified.

Native incoming model/effort values are inherited requests, not inferred manual pins. Routing permissions and explicit pins decide which fields may change. Configured policy uses known catalog profiles and native named effort declarations; evidence-only policy additionally requires timed scoped compatibility/approvals. New v2-only models may use observed exact-pair native compatibility records with matching harness version and successful reported model identity. These do not modify the raw legacy snapshot, invent a proxy version or create workload approvals. Future/mismatched/unsuccessful observations cannot qualify a pair. The in-memory catalog enrichment creates request configurations and known family declarations, not workload approvals or measured forwarding facts. Configured automatic failures may preserve a working inherited request; explicit hard failures and mandatory requirements still block.

A tool-loop step may carry either the original host-built pair or the frozen router-applied pair; both resolve to the same frozen choice. An unrelated changed target or observed serving mismatch blocks continuation. Subagent model changes occur at spawn; separately captured effort permission resolves at canonical child index zero. Untouched unknown effort is omitted from rewrites and remains host-managed, never silently normalized.

Pre-dispatch persistence, pin compare-and-set and any required atomic reservation precede forwarding. A failed reservation does not consume next intent. Failed dispatch persistence cancels retry; restored uncertain assignments never redispatch. `applied` metadata is set only at forwarding, not when a proposal is prepared. Full budget accounting is not inferred from subscription/API prices or consuming queues.

### Host ownership

Context fitting/compaction, ordinary author-request token/tool/time caps, provider substitutions and server-tool behavior are owned by Claude Code/proxy/provider. Native routing does not demand proof of those host responsibilities before chat. Diagnostic context fields remain readable but never reject selection/preservation. This boundary does **not** waive explicit pins/switches, hard restrictions/reservations, router-chosen fallback grants/lineage limits, finite review authorization or current acceptance evidence. A post-dispatch mismatch is diagnostic/continuation control, not proof of pre-dispatch prevention.

### Records, storage and recovery

Allow-listed decision records are bounded to 128. They include source/catalog/policy/snapshot fingerprints, controls/purpose, proposed versus forwarded versus observed identity and normalized usage. Raw prompt/headers/credentials are excluded. Serving effort and quota remain unknown. Workflow usage is recorded separately for review, repair and targeted verification. Candidate metadata contains requirements/hashes, not author narrative. Engine changes bind different configuration digests and mark mixed-policy work.

Runtime storage uses `model-router.runtime.v1/<conversation>` plus an activation slot; workflow uses `model-router.workflow.v1/<conversation>`. Restored in-flight assignments cancel and unknown calls remain uncertain, never blindly respawned. Current review mode wins over stored automatic mode. One active owner serializes coordinator writes; persistence failure poisons further operations. Conversation/generation invalidation discards stale callbacks and aborts active default workers. Typed agent recovery requires unique host-observed identity/terminal evidence, not a hook-fabricated agent ID.

### Default native review and authority

Candidates retain explicit scope and counters, with at most 64 retained candidates and no live eviction. Re-registering a manifest path retains its original scope/ID/counters. No-argument review requires exactly one candidate. Each full/repair/targeted stage permits at most one finite authorized call. Ordinary turn completion never launches review or accepts an artifact.

`reviewPolicyJson` has strict schema version 1, reviewer/repair exact model plus named effort, positive integer `maxTokens` (<=64000), positive integer `timeoutMs` (<=600000), booleans `requireReview`/`distinctFamily`, unique required check IDs and unique exact candidate/stage automatic grants. User/managed-policy provenance is required; flag/project/local values grant no spending authority. The code-owned default is Opus medium review, Sonnet medium repair, 8192 tokens, 120000 ms, no standing required review/family/checks and no automatic grants. Explicit composer checkpoints authorize one stage; automatic additionally requires mode and an exact candidate/stage grant. The checkpoint tool grants none of its own permissions.

The default worker makes one fresh history-free, tool-less `$.model.complete` with the authorized maxTokens, timeout and abort signal. It reads only enrolled artifact/context paths, verifies SHA-256 and fatal UTF-8 decoding, and supplies frozen requirements/files/findings, original snapshot metadata and current revision-bound check receipts. No author conversation or persuasive rationale is inherited. The API has no actual-serving-model field: `observedModel` remains null. Logical `completion:<intentId>` IDs are not claimed as native agent IDs. Configured family checks do not prove upstream identity.

Strict structured findings are required. Errors, refusals/empty responses, malformed JSON, truncation, timeout or stale results never become zero findings. Zero valid findings is permitted. Repair returns data-only patches; all paths/finding IDs and frozen inputs validate before any governed Write. No arbitrary commands, deletion, context-file editing, commits or publication are authorized. Host denial/error/cancellation blocks success; partial writes are not rolled back or accepted.

Targeted semantic scope requires trusted assessment. In the default path, a verified composer `verify <id> --confirm-scope` attests the exact original/repaired revision pair after the user inspects it. The model cannot self-attest. Independent targeted review must still establish all original material finding closures, no new material issues and scope on the current revision. Required family checks use the sealed author family for full review and the completed repair worker family for targeted verification. Historical findings remain recorded; current unresolved findings and reviewed/verified revisions are shown separately.

Typed agent-backed `WorkflowAdapters` remain supported with their own qualified numeric allowances, registered restrictions and actual lifecycle correlation. Native completion support does not relax their finite allowance guards or claim unsupported agent output-token enforcement.

### Governed check completion and acceptance

Check definitions require observable user/managed-policy provenance. All selected definitions validate before executing. Governed Bash runs a quoted child shell with the trusted literal command; an outer wrapper captures its status and prints a fresh nonce-bound terminal receipt. A matching exit-zero receipt is accepted only for uninterrupted, non-error foreground completion. Arbitrary `exitCode`, PASS prose, missing/wrong/nonterminal receipt, interruption, denial, timeout or background execution cannot pass. Every required check must succeed against unchanged covered content/configuration. No checks configured means explicit absence, not invented success.

Acceptance always recaptures current scope/configuration and requires current checks, required review and independent closure after repair. Neither artifact data, switches nor plain prose waive these controls. It never commits or publishes. [Usage](../usage/router-controls.md#candidates-review-and-explicit-acceptance) documents exact commands; [validation](validation.md#configured-native-integration--november-1-2026) separates functional tests from empirical workload certification.

# Model catalog

Edit `models.json` to maintain model evidence independently of Jev's classification prompt. The document now uses **schema version 2**, with an exact `legacy` snapshot of the original profiles. `hooks/model-catalog.ts` validates both schemas. Current Custom routing still reads only the legacy projection and keeps its existing checks and preferences; see [task routing](../docs/usage/task-routing.md).

The seed contains six model IDs advertised by the local VibeProxy endpoint on October 30, 2026: three Claude models and three OpenAI models. This is a selected starting set, not an exhaustive inventory. Discovery is a dated observation, not a live availability guarantee.

## Legacy snapshot fields

| Field | Meaning |
|---|---|
| `enabled` | User allows this entry to be considered; it does not establish eligibility. |
| `availability` | Unknown, advertised by the proxy, or verified through a successful request. |
| `claudeCodeCompatibility` | Separately records whether the model works with Claude Code's tools and request format. |
| `qualityByUseCase` | Per-use-case ratings from 1 (lowest) to 5 (highest); null means unmeasured. |
| `maxComplexity` | Low, medium, high, or unknown. |
| `contextWindowTokens` | Known context capacity, or null. |
| `toolCalling` | Verified support, verified lack of support, or unknown. |
| `reasoningEfforts` | Explicitly supported values; an empty list means none have been established. |
| `allowanceWeight` | Relative subscription consumption estimate. Null means unknown; zero must be an intentional estimate. |
| `inputUsdPerMillion`, `outputUsdPerMillion` | Actual API prices when relevant. Subscription access does not imply a zero API price. |
| `evidence` | Source, date, and notes explaining ratings and observations. |

Quality ratings, context limits and costs remain unknown. Opus 5.5, Sonnet 5.5, Haiku 5.5 and GPT-6 Astra passed a basic Claude Code/VibeProxy text-and-tool smoke test at medium effort on October 30, 2026. Their evidence notes record that narrow verification. Visual-input quality and broader task performance remain untested. No model rankings are inferred from model names.

## V2 records and ownership

The [runtime contract](../docs/v2/runtime-contracts.md#catalog-document-version-2) defines the exact records:

- `models`: exact identity, provider, family and enablement; never a strength ranking.
- `environments`: exact harness/proxy versions and request path, supported by evidence.
- `availability`: dated observations with explicit expiry, separate from compatibility.
- `configurations` and `compatibility`: exact model/effort/path pairs and observed feature support.
- `evidence`: original claims and their provenance. Imported payloads preserve the original profile.
- `approvals`: explicit workload/rule/environment admission with freshness and finite operating limits. Discovery never creates an approval.
- `legacy`: the lossless v1 snapshot. Editing v2 observations does not rewrite it; changing legacy behavior requires an explicit snapshot edit.

Collections are sorted by ID using code-unit order. IDs are unique within each collection; references must resolve. Credentials, account identifiers and remaining allowances do not belong here. New observations use caller-supplied IDs outside the reserved legacy-import namespaces.

`migrateCatalogV1()` validates before returning output. It imports declared efforts literally, including values the v1 validator accepted with padding. It creates no environments or approvals, leaves request paths and observation/expiry times unknown, and does not turn notes or date-only checks into environment evidence. The committed catalog is that migration, not a new workload qualification.

`parseCatalog()` reads either schema and returns an isolated v1 projection. `parseCatalogV2()` reads only v2; `parseCatalogDocument()` preserves the full input schema for generation. `projectLegacyCatalog()` returns the explicit legacy snapshot, never reconstructed statuses. `reconcileAvailability()` remains a legacy helper: it updates the returned projection, never v2 records or approvals.

The offline v2 selector checks every proposed pair. The production catalog currently cannot qualify automatic selection, so matching automatic routes correctly return `unavailable`; only eligible preservation paths return `preserve`. V2 selection is not yet wired into the plugin. Unknown capability or quota does not become proof of support or remaining capacity.

## Generate and validate

From the repository root with Node 23.6+:

```sh
node scripts/build-catalog.mjs
node scripts/build-catalog.mjs --check
node scripts/smoke.mjs
node scripts/replay-v2.mjs
```

Generation migrates a v1 source if needed and emits the complete v2 document into `model-data.ts`. The generated module uses `JSON.parse` on an escaped literal, preserving JSON keys such as `__proto__` as data rather than JavaScript object-literal behavior. Commit both catalog files after an intentional edit. `--check` is read-only and rejects unmigrated or stale output.

The registered suites cover migration, projection, validation, generated equality and legacy behavior. Replay uses saved snapshots and clearly synthetic approvals for positive routing cases. Reports and case counts go to ignored `test-results/`; these commands make no inference calls. Offline success does not qualify a provider path or establish completion quality; the [validation plan](../docs/v2/validation.md) retains those gates.

# Task routing

With the default `policyEngine=legacy`, the plugin asks Jev for a task role and an implementation category alongside the original tier, effort and risk questions. All questions use one API request per classified prompt or subagent assignment. This does not classify every tool call or infer a new phase from tool results. Forked subagents keep their inherited model.

## Default task preferences

| Assignment | Preferred model |
|---|---|
| Orchestration | Opus 5.5 at medium effort |
| Visual analysis | GPT-6 Astra |
| Design-led implementation, including architecture/system design and original UX/UI | Opus 5.5 |
| Specified implementation with clear contracts and references | Sonnet 5.5 |
| Mechanical edits with an exact prescribed change and predetermined checks | Haiku 5.5 |
| File scouting that returns paths/snippets without system interpretation | Haiku 5.5 |
| Simple answers: spelling, small literal counts, straightforward stable facts | Haiku 5.5 |

Investigation, review and explanation retain the original routing policy until preferences are defined. Astra is the visual-analysis preference; frontend code implementation by Astra is not assumed verified. Preferences are user choices, not benchmark rankings or a cost optimizer.

## Modes

Set options under `pluginConfigs.jev-model-router.options` in user settings. Preserve your existing API key and other options when editing.

```json
{
  "taskRoutingMode": "observe",
  "taskMinConfidence": 0.8
}
```

- `basic`: original questions and routing.
- `observe` (default): additional questions and debug recommendation logs; the original policy controls model/effort changes. Adding questions may affect the classifier's answers, so observation is not a guarantee of identical legacy predictions.
- `custom`: apply eligible user preferences. Low-confidence preferred routes and unverified preferred models retain the current model and effort. Unsupported roles use legacy routing. Consequential actions retain the legacy risk escalation.

The original `routeMainModel`, `routeMainEffort` and `routeSubagentModel` options supply initial permissions. `/router` can change them immediately for this session; see [router controls](router-controls.md). `classifyTurns` defaults to true for independent per-turn classification/logging even when both main permissions are off. Main-model routing remains off by default. Main orchestration can set medium effort when permitted. The legacy router cannot set effort through its `agent.spawn` path and skips subagent steps, so it does not apply the orchestration preference there. This is narrower than the harness's available effort controls; see the [v2 validation report](../r-and-d/03-claude-code-mods-harness-validation.md).

Model options: `orchestrationModel`, `visualAnalysisModel`, `designLedModel`, `specifiedModel`, `mechanicalModel`, `fileScoutModel`, `simpleAnswerModel`. Each names an exact catalog ID. Editing this checkout does not update a separately installed plugin or configure a shell launcher automatically.

## Catalog gates

Before a preferred model can be applied, its catalog entry must be enabled, availability must be `verified`, Claude Code compatibility must be `verified`, and tool calling must be true. Orchestration also requires `medium` in its supported reasoning efforts. These checks apply in the hook as well as the standalone recommendation tests.

The catalog records basic inference/tool compatibility checks for Opus 5.5, Sonnet 5.5, Haiku 5.5 and GPT-6 Astra. See the [catalog guide](../../catalog/README.md) for the tested environment and limits. These checks do not establish visual-input quality or broader task quality. Unknown quality and cost ratings remain unknown; the selector does not claim optimal quality or cost.

Edit `catalog/models.json`, then run:

```sh
node scripts/build-catalog.mjs
node scripts/build-catalog.mjs --check
```

The generated `catalog/model-data.ts` is required because Claude's hook loader accepts code modules, not JSON imports. A test checks that it matches the editable catalog. Commit both files together.

## Examples and evaluations

`hooks/task-routing.ts` holds short classification examples and boundary guidance. They describe roles/categories, not model rankings. `tests/fixtures/smoke.json` holds separate evaluation prompts. Avoid copying those prompts into the classifier examples.

```sh
node scripts/smoke.mjs
node scripts/smoke.mjs --live --tasks
command claude plugin validate "$MODEL_ROUTER_DIR"
```

Live task mode uses 13 fixed prompts and saves reports separately from legacy live runs. Reports contain per-dimension confidence, expected/actual task classification, and proposed user-preference routing. A low-confidence wrong label remains a failed evaluation even when the confidence gate correctly blocks a model change.

Run these commands from the repository root and set `MODEL_ROUTER_DIR` as described in the [development guide](../development.md). Loading this checkout is separate from updating any installed copy.

## V2 engine boundary

`policyEngine=v2-shadow` preserves the legacy path above; `v2` uses the separate pure selector. V2 questions observe role, specification completeness, verification strength, execution span and consequence. They name no models and grant no permissions. Missing evidence stays unknown; outcomes are select, preserve, clarify or unavailable. A preserved inherited request is not certified as workload-qualified.

V2 eligibility binds exact model, literal effort, environment/path, capabilities, context, fresh scoped approvals, resource limits and reviewer independence. No other primary is an implicit fallback; substitution needs an exact scoped authorization and shares a one-substitution limit across the lineage. Native origins/caps/context remain unqualified on the shipped adapter, and production environments/approvals remain empty. See [controls and rollback](router-controls.md#v2-controls-and-pins) and [validation](../v2/validation.md#phases-57-offline-checkpoint). The legacy preference table is not v2 admission evidence.

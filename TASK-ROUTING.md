# Task routing, version 0.6

The local plugin now asks Jev for a task role and an implementation category alongside the original tier, effort and risk questions. All questions use one API request per classified prompt or subagent assignment. This does not classify every tool call or infer a new phase from tool results. Forked subagents keep their inherited model.

## User preferences

| Assignment | Preferred model |
|---|---|
| Orchestration | Opus 5.5 at medium effort |
| Visual analysis | GPT-6 Astra |
| Design-led implementation, including architecture/system design and original UX/UI | Opus 5.5 |
| Specified implementation with clear contracts and references | Sonnet 5.5 |
| Mechanical edits with an exact prescribed change and predetermined checks | Haiku 5.5 |
| File scouting that returns paths/snippets without system interpretation | Haiku 5.5 |

Investigation, review and explanation retain the original routing policy until preferences are defined. Astra is the visual-analysis preference; frontend code implementation by Astra is not assumed verified. Preferences are user choices, not benchmark rankings or a cost optimizer.

## Modes

Set options under `pluginConfigs.jev-model-router.options` in user settings. Preserve your existing API key and other options when editing.

```json
{
  "taskRoutingMode": "observe",
  "taskMinConfidence": 0.8
}
```

- `off`: original questions and routing.
- `observe` (default): additional questions and recommendation logs; the original policy controls model/effort changes. Adding questions may affect the classifier's answers, so observation is not a guarantee of identical legacy predictions.
- `apply`: apply eligible user preferences. Low-confidence preferred routes and unverified preferred models retain the current model and effort. Unsupported roles use legacy routing. Consequential actions retain the legacy risk escalation.

The original `routeMainModel`, `routeMainEffort` and `routeSubagentModel` options supply initial permissions. `/router` can change them immediately for this session; see `ROUTER-CONTROLS.md`. `classifyTurns` defaults to true for independent per-turn classification/logging even when both main permissions are off. Main-model routing remains off by default. Main orchestration can set medium effort when permitted; `agent.spawn` has no effort control, so it does not apply the orchestration preference there. It logs that limitation instead.

Model options: `orchestrationModel`, `visualAnalysisModel`, `designLedModel`, `specifiedModel`, `mechanicalModel`, `fileScoutModel`. Each names an exact catalog ID. This setup does not change the installed plugin, shell function, or user settings automatically.

## Catalog gates

Before a preferred model can be applied, its catalog entry must be enabled, availability must be `verified`, Claude Code compatibility must be `verified`, and tool calling must be true. Orchestration also requires `medium` in its supported reasoning efforts. These checks apply in the hook as well as the standalone recommendation tests.

Four preferred entries now have basic inference/tool compatibility verification: Opus 5.5, Sonnet 5.5, Haiku 5.5 and GPT-6 Astra. The active shell launcher loads this repo through VibeProxy with task routing in apply mode for subagents; the main session remains Opus/medium. A real delegated file-scout check selected Haiku and returned the expected fixture paths. These checks do not establish visual-input quality or broader task quality. Unknown quality and cost ratings are still unknown; the selector does not claim optimal quality or cost.

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
command claude plugin validate "$HOME/Documents/repos/jev-model-router"
```

Live task mode uses 13 fixed prompts and saves reports separately from legacy live runs. Reports contain per-dimension confidence, expected/actual task classification, and proposed user-preference routing. A low-confidence wrong label remains a failed evaluation even when the confidence gate correctly blocks a model change.

Run the local copy using the command in `LOCAL-DEVELOPMENT.md`. The active installed copy remains unchanged until you deliberately switch it.

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

V2 native routing uses **configured admission**: known enabled/available model profiles, tool compatibility, literal inherited effort and declared native effort levels, explicit restrictions and review independence. It reuses the preference options above but matches versioned dimension rules in `hooks/v2/policy-data.ts`, not Basic tier fallback. The threshold remains 0.8 for each dimension used by a rule. Simple answers require confident `simple-answer` role and bounded span, not implementation-specification or reversible-consequence confidence. A confident consequential-work rule has higher priority. Standalone greetings and thanks also use `simple-answer`, reusing the **Simple answers & chat model** option (`simpleAnswerModel`, default Haiku). Native configured routing prefers low effort for this rule, falling back to medium when a low configuration is absent; disabled effort routing and effort pins retain their exact value. A bare continuation or approval is not small talk: without the underlying work it remains unknown and preserves the request, never an unknown-to-fast fallback. Legacy classifier questions and behavior are unchanged. V2 now explicitly routes explanation, writing, research, planning, source transformations, analysis, mathematics, operations and ordinary review instead of preserving those uncovered roles. Unchanged transcript lines include the reason, such as `no_matching_rule` or `classification_uncertain`.

Low confidence or an unavailable automatic preference normally preserves the inherited working request, without silently selecting another model. Explicit pins, known hard failures and mandatory requirements can still block. Router-chosen alternatives need exact scoped authorization and share a one-substitution lineage limit. Context fitting and ordinary execution/provider behavior belong to the host. Unknown untouched effort stays host-managed.

`qualification=configured` creates no workload approval or environment observation. Separate evidence-only replay/embedding still checks timed, scoped approvals and exact environment compatibility. Live native checks establish functional integration, not general workload quality or observed serving effort. See [controls and rollback](router-controls.md#v2-controls-and-pins) and [validation](../v2/validation.md#configured-native-integration--november-1-2026).

## V2 role coverage

V2 has **17 roles plus unknown**. The legacy vocabulary stays at eight roles; its question payload/defaults are unchanged. The [research and boundary table](../r-and-d/04-jev-options-and-role-coverage.md) records inclusion/exclusion rules and why this count is not near Jev's API limit.

| Role(s) | Default | Option |
|---|---|---|
| `simple-answer` | Haiku/low when configured | `simpleAnswerModel` |
| `file-scout`, exact mechanical `implementation` | Haiku/medium | Existing scout/mechanical options |
| Other `implementation` | Sonnet/medium | `specifiedModel` |
| `explanation` | Sonnet/medium | `explanationModel` |
| `investigation`, `data-analysis`, `mathematics`, ordinary `review` | Sonnet/medium | `analysisModel` |
| `writing` | Terra/medium | `writingModel` |
| `research` | Terra/medium | `researchModel` |
| `summarization`, `translation`, `extraction` | Luna/low | `structuredTextModel` |
| `operations` | Terra/medium | `operationsModel` |
| `planning` | Opus/medium | `planningModel` |
| `orchestration` | Opus/medium | `orchestrationModel` |
| `visual-analysis` | Astra/medium | `visualAnalysisModel` |
| Extended nontrivial work | Opus/medium; Fable/high opt-in | `longHorizonModel` |

Choose the primary deliverable: architecture decisions are planning even in a document; editing code is implementation, running an existing workflow is operations, collecting external evidence is research, condensing supplied sources is summarization, and extracting an existing field is not quantitative analysis. Mathematical derivations/proofs are separate from dataset/statistical analysis. These boundaries can still be ambiguous; unknown and low-confidence preservation remain valid.

The high-priority consequential-work rule and explicit hard requirements remain in force. No role grants delegation, independent-review spending or tool permissions. Native compatibility is basic text/tool evidence, not task quality. Model substitutions, pin conflicts, fixed effort and unavailable models retain their existing rules. The Fable probe currently requires usage credits: selecting its long-horizon preference cannot manufacture availability; default Opus is a deliberate starting choice, not a dispatched fallback.

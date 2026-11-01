# Router controls

Run `/router` to open Claude Code’s native configuration screen, filtered to the router’s settings. There is no question dialog or free-text answer.

Use Down to focus a setting. Space or Enter toggles a boolean in place; Mode opens the native enum selector. Escape closes the screen. Each successful native-config change is saved immediately to plugin settings, so Escape retains changes. Assignment-bound v2 controls affect new assignments; they do not rewrite active assignment snapshots. Setting descriptions are supplied through `config.describe`.

The menu filter uses session state that survives plugin hot reloads. Running `/config` normally shows all settings.

`/router status` prints effective settings. Existing direct commands remain available: `main-model on|off`, `main-effort on|off`, `subagents on|off`, `classify-turns on|off`, and `mode basic|custom|observe`. Direct commands change this session; `/router save` stores their defaults, and `/router reset` restores plugin options.

Implementation follows the native `userConfig`, `config.describe`, and `config.set` APIs documented at https://code.claude.com/docs/en/plugins/mods/reference.md . Opening config is deferred until the router command releases the turn, as the engine forbids nested command dispatch.

## Modes and logs

**Basic** uses the original fast/balanced/deep tier policy. **Custom** uses configured task preferences (defaulting to Opus for orchestration/design, Astra for visual analysis, Sonnet for specified work, and Haiku for mechanical work/file scouting), with Basic fallback where no preference exists. **Observe** keeps Basic routing active and logs what Custom would recommend, without applying Custom recommendations. Observe can still change models through Basic routing when the corresponding switches are enabled. Every mode respects the model and effort switches.

Customize `hooks/task-routing.ts` for role/category rules, default model preferences, confidence checks, and classifier examples. Customize `catalog/models.json` for available models and verified capabilities, then run `node scripts/build-catalog.mjs` to regenerate the runtime catalog. Existing plugin model preference options override defaults in code. Old `off`/`apply` values remain accepted as aliases for Basic/Custom.

Classification and task recommendation lines describe suggestions. The main result line and status show the effective model and effort, explicitly distinguishing unchanged requests from applied changes. With both main switches off, recommendations cannot change the main request.

## Simple answers versus explanations

Custom mode sends high-confidence `simple-answer` tasks to Haiku: spelling, small literal counts, direct supplied lookups, and straightforward stable facts. Substantive `explanation` tasks (teaching, causal reasoning, comparisons, tradeoffs, summaries) continue through the Basic tier/effort complexity policy. Short prompts alone are not evidence of simplicity; investigation and consequential advice are excluded. Catalog verification, confidence and risk checks still apply.

Edit `simpleAnswerModel` in plugin options to override Haiku. Edit `hooks/task-routing.ts` to change the boundary guidance and examples. Main model routing must be enabled for the main conversation to switch. A simple-answer model preference preserves current effort unless another policy explicitly changes it.

## Manual model selection through VibeProxy

To refresh native `/model` entries from VibeProxy, run the following command from the repository root before launching Claude Code. A launcher can run it on startup if configured to do so; see the [development guide](../development.md).

```sh
python3 scripts/sync-model-picker.py --quiet
```

The script preserves native Claude entries and user-added custom entries. Generated entries are marked “Via VibeProxy”. Image-only endpoints and `codex-auto-review` are excluded; catalog advertisement does not prove that every historical model is currently usable. The compatibility profile controls Claude Code client behavior; requests still use the real model ID.

For manual control, turn **Main model routing** off in `/router`, then select a model in `/model`. Turn **Main effort routing** off too if you want manual effort control. Enter saves the model as the default; `s` selects it for this session only. Explicit `claude --model … --effort …` arguments can set launch values. Check any custom launcher for arguments that override saved defaults.

Refresh immediately by running the sync script, then restart Claude Code. If the proxy is unavailable, refresh reports an error and retains the existing menu. The script creates an initial `settings.before-vibeproxy-picker.json` backup in the configured Claude Code settings directory, which defaults to `~/.claude`.

## Decision output

Normal transcript output shows one effective model/effort line per main turn, for example `[router] simple-answer · claude-haiku-5-5 · effort medium · custom`. Unchanged requests include `unchanged`; Basic fallback is identified when it applies. Subagent result lines report their model without claiming an effort setting. Raw classifications, Custom comparisons (including Observe), startup details, and classification errors go to the Claude Code debug log. Enable `claude --debug` to inspect those details. Routing describes the outgoing request, not proof of the model that ultimately served it upstream.

Result lines include the classified request type. Implementation includes its category, such as `implementation/design-led`. Basic mode and missing classifications show `unclassified`; the log does not invent a task type.

## V2 controls and pins

Defaults remain `policyEngine=legacy`, `routeSubagentEffort=false`, `reviewMode=recommend`, no persistent pins, and an empty check-definition list. Basic/Custom/Observe are **legacy modes**, not alternatives to the engine selector.

```text
/router engine v2-shadow
/router engine legacy
/router review-mode off|recommend|automatic
/router subagent-effort on|off
/router pin model <exact-id> [--scope next|session|persistent]
/router pin effort <low|medium|high|xhigh|max> [--scope next|session|persistent]
/router unpin model|effort [--scope next|session|persistent]
```

Run mutation commands yourself in the composer. Model/plugin/notification text cannot mint control or enrollment authority. Direct engine/review/effort commands are session controls; native `/config` manages their saved defaults. `/router save` and `reset` still manage **legacy** defaults only, and do not erase pins.

Model and effort resolve separately: assignment > session > persistent, within the same execution/review purpose. Public pins are execution-only. Next intent binds only to the eligible user execution assignment; control messages, delegated work and reviewers cannot consume it. Pins are committed before qualified dispatch and cannot overwrite concurrently replaced intent. Session/next intent is conversation-bound; clear/branch never copies it into a new identity, while same-identity reload/resume retains it. Persistent changes go through governed native settings and require observable user/managed-policy provenance. Unknown native origins stay fixed/unverified; a routing switch never overrides them.

Shadow performs no v2 pin consumption, reservation, check, review or acceptance. Legacy classification remains unchanged. An **additional** dimension-classifier call requires `v2ShadowClassifier=true` in observable user or managed-policy settings; project/local/flag or malformed/ambiguous settings do not authorize it. This extra call can send the prompt to the configured classifier and consume allowance. It is off by default.

Selecting `v2` is not production admission. The default native facts collector reports unknown origin/context/path/cap enforcement and holds before classifier/model dispatch. Only separately qualified, code-owned adapters and exact catalog approvals can establish those facts; there is no JSON test-mode switch.

## Candidates, review and explicit acceptance

```text
/router candidate register path/to/candidate.json
/router review [candidate-id]
/router accept <candidate-id>
```

A candidate manifest is **data**, never a source of command/model/spending authority:

```json
{
  "schemaVersion": 1,
  "baseRevision": "HEAD",
  "files": ["src/example.ts"],
  "contextFiles": ["docs/requirements.md"],
  "requirements": [{"id": "R1", "text": "Preserve the documented input/output invariant."}],
  "checkIds": [],
  "requireReview": true
}
```

Use explicit repository-relative files, not globs/traversal. Selected untracked files and base-tracked deletions are supported; dangling/out-of-root links are rejected. Base commit resolves once. Requirements, artifact/context bytes, check configuration, reviewer configuration and policy/catalog identity bind the SHA-256 revision. Standing requirements are unioned, never waived by the manifest. Re-registering the same manifest path retains the original scope, candidate ID and attempt counters; use a different explicit manifest for a genuinely new candidate. Ordinary artifact edits require new evidence, not new counters.

No-argument review selects only a single unambiguous enrolled candidate; otherwise it lists IDs and asks for a choice. `off` suppresses recommendations, not explicit or mandatory review. `recommend` does not auto-launch. `automatic` still requires a trusted, scoped workflow checkpoint and separate finite model/tool/time authorization; changing the mode grants no spending permission. The code-owned coordinator supports one full review, one authorized repair and one independent targeted closure per candidate. These later checkpoints are trusted coordinator operations, not ordinary author turn completion or model prose. The standalone default adapter supplies no qualified reviewer/repair allowance; these launch paths remain unavailable on the current build.

Checks come only from `verificationChecksJson` in observable user/managed-policy settings, managed policy taking precedence. Its shape is `{"schemaVersion":1,"checks":[{"id":"test","command":"literal command","cwd":".","timeoutMs":120000}]}`. IDs do not define commands. Commands run via governed Bash, with bounded timeout and canonical shell-quoted cwd. On this build, foreground output saying PASS, absent errors or an invented `exitCode` do **not** prove success. Required executable checks block acceptance until a reliable completion contract is qualified.

Reviewers use fresh nonfork definitions, explicit model/effort, read-only enrolled scope, finite turns/tool/time allowances and separate review-purpose eligibility. Unknown identity, missing authorization, stale content/configuration, incomplete checks or unsupported repair scope keep acceptance blocked. Uncertain starts are observed/reconciled, never blindly respawned. Repeating review can reconcile an observable uncertain job without buying a second pass. Checks alone never renew review after repair.

Acceptance recaptures and checks current evidence. An artifact with neither required checks nor required review may be explicitly accepted as unreviewed; that is not a quality certification. No acceptance command commits or publishes anything. Review completion, ordinary “done” prose, and raw model claims cannot accept a candidate.

## Rollback

Run `/router engine legacy` for future assignments, disable `v2ShadowClassifier` in native config if enabled, and retain the existing Basic/Custom/Observe settings. This does not undo a request already dispatched, erase candidate counters or retroactively cancel an authorized job. Use scoped `unpin` commands to remove intent; restoring legacy leaves it staged. Engine changes mark mixed-policy candidate evidence and must not be interpreted as single-policy comparisons. Real v2 promotion remains blocked until the [live gates](../v2/validation.md#phases-57-offline-checkpoint) pass.

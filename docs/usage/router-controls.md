# Router controls

## First-time configuration

1. Select a working model in `/model`. Claude Code uses it when the router preserves the request. If you use VibeProxy, connect the provider and refresh the model picker first. See [VibeProxy setup](../../README.md#use-with-vibeproxy).
2. Open `/config` and find **Backend** (`provider`). Leave it on `auto` to use TypeSafe when a TypeSafe key is present, Vercel AI Gateway when only a gateway key is present, or the built-in classifier when neither key is present. Set `typesafeApiKey` or `gatewayApiKey` in user settings if you use an external backend. The built-in classifier supplies legacy tier decisions. Task classification for Custom and v2 requires Jev.
3. Open `/router` and choose **Provider preset** for the models that will do the work. Choose **Mixed** for the usual role preferences, or match the preset and `/model` to the single provider you can access.
4. Enable the routing switches you want. Start with the defaults below. Turn on **Main model routing** to let the router choose the main model. To try v2, configure Jev and follow [V2 controls and pins](#v2-controls-and-pins).
5. Run `/router status` to confirm the effective preset, engine, and switches. After a task, check the last router-applied request for the model and effort the router forwarded.

| Setting | Plugin option | Default | Effect |
|---|---|---|---|
| Enable model router | `enabled` | On | Runs the router across all engines. |
| Provider preset | `providerPreset` | `mixed` | Uses mixed preferences or selects Claude or GPT for routed work. |
| Routing policy engine | `policyEngine` | `legacy` | Chooses legacy, v2 shadow, or v2. |
| Task routing mode | `taskRoutingMode` | `observe` | Chooses Basic, Custom, or Observe for legacy routing. |
| Main model routing | `routeMainModel` | Off | Allows changes to the main model. |
| Main effort routing | `routeMainEffort` | On | Allows changes to main reasoning effort. |
| Subagent routing | `routeSubagentModel` | On | Allows model changes when a subagent starts. |
| Allow v2 subagent effort routing | `routeSubagentEffort` | Off | Allows effort changes on the first qualified v2 subagent request. |
| Per-turn logging | `classifyTurns` | On | Lets legacy classify for recommendations even with both main routing switches off. |
| Log decisions | `logDecisions` | On | Shows routing decisions. Set it in `/config`. |

## Save or try a setting

`/router` opens Claude Code’s configuration screen filtered to router controls. Use the arrow keys to select a row. Press Space or Enter to toggle a switch or open its choices. The menu saves each successful change immediately, and Escape closes the menu. Use `/config` for the full settings list, including classifier keys and legacy tiers. Reload Claude Code after changing the classifier backend, keys, logging, tiers, or individual model preferences.

You can also edit Claude Code’s user settings, usually `~/.claude/settings.json`. Add options under `pluginConfigs.jev-model-router.options`. Merge the example into your existing settings and keep any credentials in your user settings file.

```json
{
  "pluginConfigs": {
    "jev-model-router": {
      "options": {
        "enabled": true,
        "providerPreset": "claude",
        "routeMainModel": false,
        "routeMainEffort": true
      }
    }
  }
}
```

Reload Claude Code after editing the file and run `/router status`. To try settings in the current session, use `/router main-model on|off`, `/router main-effort on|off`, `/router subagents on|off`, `/router classify-turns on|off`, or `/router mode basic|custom|observe`. `/router save` writes the legacy defaults cache. Native settings and explicit launch or managed settings take precedence. `/router reset` removes the cache and restores the original plugin options. Pins have their own scopes and persist independently.

Assignment settings apply to new assignments. An active tool loop keeps its assigned model and effort. Hot reload restores session controls from configured defaults. Requested model and effort describe the outgoing request. Serving identity appears separately when the host supplies it.

## Stop or resume the router

`/router off` stops router classification, routing, per-turn logging, and candidate workflows for this session. `/router on` resumes routing on new turns with the same preferences. While stopped, main requests, subagent spawns, and ordinary tool calls pass through unchanged in every engine. The router keeps its commands and menu available. It discards pending routing decisions and signals active review completions to stop. Requests already sent to a provider may still complete.

To start future sessions with the router off, turn off **Enable model router** in `/router` or set `enabled` to `false` in user settings. The legacy `/router mode off` alias selects Basic routing. Use `/router off` to stop the router.

## Provider presets

Run `/router preset claude`, `/router preset gpt`, or `/router preset mixed` to switch for the session. The **Provider preset** setting in `/router` saves the default as the `providerPreset` plugin option. Mixed is the default.

Claude and GPT presets keep enabled catalog preferences for the selected provider and map other preferences to its corresponding tier before dispatch. This covers the legacy tiers, role preferences in both engines, and native review and repair workers. The router still checks eligibility and uses the existing classification backend. Switching presets leaves the saved model preferences intact and applies to new assignments.

| Preset | Fast | Balanced | Deep |
|---|---|---|---|
| Claude | Haiku 5.5 | Sonnet 5.5 | Opus 5.5 |
| GPT | GPT-6 Luna | GPT-6.1 Terra | GPT-6 Astra |

Explicit pins and model routing switches still take precedence. For a single-provider setup, select a model from that provider in `/model` as well so requests the router preserves use it. Review policies that require a different model family still block same-family review. The preset makes its selection before dispatch and adds no retries.

## Legacy modes and logs

**Basic** uses fast/balanced/deep tier policy. **Custom** uses task preferences, with Basic fallback where no preference exists. **Observe** applies Basic and logs Custom recommendations: it is not a global dry run. These modes govern `legacy` and the applied side of `v2-shadow`, not `v2`.

Custom defaults are Opus for orchestration/design, Astra for visual analysis, Sonnet for specified implementation, and Haiku for mechanical work, file scouting and simple answers. Substantive explanations retain tier/effort assessment; short prompts alone do not establish simplicity. Edit `hooks/task-routing.ts` for legacy rules/examples, existing model preference options for choices, and `catalog/models.json` for recorded compatibility. Regenerate the catalog with `node scripts/build-catalog.mjs`.

Normal transcript output reports one effective main-turn model/effort line, including the request type and engine. Debug logs contain classification/recommendation details and errors. Enable `claude --debug` to inspect them. A recommendation is not an applied change, and an outgoing request is not proof of upstream identity.

## Manual model selection through VibeProxy

Before launching Claude Code, refresh native model entries from the repository root:

```sh
python3 scripts/sync-model-picker.py --quiet
```

The script preserves native Claude/user entries, marks generated entries “Via VibeProxy”, and excludes image-only endpoints and `codex-auto-review`. Advertisement does not verify access or task quality. Discovery failure retains the old menu; the first update backs up settings beside the configured Claude Code settings file. See the [development guide](../development.md).

For manual control, turn **Main model routing off**, then select `/model`. Turn **Main effort routing off** too for manual effort control. Enter saves the model default; `s` selects it for this session. Launch arguments or a custom launcher may override saved values. Native selections are not inferred as persistent router pins; use explicit router pins when routing is enabled.

## V2 controls and pins

Legacy remains the default. To use dimension-based routing now:

```text
/router engine v2
/router main-model on
/router main-effort on
```

V2 reuses configured model preferences, checks known availability/tool compatibility and honors independent mutation switches. Its decisions report `qualification=configured`, not empirical workload approval. Low confidence or an ineligible automatic preference normally preserves the inherited request; explicit conflicting pins, known hard failures and unmet mandatory requirements still block. Context fitting, compaction, ordinary request caps, provider substitutions and server-tool handling belong to Claude Code/proxy/provider. The router does not demand proof of those host responsibilities before allowing chat.

```text
/router engine legacy|v2-shadow|v2
/router review-mode off|recommend|automatic
/router subagent-effort on|off
/router pin model <exact-id> [--scope next|session|persistent]
/router pin effort <low|medium|high|xhigh|max> [--scope next|session|persistent]
/router unpin model|effort [--scope next|session|persistent]
```

Run mutation commands yourself in the composer. Model/plugin/notification text cannot mint control or enrollment authority. Model and effort resolve separately: assignment > session > persistent within the same execution/review purpose. Omitted pin scope means session. Public pins are execution-only, never reviewer choices, spending grants or fallback permission. They do not override a disabled routing switch; a conflicting fixed field produces an explicit blocker.

Next intent binds only to the next eligible user execution assignment, not a control command, child or reviewer. It commits before dispatch and cannot overwrite concurrently replaced intent. Legacy never consumes it. Session/next intent is conversation-bound: clear/branch does not copy it, matching-identity reload/resume retains it. Persistent changes use governed native settings with user/managed-policy provenance. Native `/model` origin mapping remains unsupported; disable the routing switch to retain a native choice.

**Simple answers & chat model** reuses `simpleAnswerModel` (default Haiku) and is visible in `/router`. V2 includes standalone greetings/thanks and prefers low effort when configured, otherwise medium. Effort switches/pins still win. Continuations, approvals and arbitrary unknown tasks do not become cheap-chat requests. Like other native menu edits, changing this option saves a default, not a session-only override; legacy Custom classification remains unchanged.

Subagent model selection happens at spawn. The separate `routeSubagentEffort` switch (default false) authorizes effort at the child's first canonical request; spawn has no direct effort field. With it off, unknown child effort remains host-managed. Legacy applies no subagent-effort changes.

Shadow leaves legacy execution intact and performs no v2 pin consumption, reservation, check, review or acceptance. An **additional** dimension-classifier call requires `v2ShadowClassifier=true` in observable user/managed-policy settings, off by default. Project/local/flag values cannot authorize that extra spend.

## Candidates, review and explicit acceptance

```text
/router candidate register path/to/candidate.json
/router candidate status <candidate-id>
/router review [candidate-id]
/router repair <candidate-id>
/router verify <candidate-id> [--confirm-scope]
/router accept <candidate-id>
```

A candidate manifest is **data**, never command/model/spending authority:

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

Use explicit repository-relative paths, not globs/traversal. Selected untracked files and base-tracked deletions work; dangling/out-of-root links reject. The base commit resolves once. Requirements, artifact/context bytes, trusted checks, review configuration, required independence and policy/catalog identity bind the SHA-256 revision. Standing requirements can only tighten the manifest. Re-registering the same manifest path keeps its original scope, ID and counters; a genuinely new candidate needs a different explicit manifest. Edits need current evidence, not reset counters.

No-argument review requires exactly one enrolled candidate. Status shows historical findings separately from current unresolved material findings, reviewed/verified revisions, counters and blockers. A completed targeted closure does not erase the original report.

### Bounded native review

The default works without an embedding adapter: full review and targeted verification use fresh, history-free, tool-less `$.model.complete` calls on Opus medium; repair uses Sonnet medium. Each explicit composer command authorizes **one** stage call, capped at **8192 output tokens and 120 seconds** by default. One full pass, one repair and one targeted closure are available per candidate; repeating a command does not buy another pass. API errors, invalid JSON, timeout, stale evidence and uncertain restored calls never become a clean review or automatic retry.

Review receives frozen enrolled file contents and requirements, not the author's conversation/rationale. Repair returns data-only replacements; the controller validates all patches, rechecks frozen inputs and applies only enrolled material-finding paths through governed Write. Normal host permissions still apply. No worker commits, publishes, executes arbitrary commands or edits context files.

After inspecting the actual repair, **the user** may run `verify <id> --confirm-scope` to attest that its semantic changes stay within the original material findings/invariants. That approval binds the exact original/repaired revision pair. The repair model cannot self-attest. Without trusted scope assessment verification remains blocked. The separate targeted reviewer must still independently confirm correctness, every material finding's closure, no new material issues and scope; checks or human attestation alone cannot renew review.

### Review policy and automatic checkpoints

`reviewPolicyJson` is a strict JSON string option accepted only from observable user/managed-policy sources. Its default is:

```json
{"schemaVersion":1,"reviewer":{"model":"claude-opus-5-5","effort":"medium"},"repair":{"model":"claude-sonnet-5-5","effort":"medium"},"maxTokens":8192,"timeoutMs":120000,"requireReview":false,"distinctFamily":false,"requiredCheckIds":[],"automatic":[]}
```

`maxTokens` must be 1–64000 and `timeoutMs` 1–600000, both integers. Required check IDs are unique. `distinctFamily=true` requires a known different family from the sealed author (or completed repair author for targeted verification); unavailable configurations block rather than weakening independence. Fresh context alone does not claim cross-family diversity or observed serving identity. Native completions expose usage but no serving-model field; that field stays unknown.

`off` suppresses recommendations, not explicit/mandatory review. `recommend` never auto-launches. `automatic` additionally needs an exact policy grant such as `{"candidateId":"cand_example","stages":["full"]}` in `automatic`, and an explicit checkpoint. No wildcards apply. The registered `candidate_checkpoint` tool may request only an already enrolled candidate/stage; it cannot enroll scope, accept work, attest repair or grant itself allowance. Mode changes, ordinary edits, turn completion and model prose authorize no spending.

### Governed executable checks

`verificationChecksJson` accepts user/managed-policy definitions only, managed taking precedence:

```json
{"schemaVersion":1,"checks":[{"id":"test","command":"node scripts/smoke.mjs","cwd":".","timeoutMs":120000}]}
```

A manifest names IDs, not commands. Required checks run before review/targeted verification through governed Bash with bounded timeout and canonical shell-quoted cwd. The wrapper appends a per-execution nonce-bound **terminal** exit receipt; a matching successful receipt plus uninterrupted foreground completion can pass. PASS prose, arbitrary `exitCode`, missing/wrong/nonterminal receipts, denials, timeout and background execution cannot. Every required check must pass against the same unchanged revision. Failure blocks the stage without purchasing another model attempt. Empty lists mean **no checks required**, not invented executed evidence.

Acceptance recaptures current content/configuration and requires all standing checks/review and closure. With neither required checks nor review, explicit acceptance may be unreviewed, never a quality certification. No acceptance commits/publishes; ordinary “done” prose cannot accept. See [runtime contracts](../v2/runtime-contracts.md) and [validation evidence](../v2/validation.md#configured-native-integration--november-1-2026).

## Rollback

Run `/router engine legacy` for future assignments and disable `v2ShadowClassifier` if enabled. Keep existing Basic/Custom/Observe settings. Rollback does not undo a dispatched request, erase counters, approve candidates or retroactively revoke an authorized job. Scoped `unpin` removes intent; legacy leaves it staged. Engine changes invalidate single-policy comparison/evidence assumptions. Functional live checks are recorded in validation; held-out workload-quality certification remains separate.

# Model Router

A Claude Code mod that uses [TypeSafe’s Jev](https://typesafe.ai/) to choose models for software and product work. It supports task preferences, separate controls for the main conversation and subagents, and a native `/router` configuration menu.

This project started from the Jev model router in [Daniel (San) Ávila’s claude-code-templates](https://github.com/davila7/claude-code-templates/tree/8f1f608e9396ba7e70d73372cabc85c028c2f79d/cli-tool/components/mods/productivity/jev-model-router). It retains the original MIT license. See [Credits](#credits).

The [documentation index](docs/README.md) links current usage, contributor setup, and research. The [v2 design brief](docs/v2/design-brief.md) defines the v2 contract.

## V2 routing and bounded review

**V2 works on the native Claude Code path; legacy remains the default.** Enable it for new assignments:

```text
/router engine v2
/router main-model on
/router main-effort on
```

- V2 classifies role, specification, verification, execution span and consequence, then applies configured preferences subject to switches, pins and known compatibility. `qualification=configured` is not empirical workload certification; the catalog still has no fabricated environments or workload approvals.
- Context fitting, compaction and ordinary execution limits/provider behavior are owned by Claude Code/proxy/provider, not router admission gates. Router-owned explicit fallback grants, pins, hard restrictions and review permissions remain enforced.
- Execution pins support next, session and persistent scope. Subagent effort has its own switch, off by default, applied at the child's first request rather than spawn.
- Candidate review, bounded repair, independent targeted verification and explicit acceptance bind to exact artifact/configuration hashes. Default fresh native completions enforce finite output-token/time allowances; repair uses governed Write. Review mode alone never grants automatic spend.
- Required executable checks use governed Bash with nonce-bound terminal exit receipts. Prose saying PASS is not evidence. Ordinary edits and “done” messages neither launch review nor accept work.
- `v2-shadow` retains legacy execution without v2 workflow effects; extra classification requires explicit user/managed-policy opt-in.

See [controls, candidates and rollback](docs/usage/router-controls.md#v2-controls-and-pins), [functional live evidence and remaining research](docs/v2/validation.md#configured-native-integration--november-1-2026), and [runtime boundaries](docs/v2/runtime-contracts.md#phases-57-native-integration).

## How it works

```text
Your prompt → Jev classification → routing policy → Claude Code request
                                                      ↓
                                            VibeProxy / CLIProxyAPI
                                                      ↓
                                             Connected model provider
```

Claude Code supplies the agent loop and tools. The router can change the model and reasoning effort on the first request of a main turn, or the model when Claude Code spawns a subagent. VibeProxy is optional; it lets the harness reach models from several providers through one local endpoint.

Legacy asks tier, effort, risk, task type and implementation category in one classification request. V2 uses its separate role/specification/verification/span/consequence questions. The router reuses the main turn’s decision through that turn’s tool loop. It does not reclassify every tool call.

## Legacy routing modes

| Mode | What runs |
|---|---|
| **Basic** | The original fast/balanced/deep tier policy. |
| **Custom** | Task preferences from this project, with Basic fallback for tasks without a preference. |
| **Observe** | Basic routing remains active. The router also records what Custom would recommend in the debug log, without applying those Custom recommendations. |

All modes respect the main model, main effort, and subagent routing switches. **Observe is not a global dry run:** Basic can still change a model or effort when its switch is on. The mode defaults to Observe; main model routing defaults to off.

Custom preferences:

| Task | Default preference |
|---|---|
| Orchestration | Opus 5.5, medium effort |
| Visual analysis | GPT-6 Astra |
| Design-led implementation: architecture, original UX/UI | Opus 5.5 |
| Specified implementation with clear contracts and references | Sonnet 5.5 |
| Mechanical edits with an exact prescribed change | Haiku 5.5 |
| File scouting that returns paths and snippets | Haiku 5.5 |
| Simple answers: spelling, small counts, straightforward stable facts | Haiku 5.5 |
| Investigation, review, substantive explanation | Basic tier and effort policy |

These are editable preferences, not benchmark rankings or a measured cost optimizer. The router applies a preference only when confidence, risk, availability, and tool compatibility checks permit it. An unverified preferred model or low-confidence preference retains the current request; consequential tasks use the original risk policy. Legacy does not apply subagent effort preferences; v2 supports them with the separate `routeSubagentEffort` permission.

## Setup

Use a Claude Code version with function-hook Mods support. This copy has been validated with **Claude Code 2.1.316**. Python 3 is needed only for model-menu synchronization. Node 23.6+ runs the tests and catalog generator. No package installation is required for this repository.

```sh
git clone https://github.com/radiator-engineering/model-router.git
cd model-router
export MODEL_ROUTER_DIR="$PWD"
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 command claude --plugin-dir "$MODEL_ROUTER_DIR"
```

Configure the Jev provider in Claude Code’s native `/config` screen. TypeSafe is preferred when its key is present; Vercel AI Gateway is also supported. Without either key, the built-in classifier supplies Basic tier decisions; Custom task preferences require task classification from Jev. Keep credentials in user settings, outside this repository.

### Use with VibeProxy

First connect your provider accounts in VibeProxy and start its local server. For an installation that stores the local client key at `~/.cli-proxy-api/client-key`:

```sh
(
  unset CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY
  export ANTHROPIC_BASE_URL="http://127.0.0.1:8317"
  export ANTHROPIC_AUTH_TOKEN="$(cat "$HOME/.cli-proxy-api/client-key")"
  export CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1
  python3 "$MODEL_ROUTER_DIR/scripts/sync-model-picker.py"
  command claude --plugin-dir "$MODEL_ROUTER_DIR"
)
```

The sync script adds conversation models advertised by VibeProxy to the native `/model` picker, preserving native Claude rows and user-added options. It excludes image-only and review-only endpoints. It leaves existing settings in place if discovery fails and saves an initial backup beside `~/.claude/settings.json`. Advertised models still need working upstream access; listing a model does not verify it.

Run the sync script before launch when connected models change. You can add it to your own shell launcher to refresh the list on every launch.

## Controls

Run `/router` to open the native config screen:

- Down selects a setting. Space or Enter changes it; Mode uses the native choice selector.
- Successful menu changes save immediately. Escape closes the screen and retains them.
- `/router status` shows the effective runtime settings.

For manual model selection, turn **Main model routing off**, then choose from `/model`. Turn **Main effort routing off** too if you want to control reasoning effort yourself. Enter in `/model` saves a default; `s` selects a model for the current session.

Classification and recommendation logs describe suggestions. The main result log and router status distinguish changes applied to the request from requests left unchanged. See [Router controls](docs/usage/router-controls.md) for direct commands and persistence details.

## Customize

| File | Change here |
|---|---|
| [hooks/task-routing.ts](hooks/task-routing.ts) | Task definitions, classifier examples, preferences, and eligibility checks. |
| [catalog/models.json](catalog/models.json) | Model IDs, verified capabilities, availability, and Claude Code compatibility. |
| [.claude-plugin/plugin.json](.claude-plugin/plugin.json) | User-facing options and their defaults. |
| [hooks/policy.ts](hooks/policy.ts) | Basic tier policy, confidence thresholds, risk rules, and effort decisions. |
| [hooks/router-controls.ts](hooks/router-controls.ts) | Native config integration and runtime controls. |
| [scripts/sync-model-picker.py](scripts/sync-model-picker.py) | Proxy discovery and native model picker entries. |

After editing the catalog, regenerate the TypeScript data used by the mod:

```sh
node scripts/build-catalog.mjs
```

Existing user options override model preferences declared as code defaults. The plugin directory keeps the upstream name `jev-model-router` so existing settings continue to work.

## Verify changes

```sh
node scripts/smoke.mjs                  # Local tests; no network
node scripts/smoke.mjs --live --tasks   # Also sends fixture prompts to Jev
command claude plugin validate "$MODEL_ROUTER_DIR"
```

The smoke runner writes timestamped reports to the ignored `test-results/` directory and compares each run with the previous run of the same mode. Live classification can vary; inspect individual decisions and confidence scores when a fixture fails. These tests do not establish quality on every task or verify every advertised provider model.

See the [development guide](docs/development.md), [task routing](docs/usage/task-routing.md), and the [catalog guide](catalog/README.md) for more detail. Keep workstation notes and unredacted research under ignored `/local/`; public documentation uses portable setup examples.

## Privacy and cost

With an external Jev backend configured, the router sends it the main prompt or the subagent assignment text. Built-in classification uses Claude Code’s own model path. Model inference goes to the configured provider or proxy. Jev classification is separate from the chosen model’s usage and billing.

Switching the main model can reduce prompt-cache reuse. A smaller model does not guarantee lower total cost for a long conversation. Provider subscriptions, quotas, and any additional usage charges depend on the upstream account configuration.

## Credits

The original tier router, provider integration, policy, and initial tests came from **Daniel (San) Ávila and contributors** to [claude-code-templates](https://github.com/davila7/claude-code-templates). We extracted `cli-tool/components/mods/productivity/jev-model-router` at commit `8f1f608e9396ba7e70d73372cabc85c028c2f79d`.

This standalone repository adds task preferences and examples, a model catalog, native router controls, clearer decision logs, repeatable smoke reports, and VibeProxy model-menu synchronization. [UPSTREAM.md](UPSTREAM.md) records the source. [LICENSE](LICENSE) retains the upstream MIT copyright and terms.

# Router controls

Run `/router` to open Claude Code’s native configuration screen, filtered to the router’s five settings. There is no question dialog or free-text answer.

Use Down to focus a setting. Space or Enter toggles a boolean in place; Mode opens the native enum selector. Escape closes the screen. Each successful change is saved immediately to Claude Code’s plugin settings and applied to the router, so Escape retains changes. Setting descriptions are supplied through `config.describe`.

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

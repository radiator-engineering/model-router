# Router controls

Run `/router` to open Claude Code’s native configuration screen, filtered to the router’s five settings. There is no question dialog or free-text answer.

Use Down to focus a setting. Space or Enter toggles a boolean in place; Mode opens the native enum selector. Escape closes the screen. Each successful change is saved immediately to Claude Code’s plugin settings and applied to the router, so Escape retains changes. Setting descriptions are supplied through `config.describe`.

The menu filter uses session state that survives plugin hot reloads. Running `/config` normally shows all settings.

`/router status` prints effective settings. Existing direct commands remain available: `main-model on|off`, `main-effort on|off`, `subagents on|off`, `classify-turns on|off`, and `mode basic|custom|observe`. Direct commands change this session; `/router save` stores their defaults, and `/router reset` restores plugin options.

Implementation follows the native `userConfig`, `config.describe`, and `config.set` APIs documented at https://code.claude.com/docs/en/plugins/mods/reference.md . Opening config is deferred until the router command releases the turn, as the engine forbids nested command dispatch.

## Modes and logs

**Basic** uses the original fast/balanced/deep tier policy. **Custom** uses our task preferences (Opus for orchestration/design, Astra for visual analysis, Sonnet for specified work, Haiku for mechanical work/file scouting), with Basic fallback where no preference exists. **Observe** keeps Basic routing active and logs what Custom would recommend, without applying Custom recommendations. Observe can still change models through Basic routing when the corresponding switches are enabled. Every mode respects the model and effort switches.

Customize `hooks/task-routing.ts` for role/category rules, default model preferences, confidence checks, and classifier examples. Customize `catalog/models.json` for available models and verified capabilities, then run `node scripts/build-catalog.mjs` to regenerate the runtime catalog. Existing plugin model preference options override defaults in code. Old `off`/`apply` values remain accepted as aliases for Basic/Custom.

Classification and task recommendation lines describe suggestions. The main result line and status show the effective model and effort, explicitly distinguishing unchanged requests from applied changes. With both main switches off, recommendations cannot change the main request.

## Simple answers versus explanations

Custom mode sends high-confidence `simple-answer` tasks to Haiku: spelling, small literal counts, direct supplied lookups, and straightforward stable facts. Substantive `explanation` tasks (teaching, causal reasoning, comparisons, tradeoffs, summaries) continue through the Basic tier/effort complexity policy. Short prompts alone are not evidence of simplicity; investigation and consequential advice are excluded. Catalog verification, confidence and risk checks still apply.

Edit `simpleAnswerModel` in plugin options to override Haiku. Edit `hooks/task-routing.ts` to change the boundary guidance and examples. Main model routing must be enabled for the main conversation to switch. A simple-answer model preference preserves current effort unless another policy explicitly changes it.

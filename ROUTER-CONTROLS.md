# Router controls

Run `/router` to open Claude Code’s native configuration screen, filtered to the router’s five settings. There is no question dialog or free-text answer.

Use Down to focus a setting. Space or Enter toggles a boolean in place; Mode opens the native enum selector. Escape closes the screen. Each successful change is saved immediately to Claude Code’s plugin settings and applied to the router, so Escape retains changes. Setting descriptions are supplied through `config.describe`.

The menu filter uses session state that survives plugin hot reloads. Running `/config` normally shows all settings.

`/router status` prints effective settings. Existing direct commands remain available: `main-model on|off`, `main-effort on|off`, `subagents on|off`, `classify-turns on|off`, and `mode off|observe|apply`. Direct commands change this session; `/router save` stores their defaults, and `/router reset` restores plugin options.

Implementation follows the native `userConfig`, `config.describe`, and `config.set` APIs documented at https://code.claude.com/docs/en/plugins/mods/reference.md . Opening config is deferred until the router command releases the turn, as the engine forbids nested command dispatch.

## Modes and logs

Original (`off`) runs the original tier policy. Observe runs that same policy and logs task preferences without applying those preferences. Apply uses verified task preferences, falling back to the original policy for tasks without a preference. Every mode respects the model and effort switches: Observe is not a global dry run.

Classification and task recommendation lines describe suggestions. The main result line and status show the effective model and effort, explicitly distinguishing unchanged requests from applied changes. With both main switches off, recommendations cannot change the main request.

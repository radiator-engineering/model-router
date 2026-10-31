# Router menu and controls

Restart Claude Code to load version 0.6, then enter `/router`. It opens an interactive menu with current status and four choices:

- Mode: off, observe, or apply.
- Routing switches: main model, main effort, or subagent routing.
- Defaults and logging: toggle per-turn classification, save defaults, or reset defaults.
- Done.

Selecting a routing switch toggles it; the menu then shows the updated state. Esc dismisses the dialog. Changes already made remain in effect for this session.

## Direct commands

```text
/router status
/router mode off
/router mode observe
/router mode apply
/router main-model on
/router main-model off
/router main-effort on
/router main-effort off
/router subagents on
/router subagents off
/router classify-turns on
/router classify-turns off
/router save
/router reset
```

`main-model on` allows main-model changes; it does not turn on effort changes. `main-effort on` permits effort changes, so the main session may move away from medium. Catalog checks, confidence gates, routing mode and consequential-action handling still apply.

`classify-turns on` enables per-turn classification and recommendation logging independently of those permissions. With both main-routing switches off, it logs decisions while preserving the main model and effort. Each ordinary classified prompt makes a Jev call. `/router` commands themselves do not call Jev or a working model. `/router status` only reads settings.

Classification still runs when needed for an enabled main-routing switch, even if `classify-turns` is off. That toggle controls classification for visibility alone; it does not disable classification needed to route work. Subagent classification is controlled separately by `subagents`.

## Session changes and saved defaults

Menu and direct-command changes take effect immediately in the current session, at the next applicable routing event. They do not edit `.zshrc` or `~/.claude/settings.json`.

`save` writes the current five controls to the plugin's private persistent store under `model-router.defaults.v1`. New sessions load those saved controls over the plugin options. Existing sessions keep their own state. This preserves the existing `jev-model-router` plugin identity while keeping the public command independent of the classifier.

`reset` deletes the saved controls and restores the plugin options with which this session started. It does not change your preferred models, keys, catalog, selected main model, or shell launcher. Saving/restoring only affects these five controls: mode, main model routing, main effort routing, subagent routing and per-turn classification.

Without saved defaults, `classifyTurns` defaults to true. Your current user settings keep main-model and main-effort routing off, subagents on, and task mode apply. Consequently new sessions regain per-turn decision logs while keeping the main model/effort fixed.

## Validation

`node scripts/smoke.mjs` includes parser, menu navigation, dismissal, toggle, persistence, classification and actual-hook tests. The menu and a direct toggle were also exercised in interactive Claude Code 2.1.314 with no model requests. `claude plugin validate` checks command/store/UI compatibility with the loader.

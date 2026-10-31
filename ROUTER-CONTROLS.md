# Router menu and controls

Enter `/router` to open an inline list showing each setting's current draft value as **On** or **Off**, with a short description underneath. There are no option checkboxes or transition arrows.

- Up/Down highlights a setting.
- Enter selects that setting and flips its draft value.
- The following dialog offers **Save & Exit**, **Keep editing**, or **Cancel & Exit**.
- Keep editing returns to the list with the updated draft values.
- Esc at either dialog discards all staged changes and exits.

The native single-choice control ignores Space; this version uses Enter for selection and an explicit Save & Exit action. It does not implement Space-to-toggle or Enter-to-save-from-any-row.

The four settings are main-model routing, main-effort routing, subagent routing and per-turn classification/logging. `/router mode` opens a separate inline picker for off/observe/apply, with a description for each mode. The mode picker saves and exits after a recognized selection.

## Direct commands

```text
/router status
/router mode
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

Inline-menu changes remain staged until Save & Exit, then take effect in the current session and persist for future sessions. Direct toggle commands still take effect immediately for the current session; use `/router save` to persist those. Neither path edits `.zshrc` or `~/.claude/settings.json`.

`save` writes the current five controls to the plugin's private persistent store under `model-router.defaults.v1`. New sessions load those saved controls over the plugin options. Existing sessions keep their own state. This preserves the existing `jev-model-router` plugin identity while keeping the public command independent of the classifier.

`reset` deletes the saved controls and restores the plugin options with which this session started. It does not change your preferred models, keys, catalog, selected main model, or shell launcher. Saving/restoring only affects these five controls: mode, main model routing, main effort routing, subagent routing and per-turn classification.

Without saved defaults, `classifyTurns` defaults to true. Your current user settings keep main-model and main-effort routing off, subagents on, and task mode apply. Consequently new sessions regain per-turn decision logs while keeping the main model/effort fixed.

## Validation

`node scripts/smoke.mjs` includes parser, menu navigation, dismissal, toggle, persistence, classification and actual-hook tests. The enum list, arrow navigation, Enter selection, Keep editing, descriptions and Escape cancellation were exercised in interactive Claude Code 2.1.314 without model requests. Saving and failed-save rollback also have automated coverage. `claude plugin validate` checks command/store/UI compatibility with the loader.

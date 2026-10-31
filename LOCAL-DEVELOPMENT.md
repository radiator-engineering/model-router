# Local development

This is a standalone copy of the Jev model router. See UPSTREAM.md for the source commit and LICENSE for its terms.

## Run the local copy

Launch a separate Claude Code session from a terminal:

```sh
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 command claude \
  --plugin-dir "$HOME/Documents/repos/jev-model-router"
```

`command claude` bypasses the existing shell function so it does not also load the installed copy. Your interactive `claude` shell function was connected to this local repo and VibeProxy on October 30, 2026. It refreshes the native model picker and respects the saved model and effort. `command claude` bypasses that shell function; the proxy environment in the example below is therefore explicit.

The local copy has the same plugin name, so it reads the existing `pluginConfigs.jev-model-router.options` in `~/.claude/settings.json`. Keep API keys in user settings; do not commit them here. Restart the test session after changing plugin code.

## Run with VibeProxy

With VibeProxy running and your accounts connected:

```sh
(
  unset CLAUDE_CODE_OAUTH_TOKEN ANTHROPIC_API_KEY
  export ANTHROPIC_BASE_URL="http://127.0.0.1:8317"
  export ANTHROPIC_AUTH_TOKEN="$(< "$HOME/.cli-proxy-api/client-key")"
  CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 command claude \
    --plugin-dir "$HOME/Documents/repos/jev-model-router"
)
```

This scopes proxy settings to the test session. It does not change your shell configuration.

## Code map

- `.claude-plugin/plugin.json`: option declarations and defaults.
- `hooks/jev-model-router.ts`: classification calls and Claude Code hooks.
- `hooks/policy.ts`: decision schema, confidence rules, model mapping, and effort rules.
- `tests/policy.test.ts`: policy tests using `claude-code/testing`.
- `README.md`: current setup, usage, customization, and upstream credits.

## Validation

```sh
command claude plugin validate "$HOME/Documents/repos/jev-model-router"
```

This checks the plugin structure, not live routing behavior. The upstream tests import `claude-code/testing`; the smoke runner below supplies a local assertion adapter. Use `sfw` for package-manager commands.

## Suggested first change

Add task classification fields and a small model capability catalog. Start by logging recommendations, then test routing on subagents before changing the main conversation's model. Confirm proxy model IDs and reasoning compatibility before enabling GPT choices.

## Git workflow

Commit each working change locally. The remote is `git@github.com:radiator-engineering/model-router.git`. Avoid setting the upstream monorepo as a push destination for this extracted directory.

## Smoke tests and run history

Requires Node 23.6+ with native TypeScript support. No package installation is needed.

```sh
node scripts/smoke.mjs         # local policy and catalog tests; no network
node scripts/smoke.mjs --live  # policy tests plus 8 real Jev requests
```

The adapter runs the unchanged upstream `claude-code/testing` assertions under Node. It checks pure policy behavior, not the Claude Code hook runtime. Live mode uses your existing TypeSafe plugin key from user settings, or `JEV_API_KEY` when provided. `JEV_MODEL` optionally pins the decision model. It sends only the fixed fixture prompts to TypeSafe; it does not send repository contents or call Claude/OpenAI models.

Each run writes a timestamped JSON report to `test-results/`, which Git ignores. `latest-offline.txt` and `latest-live.txt` identify the newest reports. Each report compares against the previous run of the same mode and records:

- Git commit, dirty state, Node version, policy/fixture/question hashes.
- Every policy test result and failure message.
- Live decisions, confidence, latency, reported model, token usage and proposed route.
- Previous totals, changed test results and changed classification decisions.

Reports do not contain API keys or raw API response bodies. The proposed route uses standard Haiku/Sonnet/Opus tiers and a Sonnet/medium starting point; it does not apply your production routing settings.

A nonzero exit means an assertion, expected live label, risk check or API call failed. Live labels in `tests/fixtures/smoke.json` are initial human expectations, not objective truth. The irreversible-production case checks risk only, because complexity and action impact are distinct. Review disagreements before changing a label.

Use matching fixtures, question definitions and model versions for controlled comparisons. The `jev-latest` alias may change upstream. Confidence changes alone do not demonstrate better accuracy. These fixtures evaluate routing decisions; they do not evaluate the quality of code produced by the selected models. Keep future classifier examples separate from these evaluation fixtures.

## Model catalog

`catalog/models.json` contains editable model profiles. See `catalog/README.md` for field meanings and the future eligibility rules. This catalog is not yet wired into live routing.

## Task-role routing

See `TASK-ROUTING.md` for implementation categories, user model preferences, observe/apply modes and verification gates. Run `node scripts/smoke.mjs --live --tasks` to evaluate the expanded classifier. After editing the catalog, run `node scripts/build-catalog.mjs` to rebuild the hook-compatible data module.

## Interactive controls

Restart Claude Code after loading new plugin code, then run `/router` for the menu. See `ROUTER-CONTROLS.md` for direct commands, immediate session changes, saved defaults and per-turn logging.

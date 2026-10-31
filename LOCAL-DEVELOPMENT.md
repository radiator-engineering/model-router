# Local development

This is a standalone copy of the Jev model router. See UPSTREAM.md for the source commit and LICENSE for its terms.

## Run the local copy

Launch a separate Claude Code session from a terminal:

```sh
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 command claude \
  --plugin-dir "$HOME/Documents/repos/jev-model-router"
```

`command claude` bypasses the existing shell function so it does not also load the installed copy. Your normal `claude` command still uses `~/.claude/mods/jev-model-router` until you choose to change it.

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
- `README.md`: upstream usage and design notes.

## Validation

```sh
command claude plugin validate "$HOME/Documents/repos/jev-model-router"
```

This checks the plugin structure, not live routing behavior. The upstream tests import `claude-code/testing`; a compatible test runtime must be established before treating them as runnable in this standalone repo. No package dependencies or test adapters have been added. Use `sfw` for package-manager commands.

## Suggested first change

Add task classification fields and a small model capability catalog. Start by logging recommendations, then test routing on subagents before changing the main conversation's model. Confirm proxy model IDs and reasoning compatibility before enabling GPT choices.

## Git workflow

Commit each working change locally. No remote is configured; add your own remote if you want to publish or back up the repo. Avoid setting the upstream monorepo as a push destination for this extracted directory.

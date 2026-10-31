# Development guide

Use this guide to run and check a checkout of the current plugin. See [router controls](usage/router-controls.md) and [task routing](usage/task-routing.md) for its behavior. The [v2 specs](v2/product.md) describe the proposed redesign.

## Requirements and checkout

Use a Claude Code version with function-hook Mods support. Compatibility evidence in this repository records Claude Code 2.1.314. Node 23.6+ runs the offline tests and catalog generator. Python 3 is needed for optional proxy model-picker synchronization. No package installation is required.

From the repository root, set a checkout path for the examples below:

```sh
export MODEL_ROUTER_DIR="$PWD"
```

Launch the checkout in a separate terminal session:

```sh
CLAUDE_CODE_ENABLE_FUNCTION_HOOKS=1 command claude \
  --plugin-dir "$MODEL_ROUTER_DIR"
```

`command claude` bypasses a shell function named `claude`, if one exists. Load one copy of the plugin per test session. Restart the session after changing plugin code.

The plugin reads options under `pluginConfigs.jev-model-router.options` in the configured Claude Code user settings. Existing options can override code defaults. Keep credentials in user settings or the supported environment variables, outside committed files.

## Optional VibeProxy setup

With a local VibeProxy server running and provider access configured, use the [proxy launch example](../README.md#use-with-vibeproxy). The example uses loopback port `8317` and a client-key file under `$HOME`; adapt those values to the installation.

To refresh advertised conversation models in the native picker, run the sync script before launch:

```sh
python3 "$MODEL_ROUTER_DIR/scripts/sync-model-picker.py"
```

The script uses `ANTHROPIC_BASE_URL` and `ANTHROPIC_AUTH_TOKEN` when set, with documented local defaults. It writes native picker settings and creates an initial backup. Discovery does not verify upstream access or model quality. A shell launcher can run the script on startup, but the repository does not install or alter a launcher automatically.

## Code map

| Path | Responsibility |
|---|---|
| [.claude-plugin/plugin.json](../.claude-plugin/plugin.json) | Options, defaults, and plugin metadata |
| [hooks/jev-model-router.ts](../hooks/jev-model-router.ts) | Classification requests and harness hooks |
| [hooks/policy.ts](../hooks/policy.ts) | Basic tier, confidence, risk, and effort policy |
| [hooks/task-routing.ts](../hooks/task-routing.ts) | Task questions, preferences, and eligibility checks |
| [hooks/router-controls.ts](../hooks/router-controls.ts) | Runtime controls and native configuration integration |
| [catalog/models.json](../catalog/models.json) | Editable model profiles and recorded evidence |
| [tests](../tests/) | Policy, catalog, controls, and hook tests |
| [scripts](../scripts/) | Offline test support, smoke reports, catalog generation, and picker sync |

## Validation

```sh
node scripts/smoke.mjs
node scripts/build-catalog.mjs --check
command claude plugin validate "$MODEL_ROUTER_DIR"
```

The smoke runner checks policy, catalog, controls, and mocked hook behavior without network requests. Plugin validation checks structure. Neither establishes live provider compatibility or task quality.

After editing `catalog/models.json`, run `node scripts/build-catalog.mjs` and commit both the JSON and generated `catalog/model-data.ts`. The generated TypeScript module is required at runtime; it belongs in version control.

The root `tsconfig.json` extends harness-generated declarations under `.claude-plugin/types/`. Those declarations are ignored and must be present for editor/type-checking support. This repository does not currently provide a declaration-generation command; the offline smoke runner does not need them.

## Live classification and reports

Live runs send the fixed fixture prompts to the configured classifier and consume its allowance:

```sh
node scripts/smoke.mjs --live
node scripts/smoke.mjs --live --tasks
```

The runner reads the configured TypeSafe key from user settings or `JEV_API_KEY`; `JEV_MODEL` can pin the classifier model. These runs evaluate classification, not the work produced by the selected execution models. They do not send repository contents as prompts or call Claude/OpenAI execution models.

Reports go to ignored `test-results/`. They record code and fixture fingerprints, decisions, test outcomes, and comparisons with the previous run of the same mode. Use matching fixtures, classifier versions, question definitions, and starting conditions for comparisons. Keep classifier examples separate from evaluation prompts.

A failed expected label remains a classification failure even if a confidence check prevents a model change. Review disagreements before updating expected labels. Do not infer lower total completion cost from a smaller selected model alone.

## Public and personal files

Keep reusable setup instructions, tests, portable configuration, and bounded compatibility evidence in the public repository. Put workstation notes and unredacted research in ignored `/local/`. Native personal project settings at `.claude/settings.local.json` are also ignored. Keep credentials in their existing user-level stores.

The ignore rules also exclude generated declarations, graph caches, environment files, logs, and test reports. They do not exclude shared plugin configuration or the runtime model catalog. See the [documentation index](README.md) for public guides and the [research index](r-and-d/README.md) for source provenance.

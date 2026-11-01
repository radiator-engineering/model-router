# Claude Mods contract probes

These offline probes check the hook interfaces used by the v2 design. They are a separate fixture plugin, not part of the router's runtime. Do not load this plugin into an interactive session: it deliberately rewrites requests and returns synthetic policy responses.

From the repository root:

```sh
claude plugin validate experiments/harness-contracts
claude plugin test experiments/harness-contracts
```

On October 31, 2026, Claude Code 2.1.316 passed all 10 tests. Validation passed with fixture metadata warnings about the missing author and icon. Tests supply downstream stubs; they require no login, network, provider calls, or model allowance.

The checks cover main and subagent model/effort rewrites, synthetic responses without downstream requests, prompt drops, fail-closed error handlers, spawn denial, model-switch source fields, reviewer completion events, and reviewer registration fields.

Passing establishes how these hooks compose in the native test host. It does not establish that a live UI produces every simulated event, that upstream providers honor effort, that a proxy resolves the requested model, or that spawned agents obey all limits in a real session. See the [harness validation report](../../docs/r-and-d/03-claude-code-mods-harness-validation.md) for evidence and remaining work.

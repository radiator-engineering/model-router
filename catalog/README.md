# Model catalog

Edit `models.json` to maintain model profiles independently of Jev's classification prompt. `hooks/model-catalog.ts` defines the schema and validates it. This first catalog change does not alter the active router or load a second plugin.

The seed contains six model IDs advertised by the local VibeProxy endpoint on October 30, 2026: three Claude models and three OpenAI models. This is a selected starting set, not an exhaustive inventory. Discovery is a dated observation, not a live availability guarantee.

## Fields

| Field | Meaning |
|---|---|
| `enabled` | User allows this entry to be considered; it does not establish eligibility. |
| `availability` | Unknown, advertised by the proxy, or verified through a successful request. |
| `claudeCodeCompatibility` | Separately records whether the model works with Claude Code's tools and request format. |
| `qualityByUseCase` | Per-use-case ratings from 1 (lowest) to 5 (highest); null means unmeasured. |
| `maxComplexity` | Low, medium, high, or unknown. |
| `contextWindowTokens` | Known context capacity, or null. |
| `toolCalling` | Verified support, verified lack of support, or unknown. |
| `reasoningEfforts` | Explicitly supported values; an empty list means none have been established. |
| `allowanceWeight` | Relative subscription consumption estimate. Null means unknown; zero must be an intentional estimate. |
| `inputUsdPerMillion`, `outputUsdPerMillion` | Actual API prices when relevant. Subscription access does not imply a zero API price. |
| `evidence` | Source, date, and notes explaining ratings and observations. |

Quality ratings, context limits and costs remain unknown. Opus 5.5, Sonnet 5.5, Haiku 5.5 and GPT-6 Astra passed a basic Claude Code/VibeProxy text-and-tool smoke test at medium effort on October 30, 2026. Their evidence notes record that narrow verification. Visual-input quality and broader task performance remain untested. No model rankings are inferred from model names.

## Future selector contract

The selector should first require an enabled model, current availability, and verified harness/tool compatibility. It must treat unknown capability or cost as missing evidence, not as low cost or sufficient quality. Until candidates meet those requirements, preserve the current model and log the reason.

`reconcileAvailability()` accepts the IDs from discovery and returns a new catalog. Missing IDs become unknown; it never enables entries or claims compatibility. Credentials and remaining account allowances belong in runtime state, not in this committed catalog. Multiple subscriptions for the same model do not require duplicate model entries.

## Validate

Run `node scripts/smoke.mjs` from the repo root. It runs the original 42 policy tests plus seven catalog tests. Reports include catalog data, code and test fingerprints for comparisons. No API calls are needed for catalog validation.

The next step is to collect small tool-use evaluations, record quality and allowance estimates, then add the richer classifier and selector. Advertised IDs alone are insufficient to enable cross-provider routing.

# Claude Code Mods validation for router v2

Date: October 31, 2026. Scope: pinning, effort, blocking, and independent review. This report combines official contracts, primary community sources, and offline native-host probes. It does not validate provider translation or review quality.

**Conclusion:** v2 can implement routing controls and an optional review coordinator inside Claude Mods. The pure classifier/policy boundary still makes sense. The orchestration component can live in the same plugin or a companion Mod; it does not inherently need an external service.

## Evidence and versions

The installed CLI reports **2.1.316**. The locally generated declarations identify **2.1.314**. The official repository snapshot inspected at `80c6959d28c4c30ecd14fc1cdf172f19d9adad81` contains **2.1.277** declarations. The [official reference](https://code.claude.com/docs/en/plugins/mods/reference) explicitly says to prefer the installed build's generated declarations when GitHub is older. These differences matter for event and field coverage.

Evidence levels in this report are:

- **Documented:** an official guide or generated declaration exposes the operation.
- **Locally tested:** a native offline engine test exercised the hook with downstream stubs.
- **Community observed:** the author published source, tests, or a recorded live result. Its environment and date bound the claim.
- **Open:** a live integration or provider-specific claim still needs a targeted check.

## Capability assessment

| Requirement | What Mods expose | V2 implication |
|---|---|---|
| Explicit model/effort pins | Trusted commands, configuration events, plugin state/store, and request rewrites | Implement assignment/session/persistent pin state directly; a pin is policy state rather than a native pin object |
| Observe native model choices | `classic.PreModelSwitch` and `classic.PostModelSwitch` include requested/resolved identities and a source | Map supported native events to pin intent; distinguish automatic changes and resume from manual selection |
| Main effort control | `turn.step.effort` is rewritable | Apply qualified effort at the request boundary; preserve per-message timing rules and caps |
| Subagent effort control | Agent definitions/registration carry effort; the Agent tool has an invocation effort field; subagent `turn.step` carries effort | The missing effort field on `$.agent.spawn` is a narrow interface limit, not a harness-wide prohibition |
| Reject a prompt | `prompt.submit` can return `{ drop }` before `next` | Enforce known intake failures without a model call |
| Hold an individual model request | A `turn.step` generator can answer without calling `next` | Implement late `clarify`/`unavailable` as explicit policy responses; never label them generated solutions |
| Reject an agent or tool | `agent.spawn` supports `{ deny }`; tool hooks support denial | Gate reviewer creation and controlled actions before execution |
| Run independent review | `$.agent.register`, `$.agent.spawn`, agent IDs, completion events, and agent listings | Build a bounded coordinator within Mods; review is more than a recommendation-only capability |

The [Mods events guide](https://code.claude.com/docs/en/plugins/mods/events) documents prompt drops, per-request interception, subagent events, and answering a streamed step without inference. Our native probes exercised the corresponding short-circuit paths. No universal `{ deny }` result exists for all events: each event has its own result shape.

## Pinning details

Use router-owned pins as the dependable control surface. Native model events can supplement them. The [official hook reference](https://code.claude.com/docs/en/hooks#premodelswitch) distinguishes `command`, `picker`, and `sdk` switch sources; post-switch events additionally report automatic and resume changes. `command` also covers enabling fast mode, and `requested_model: null` means default. Therefore, the source field alone does not prove an intentional persistent pin.

Record the successful choice after the switch succeeds. Keep a policy for external SDK/Remote Control changes rather than assuming the owner typed them. Startup flags, environment settings, and resumed state need separate provenance handling. Automatic fallback must not become a new manual pin.

The [fable-pin source and tests](https://github.com/karanb192/claude-code-mods/blob/fb1f9c085c807d548f198fab2ada3a9585ac7e17/plugins/fable-pin/tests/register.test.ts) demonstrate a simpler subagent pin: rewrite the spawn model, exempt forks, and allow an off command. Both author tests passed locally on 2.1.316. This establishes an offline pinning pattern, not the complete v2 precedence contract.

The [claude-router live subagent report](https://github.com/alexei-led/claude-router/blob/d8b6c60a4b417df12d189d8e6a500a80e4cadbd0/experiments/mod-router/results/subagent-routing-live.json) records 2.1.296 routing and pass-through cases. It distinguishes an explicit Agent model argument from a project-defined agent whose model comes from frontmatter. The spawn payload alone is not a complete record of every inherited or configured preference.

## Effort details

Correct the earlier assumption that the Agent tool has no effort parameter. Its generated tool schema includes one. The [official subagent guide](https://code.claude.com/docs/en/sub-agents#choose-an-effort-level) documents invocation effort from 2.1.292, definition effort, and environment precedence. `$.agent.register` also accepts definition effort. `AgentSpawnInput` and `$.agent.spawn` still expose no direct effort field in the inspected 2.1.314 declarations.

For registered reviewers, set model, effort, tool permissions, and run limits on the definition. For other subagent requests, `turn.step` offers a separate effort control path. Our native tests confirmed that a subagent-tagged request can reach the downstream hook with rewritten effort.

The [model configuration guide](https://code.claude.com/docs/en/model-config#when-a-new-effort-level-starts) distinguishes selected effort from when it takes effect. The local step contract says named effort can wait until new message input; numeric budgets apply differently. Environment overrides, supported levels, and organization caps matter. A hook observing `medium` does not prove how a proxy forwarded it or how much computation the provider used.

The [model-effort-band tests](https://github.com/YeonwooSung/my-claude-code-mods/blob/f7da140f3fc63aa5c083f75cd48700517e882c68/model-effort-band/tests/adapter.test.ts) exercise streamed chunks, stale observations, model switches, and configuration attempts. The [author's limits](https://github.com/YeonwooSung/my-claude-code-mods/blob/f7da140f3fc63aa5c083f75cd48700517e882c68/model-effort-band/README.md) explicitly separate selected model, observed effort, later hook rewrites, and live UI verification. We inspected these tests; we did not rerun that full suite.

## Blocking and acceptance boundaries

Block before `next` reaches the operation. A drop or denial after execution cannot undo it. For a late routing failure, return a synthetic step with no tool calls and an explicit policy message. A normal `end_turn` marker is a transport shape; the coordinator must retain the distinct `unavailable` or `clarify` state.

The native suite confirms both prompt and streaming `.catch` handlers can hold a request after a guard throws before dispatch. A thrown hook without suitable error handling can fail open. Streaming output already emitted cannot be recalled. A `turn.complete` message is an annotation after the answer; it is not a gate on an answer that already streamed. The [streaming declarations](https://github.com/anthropics/claude-code/blob/80c6959d28c4c30ecd14fc1cdf172f19d9adad81/mods/types/claude-code.d.ts) distinguish yielded chunks from the final result.

For required review, choose an explicit acceptance boundary: controlled artifact completion, a guarded commit/merge/deploy tool, or a response that the coordinator buffers before release. A simple post-turn notification can report review status but cannot guarantee pre-publication approval. Buffering introduces latency and needs its own tests.

Known intake failures fit `prompt.submit`. Use `turn.start`'s stable `turnId` for canonical assignment state and `turn.step` for enforcement on the request that will run. Idle `prompt.submit` has no future turn ID, so queued classifications still require careful association. This is a design recommendation from the event contracts, not a tested queue implementation.

## Independent review inside a Mod

Separate the pure router from a stateful coordinator, even when both ship in one plugin. Register a fresh, non-fork reviewer with relevant tools and explicit operating limits. Spawn it with requirements, artifact revision, context manifest, and executed evidence. Track its ID, failure, completion, and timeout; match results to the revision reviewed.

`$.agent.spawn` resolves when the agent starts. Its answer arrives through the matching `turn.complete`; it is not the spawn return value. The native suite exercised those event fields with a simulated completion. It did not run a live reviewer or test spawn/completion races.

The [official model API guide](https://code.claude.com/docs/en/plugins/mods/api#call-a-model) offers `$.model.complete` for an isolated text request with explicit model/effort but no tools. `$.model.fork` includes the current conversation and uses the session model; it is unsuitable as the default for a reviewer intended to avoid the author's narrative. Tool-capable review should use a fresh agent or a separately integrated worker.

The [autonomous-loop demo](https://github.com/yai333/autonomous-loop/blob/5817fc9ddccbfd183b954dcfc6374e1d7c09f251/README.md) implements coding, checking, review, and approval inside a Mod. It records a 2.1.280 limitation involving hooks on its own agents and sets restrictions on registered types. Current local declarations describe skipping active spawning hook frames, with completion events available to the spawner. Treat the older blanket limitation as version-bound; test current re-entry behavior rather than relying on same-Mod interception for reviewer restrictions.

Cross-family review needs a compatible configured proxy path or an explicit external-provider worker. Selecting an OpenAI-looking ID through the same session credentials does not establish OpenAI transport, tool compatibility, or independent identity. This research ran no cross-family inference or quality evaluation.

## Fallback and operating limits

Claude Code has its own fallback behavior. The [community native-fallback probe](https://github.com/alexei-led/claude-router/blob/d8b6c60a4b417df12d189d8e6a500a80e4cadbd0/experiments/mod-router/results/native-fallback-acceptance.json) records a real 2.1.289 engine against a loopback API stub and observes fallback carried into continuation. It is not a live-provider test. V2 must reconcile or disable engine/proxy substitution paths; checking a later step does not prove that the first substitute request was authorized.

The [Mods reference](https://code.claude.com/docs/en/plugins/mods/reference#mods-api-methods) lists usage snapshots, shared storage, UI, and background APIs. Usage visibility exists at the harness level, but provider coverage and quota meaning remain local questions. A persistent key-value store is not by itself proof of an atomic cross-session budget reservation.

Keep orchestration waits out of arbitrary unresolved promises in blocking hooks. Hook budgets, re-entry, headless input limits, cancellation, and later Mods can affect enforcement. Use a bounded state machine and deliberate ordering. No hook can roll back a completed external tool action or observe a model substitution hidden by a proxy.

## Local probe results

The public [probe fixture](../../experiments/harness-contracts/README.md) is reproducible without credentials. On 2.1.316, validation passed with metadata warnings and all **10 native-host tests passed**:

1. Main model and effort rewrite.
2. Subagent-tagged effort rewrite.
3. Synthetic streamed response with zero downstream requests.
4. Prompt drop with zero downstream submissions.
5. Streaming guard `.catch` holds a failed request.
6. Prompt guard `.catch` fails closed.
7. Spawn denial with zero downstream spawns.
8. Model-switch source fields reach a Mod.
9. Reviewer completion carries agent ID and answer.
10. Reviewer registration carries effort and tool restrictions.

The two upstream fable-pin tests also passed. These are contract tests with stubs, not live main-turn/subagent traffic. The [official test guide](https://code.claude.com/docs/en/plugins/mods/test) explains that distinction. No model calls, usage-queue reads, settings changes, or third-party Mod installation were needed.

## Spec decisions and next checks

Adopt an in-process Mod adapter and optional review coordinator as the intended v2 implementation path. Preserve deterministic policy and explicit authorization. Use router-owned pins first, add verified native-model event mapping, and express subagent effort through supported definitions or request hooks.

Keep live validation focused on: native picker and effort origin across surfaces; queued prompts and resumes; actual effort payloads through the proxy; reviewer tool limits and re-entry; first-attempt fallback enforcement; cancellation and completion races; revision-bound acceptance; and observable resolved identities. Until those pass, label those paths unverified rather than treating the offline probes as end-to-end approval.

import {registerRouterControls, createRouterControls} from './router-controls.ts'
import catalogData from '../catalog/model-data.ts'
import {parseCatalog} from './model-catalog.ts'
import {recommendTask, DEFAULT_PREFERENCES} from './task-routing.ts'
/**
 * jev-model-router — Claude Mod
 *
 * Picks the model each task runs on with TypeSafe's Jev, a System One
 * decision model: unstructured state in, a typed choice with a probability
 * distribution out.
 *
 * Jev is reached one of two ways, whichever key is configured: TypeSafe's
 * own API (`typesafeApiKey`), which reports a calibrated confidence per
 * answer, or the Vercel AI Gateway (`gatewayApiKey`), which does not. With
 * neither, the engine's own `$.model.classify` stands in, so the mod is
 * useful without any account.
 *
 * Three things it can set, each on its own switch:
 *   agent.spawn  — the model of each subagent (on by default)
 *   turn.step    — the reasoning effort of the main loop (on by default)
 *   turn.step    — the model of the main loop (off by default: switching
 *                  models mid-session invalidates the prompt cache, which can
 *                  cost more than the cheaper tier saves)
 *
 * Every one of them moves in both directions: a task the decision model reads
 * as mechanical is routed down, one it reads as hard is routed up. The two
 * mistakes do not cost the same, so they do not clear the same confidence bar
 * (see `minUpgradeConfidence` / `minDowngradeConfidence` in policy.ts).
 *
 * The Agent tool has no effort parameter, so a subagent's effort is not ours
 * to set; only its model is.
 *
 * The prompt is classified at `prompt.submit`, which runs before the turn
 * starts, and the decision is applied at the turn's first request.
 *
 * Every failure path is fail-open: a classification that errors or runs past
 * the latency budget leaves the request exactly as the engine built it.
 *
 * The API key comes from the plugin's options (userConfig "typesafeApiKey"
 * or "gatewayApiKey"). Never hardcode it in this file.
 *
 * Needs Claude Code >= 2.1.287. Typed
 * against Anthropic's declarations: https://github.com/anthropics/claude-code/tree/main/mods
 *
 * Privacy: with a key set, the prompt text is sent to whichever backend the
 * key belongs to.
 */
import type { Register } from 'claude-code'
import {
  DEFAULT_BASE_URL,
  DEFAULT_MODEL,
  describeDecision,
  describeSetup,
  endpoint,
  pendingDecisions,
  readDecision,
  selectProvider,
  requestBody,
  requestHeaders,
  requestModelId,
  route,
  TIER_ORDER,
  bareCommand,
} from './policy.ts'
import type { Decision, Effort, PolicyConfig, Provider, Tier } from './policy.ts'

export const register: Register = (on, options) => {
  const text = (key: string, fallback: string) =>
    typeof options[key] === 'string' && options[key] ? (options[key] as string) : fallback
  const number = (key: string, fallback: number) =>
    typeof options[key] === 'number' ? (options[key] as number) : fallback
  const flag = (key: string, fallback: boolean) =>
    typeof options[key] === 'boolean' ? (options[key] as boolean) : fallback

  // TypeSafe's own API is preferred when both keys are set: it is the only
  // one that reports a calibrated confidence, which the policy's threshold
  // reads. `provider` forces one, including "builtin" to use neither.
  const typesafeKey = text('typesafeApiKey', '')
  const gatewayKey = text('gatewayApiKey', '')
  const forced = text('provider', 'auto')
  const active: Provider | null = selectProvider(forced, typesafeKey, gatewayKey)

  // Each backend keeps its own URL and model, so an override written for one
  // can never be sent to the other when `auto` picks differently than expected.
  const apiKey = active === 'typesafe' ? typesafeKey : active === 'gateway' ? gatewayKey : ''
  const modelId = !active
    ? ''
    : active === 'typesafe'
      ? text('typesafeModel', DEFAULT_MODEL.typesafe)
      : text('gatewayModel', DEFAULT_MODEL.gateway)
  const url = !active
    ? ''
    : active === 'typesafe'
      ? endpoint('typesafe', text('typesafeBaseUrl', DEFAULT_BASE_URL.typesafe))
      : endpoint('gateway', text('gatewayBaseUrl', DEFAULT_BASE_URL.gateway))

  // A backend named in the options but missing its key degrades to the
  // built-in classifier, which is silent; say so once, when a hook first runs.
  let unusableReported = forced === 'auto' || forced === 'builtin' || active !== null

  const taskMode = text('taskRoutingMode', 'observe')
  const taskEnabled = taskMode === 'observe' || taskMode === 'apply'
  const catalog = parseCatalog(catalogData)
  const taskThreshold = Math.min(1, Math.max(0, number('taskMinConfidence', 0.8)))
  const preferences = {
    orchestration: text('orchestrationModel', DEFAULT_PREFERENCES.orchestration),
    visualAnalysis: text('visualAnalysisModel', DEFAULT_PREFERENCES.visualAnalysis),
    designLed: text('designLedModel', DEFAULT_PREFERENCES.designLed),
    specified: text('specifiedModel', DEFAULT_PREFERENCES.specified),
    mechanical: text('mechanicalModel', DEFAULT_PREFERENCES.mechanical),
    fileScout: text('fileScoutModel', DEFAULT_PREFERENCES.fileScout),
  }
  const recommendation = (decision: Decision | null) => recommendTask(decision?.task ?? null, catalog, preferences, taskThreshold, (decision?.risky ?? 0) > 0.7)
  const timeoutMs = number('timeoutMs', 800)
  const routeSubagentModel = flag('routeSubagentModel', true)
  const routeMainEffort = flag('routeMainEffort', true)
  const routeMainModel = flag('routeMainModel', false)
  const controls = createRouterControls({mode: ['off','observe','apply'].includes(taskMode) ? taskMode as 'off'|'observe'|'apply' : 'observe', mainModel:routeMainModel, mainEffort:routeMainEffort, subagents:routeSubagentModel, classifyTurns:flag('classifyTurns', true)})
  registerRouterControls(on, controls)
  const logDecisions = flag('logDecisions', true)

  const policy: PolicyConfig = {
    tiers: {
      fast: text('fastModel', 'haiku'),
      balanced: text('balancedModel', 'sonnet'),
      deep: text('deepModel', 'opus'),
    },
    minUpgradeConfidence: number('minUpgradeConfidence', 0.3),
    minDowngradeConfidence: number('minDowngradeConfidence', 0.6),
  }

  // The classification waiting for the turn that reads its prompt, and what
  // the current turn settled on. Both are single slots: main-loop turns run
  // one at a time, so nothing accumulates over a long session. `pending`
  // reports no decision when two prompts are waiting at once, rather than
  // routing a turn on a decision made for a different prompt.
  const pending = pendingDecisions()
  // Said once, the first time a hook runs. A router that loaded and one that
  // never loaded are otherwise told apart only by the absence of later lines,
  // and absence is not evidence: the policy leaves most turns alone anyway.
  let announced = false
  let appliedTurnId: string | undefined
  let applied: { model?: string; effort?: Effort } | null = null

  on('prompt.submit', async ($, e, next) => {
    const runtime=controls.current()
    const taskMode=runtime.mode
    const taskEnabled=taskMode==='observe'||taskMode==='apply'
    const routeMainModel=runtime.mainModel, routeMainEffort=runtime.mainEffort, routeSubagentModel=runtime.subagents
    const routeMainLoop=routeMainModel||routeMainEffort

    // Before the routing guards: a module whose switches are all off has still
    // loaded, and that is exactly when its silence is most misleading.
    if (!announced) {
      announced = true
      if (logDecisions) {
        $.ui.log(
          `[jev-model-router] ${describeSetup(
            active,
            url,
            {
              subagentModel: routeSubagentModel,
              mainEffort: routeMainEffort,
              mainModel: routeMainModel,
            },
            forced === 'builtin',
          )}; mode ${taskMode === "off" ? "original" : taskMode}; main model ${routeMainModel ? "on" : "off"}; main effort ${routeMainEffort ? "on" : "off"}; subagents ${routeSubagentModel ? "on" : "off"}; per-turn logging ${runtime.classifyTurns ? "on" : "off"}`,
        )
      }
    }
    if (!routeMainLoop && !runtime.classifyTurns) return next(e)

    if (!unusableReported) {
      unusableReported = true
      $.ui.log(`[jev-model-router] provider "${forced}" has no key set; using the built-in classifier`)
    }

    // A slash command alone gives the decision model only the command's name.
    // Its turn keeps the session's model and effort; the null put keeps a
    // previous prompt's decision from reaching it.
    if (/^\/router(?:\s|$)/.test(e.text.trim()) || bareCommand(e.text)) {
      if (logDecisions) $.ui.log('[jev-model-router] a command with nothing after it; leaving the turn alone')
      pending.put(null)
      return next(e)
    }

    const startedAt = await $.clock.now()
    let decision: Decision | null = null
    if (active) {
      try {
        const response = await Promise.race([
          $.http.fetch(url, {
            method: 'POST',
            headers: requestHeaders(active, apiKey, modelId),
            body: requestBody(active, { prompt: e.text }, modelId, taskEnabled),
          }),
          $.clock.sleep(timeoutMs),
        ])
        if (response && response.ok) decision = readDecision(response.text)
        else if (response) $.ui.log(`[jev-model-router] ${active} responded ${response.status}`)
        else $.ui.log(`[jev-model-router] classification passed ${timeoutMs}ms; leaving the turn alone`)
      } catch (error) {
        $.ui.log(`[jev-model-router] classification failed: ${String(error)}`)
      }
    } else {
      // No backend: the engine's own small-model classifier answers the same
      // question, without the confidence the policy's threshold reads.
      try {
        const label = await $.model.classify(e.text, TIER_ORDER)
        if (label) {
          decision = {
            tier: label as Tier,
            confidence: null,
            risky: null,
            effort: null,
            effortConfidence: null,
          }
        }
      } catch (error) {
        $.ui.log(`[jev-model-router] built-in classifier failed: ${String(error)}`)
      }
    }

    // What the decision model actually answered, whatever the policy then
    // does with it. This is the line that proves the classification ran.
    if (logDecisions) {
      const ms = (await $.clock.now()) - startedAt
      $.ui.log(`[router] classification (recommendation only): ${describeDecision(decision, ms)}`)
    }

    pending.put(decision)
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const runtime=controls.current()
    const taskMode=runtime.mode
    const taskEnabled=taskMode==='observe'||taskMode==='apply'
    const routeMainModel=runtime.mainModel, routeMainEffort=runtime.mainEffort, routeSubagentModel=runtime.subagents
    const routeMainLoop=routeMainModel||routeMainEffort

    if (e.agentId || (!routeMainLoop && !runtime.classifyTurns)) return yield* next(e)

    // Every request after the first reuses what the turn settled on, so
    // neither the model nor the effort changes under its own tool loop.
    if (e.index > 0 && e.turnId === appliedTurnId) {
      return yield* next(applied ? { ...e, ...applied } : e)
    }

    const decision = pending.take()
    const routing = route(decision, { model: e.model, effort: e.effort }, policy)
    const task = recommendation(decision)
    if (taskEnabled && logDecisions) $.ui.log(`[router] task ${taskMode} recommendation: ${decision?.task?.role ?? 'unknown'}/${decision?.task?.implementationCategory ?? 'unknown'} → ${task.model ?? 'original tier policy'}${task.effort ? ` · effort ${task.effort}` : ''}; ${task.reason}`)
    if (taskMode === 'apply' && task.preferredModel && !task.model && (decision?.risky ?? 0) <= 0.7) {
      routing.model = null; routing.effort = null; routing.reason = task.reason
    }
    if (taskMode === 'apply' && task.model) {
      routing.model = task.model === e.model ? null : task.model
      // Keep the user's established effort for other roles; orchestration is medium.
      routing.effort = task.effort
      routing.reason = task.reason
    }
    const change: { model?: string; effort?: Effort } = {}
    // The main loop's `model` is sent to the API as written, so an alias
    // becomes its id here; a subagent's (agent.spawn) may stay an alias.
    if (routeMainModel && routing.model) change.model = requestModelId(routing.model)
    if (routeMainEffort && routing.effort) change.effort = routing.effort

    appliedTurnId = e.turnId
    applied = Object.keys(change).length > 0 ? change : null
    // A row in the transcript scrolls away; this line stays on screen.
    if (logDecisions) $.ui.status(`Router ${taskMode === 'off' ? 'original' : taskMode} · ${change.model ?? e.model} · effort ${change.effort ?? e.effort ?? 'harness default'}`)

    if (!applied) {
      // A turn left alone is the common case, and it used to be silent, which
      // made a working mod look like one that never loaded. Say what happened.
      if (logDecisions) {
        $.ui.log(`[router] main unchanged: ${e.model} · effort ${e.effort ?? 'harness default'}; model routing ${routeMainModel ? 'on' : 'off'}, effort routing ${routeMainEffort ? 'on' : 'off'}${routeMainLoop ? `; ${routing.reason}` : '; recommendations only for this turn'}`)
      }
      return yield* next(e)
    }
    if (logDecisions) {
      const what = [change.model, change.effort && `effort ${change.effort}`]
        .filter(Boolean)
        .join(', ')
      $.ui.log(`[router] main applied: ${what}; effective ${change.model ?? e.model} · effort ${change.effort ?? e.effort ?? 'harness default'}; ${routing.reason}`)
    }
    return yield* next({ ...e, ...change })
  })

  on('agent.spawn', async ($, e, next) => {
    const runtime=controls.current()
    const taskMode=runtime.mode
    const taskEnabled=taskMode==='observe'||taskMode==='apply'
    const routeMainModel=runtime.mainModel, routeMainEffort=runtime.mainEffort, routeSubagentModel=runtime.subagents
    const routeMainLoop=routeMainModel||routeMainEffort

    // Before the routing guards: a module whose switches are all off has still
    // loaded, and that is exactly when its silence is most misleading.
    if (!announced) {
      announced = true
      if (logDecisions) {
        $.ui.log(
          `[jev-model-router] ${describeSetup(
            active,
            url,
            {
              subagentModel: routeSubagentModel,
              mainEffort: routeMainEffort,
              mainModel: routeMainModel,
            },
            forced === 'builtin',
          )}`,
        )
      }
    }

    // A fork inherits its parent's model; `model` is ignored for it.
    if (!routeSubagentModel || e.fork) return next(e)

    if (!unusableReported) {
      unusableReported = true
      $.ui.log(`[jev-model-router] provider "${forced}" has no key set; using the built-in classifier`)
    }

    const startedAt = await $.clock.now()
    let decision: Decision | null = null
    if (active) {
      try {
        const response = await Promise.race([
          $.http.fetch(url, {
            method: 'POST',
            headers: requestHeaders(active, apiKey, modelId),
            body: requestBody(
              active,
              { prompt: e.prompt, description: e.description, agentType: e.subagentType },
              modelId,
              taskEnabled,
            ),
          }),
          $.clock.sleep(timeoutMs),
        ])
        if (response && response.ok) decision = readDecision(response.text)
        else if (response) $.ui.log(`[jev-model-router] ${active} responded ${response.status}`)
        else $.ui.log(`[jev-model-router] classification passed ${timeoutMs}ms; leaving the subagent alone`)
      } catch (error) {
        $.ui.log(`[jev-model-router] classification failed: ${String(error)}`)
      }
    } else {
      try {
        const label = await $.model.classify(e.prompt, TIER_ORDER)
        if (label) {
          decision = {
            tier: label as Tier,
            confidence: null,
            risky: null,
            effort: null,
            effortConfidence: null,
          }
        }
      } catch (error) {
        $.ui.log(`[jev-model-router] built-in classifier failed: ${String(error)}`)
      }
    }

    if (logDecisions) {
      const ms = (await $.clock.now()) - startedAt
      $.ui.log(`[jev-model-router] jev (${e.subagentType}): ${describeDecision(decision, ms)}`)
    }

    // The subagent's own model wins when the caller named one; otherwise it
    // would inherit the parent's, so that is what a change is measured from.
    // The Agent tool takes no effort, so only the model is ours to set here.
    const current = e.model ?? e.parentModel
    const routing = route(decision, { model: current }, policy)
    const task = recommendation(decision)
    if (taskEnabled && logDecisions) $.ui.log(`[router] task ${taskMode} recommendation: ${decision?.task?.role ?? 'unknown'}/${decision?.task?.implementationCategory ?? 'unknown'} → ${task.model ?? 'original tier policy'}${task.effort ? ` · effort ${task.effort}` : ''}; ${task.reason}`)
    // agent.spawn has no effort control: do not claim medium orchestration here.
    if (taskMode === 'apply' && task.preferredModel && (!task.model || task.effort) && (decision?.risky ?? 0) <= 0.7) {
      routing.model = null; routing.reason = task.effort ? 'agent.spawn cannot enforce orchestration effort; retain current model' : task.reason
    }
    if (taskMode === 'apply' && task.model && !task.effort) {
      routing.model = task.model === current ? null : task.model
      routing.reason = task.reason
    }
    const {model, reason} = routing
    if (!model) {
      if (logDecisions) $.ui.log(`[jev-model-router] ${e.subagentType}: ${reason}`)
      return next(e)
    }
    if (logDecisions) $.ui.log(`[jev-model-router] ${e.subagentType} → ${model}: ${reason}`)
    return next({ ...e, model })
  })
}

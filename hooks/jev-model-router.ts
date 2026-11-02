import {registerRouterControls, createRouterControls, normalizeRouterMode} from './router-controls.ts'
import catalogData from '../catalog/model-data.ts'
import {parseCatalog,parseCatalogV2} from './model-catalog.ts'
import {configuredPolicy,runtimeCatalog} from './v2/policy-data.ts'
import {createHarness,captureLegacyClassifier,boundEngine,nativeIntake,nativeTurnStart,nativeStepPlan,nativeV2Step,nativePrepareSpawn,nativeSpawnStarted,nativeTurnComplete,nativeToolGuard,recordLegacyRequest} from './v2/harness.ts'
import type {HarnessAdapters} from './v2/harness.ts'
import {workflowComplete,workflowTurnStart,workflowSpawnGuard,workflowToolGuard} from './v2/review-harness.ts'
import {recommendTask, DEFAULT_PREFERENCES, taskLabel} from './task-routing.ts'
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
 * Legacy agent.spawn changes only model; the narrow spawn API has no effort
 * field. V2 uses qualified step/registered-definition effort paths separately.
 *
 * The prompt is classified at `prompt.submit`, which runs before the turn
 * starts, and the decision is applied at the turn's first request.
 *
 * Legacy failures are fail-open; enforced v2 failures hold before dispatch.
 * A legacy classification that errors or runs past
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

export const register: Register = (on, options) => registerWithAdapters(on,options)
/** Explicit typed I/O boundary for trusted embedding and isolated native tests, never a prompt/JSON switch. */
export function registerWithAdapters(on:Parameters<Register>[0],options:Parameters<Register>[1],adapters?:HarnessAdapters) {
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

  const taskMode = normalizeRouterMode(text('taskRoutingMode', 'observe'))
  const taskEnabled = taskMode === 'observe' || taskMode === 'custom'
  const catalog = parseCatalog(catalogData)
  const taskThreshold = Math.min(1, Math.max(0, number('taskMinConfidence', 0.8)))
  const preferences = {
    orchestration: text('orchestrationModel', DEFAULT_PREFERENCES.orchestration),
    visualAnalysis: text('visualAnalysisModel', DEFAULT_PREFERENCES.visualAnalysis),
    designLed: text('designLedModel', DEFAULT_PREFERENCES.designLed),
    specified: text('specifiedModel', DEFAULT_PREFERENCES.specified),
    mechanical: text('mechanicalModel', DEFAULT_PREFERENCES.mechanical),
    simpleAnswer: text('simpleAnswerModel', DEFAULT_PREFERENCES.simpleAnswer),
    fileScout: text('fileScoutModel', DEFAULT_PREFERENCES.fileScout),
  }
  const recommendation = (decision: Decision | null) => recommendTask(decision?.task ?? null, catalog, preferences, taskThreshold, (decision?.risky ?? 0) > 0.7)
  const timeoutMs = number('timeoutMs', 800)
  const routeSubagentModel = flag('routeSubagentModel', true)
  const routeMainEffort = flag('routeMainEffort', true)
  const routeMainModel = flag('routeMainModel', false)
  const controls = createRouterControls({enabled:flag('enabled',true),mode:taskMode, mainModel:routeMainModel, mainEffort:routeMainEffort, subagents:routeSubagentModel, classifyTurns:flag('classifyTurns', true)}, options)
  registerRouterControls(on, controls)
  const v2Catalog=adapters?.catalog??runtimeCatalog(parseCatalogV2(catalogData))
  const harness=createHarness(controls,{catalog:v2Catalog,policy:adapters?.policy??configuredPolicy(options,v2Catalog),legacyCatalog:catalog,
    classifier:{provider:active,url,model:modelId,apiKey,deadlineMs:Number.isSafeInteger(timeoutMs)&&timeoutMs>0?Math.min(timeoutMs,600000):800},
    pluginVersion:null,sourceRevision:null,logDecisions:flag('logDecisions',true),adapters})
  controls.runtime=harness
  adapters?.onRuntimeReady?.(harness)
  on('turn.start',async($,e,next)=>{
    if(!controls.state.enabled)return next(e)
    const activation=controls.activation
    try {
      const owned=await workflowTurnStart($,harness,e)
      if(controls.state.enabled&&activation===controls.activation&&!owned)await nativeTurnStart($,harness,controls,e)
    }catch(error){if(controls.state.enabled)$.ui.log(`[router] Turn association failed: ${error instanceof Error?error.message:'unknown association error'}`,{to:'debug'})}
    return next(e)
  }).catch(($,e)=>({turnId:e.turnId}))
  on('turn.complete',async($,e,next)=>{
    if(!controls.state.enabled)return next(e)
    const activation=controls.activation
    try {
      const owned=await workflowComplete($,harness,e)
      if(controls.state.enabled&&activation===controls.activation&&!owned)await nativeTurnComplete($,harness,controls,e)
    }catch{if(controls.state.enabled)$.ui.log('[router] Completion metadata unavailable; no review/acceptance is inferred.',{to:'debug'})}
    return next(e)
  })
  on('tool.call',async($,e,next)=>{
    if(!controls.state.enabled)return next(e)
    const activation=controls.activation
    let deny=next.origin.plugin&&next.origin.plugin!=='engine'?null:await workflowToolGuard($,harness,e)
    if(!controls.state.enabled||activation!==controls.activation)return next(e)
    deny??=await nativeToolGuard($,harness,e,next.origin.plugin)
    if(!controls.state.enabled||activation!==controls.activation)return next(e)
    return deny?{deny}:next(e)
  }).catch(($,e,next)=>next.called||!controls.state.enabled||(!e.agentId||!Object.values(harness.workflow?.jobs??{}).some(j=>!j.completion&&(!j.agentId||j.agentId===e.agentId)))&&boundEngine(harness)!=='v2'?next(e):{deny:'unavailable: tool allowance could not be established.'})
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
  let appliedActivation = controls.activation
  let appliedTurnId: string | undefined
  let applied: { model?: string; effort?: Effort } | null = null

  const syncActivation=()=>{
    if(appliedActivation!==controls.activation){pending.put(null);applied=null;appliedTurnId=undefined;appliedActivation=controls.activation}
  }

  on('prompt.submit', async ($, e, next) => {
    if(!controls.state.enabled)return next(e)
    const activation=controls.activation
    syncActivation()
    const held=await nativeIntake($,harness,e)
    if(!controls.state.enabled||activation!==controls.activation)return next(e)
    if(held)return {drop:held}
    if(boundEngine(harness)==='v2'){pending.put(null);return next(e)}
    let legacyUsage:unknown=null
    const runtime=controls.current()
    const taskMode=runtime.mode
    const taskEnabled=taskMode==='observe'||taskMode==='custom'
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
          )}; mode ${taskMode}; main model ${routeMainModel ? "on" : "off"}; main effort ${routeMainEffort ? "on" : "off"}; subagents ${routeSubagentModel ? "on" : "off"}; per-turn logging ${runtime.classifyTurns ? "on" : "off"}`, {to:'debug'},
        )
      }
    }
    if (!routeMainLoop && !runtime.classifyTurns) return next(e)

    if (!unusableReported) {
      unusableReported = true
      $.ui.log(`[jev-model-router] provider "${forced}" has no key set; using the built-in classifier`,{to:'debug'})
    }

    // A slash command alone gives the decision model only the command's name.
    // Its turn keeps the session's model and effort; the null put keeps a
    // previous prompt's decision from reaching it.
    if (/^\/router(?:\s|$)/.test(e.text.trim()) || bareCommand(e.text)) {
      if (logDecisions) $.ui.log('[jev-model-router] a command with nothing after it; leaving the turn alone',{to:'debug'})
      pending.put(null)
      return next(e)
    }

    const startedAt = await $.clock.now()
    if(!controls.state.enabled||activation!==controls.activation)return next(e)
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
        if (response && response.ok) {decision = readDecision(response.text);try{legacyUsage=JSON.parse(response.text).usage}catch{}}
        else if (response&&controls.state.enabled&&activation===controls.activation) $.ui.log(`[jev-model-router] ${active} responded ${response.status}`,{to:'debug'})
        else if(controls.state.enabled&&activation===controls.activation) $.ui.log(`[jev-model-router] classification passed ${timeoutMs}ms; leaving the turn alone`,{to:'debug'})
      } catch (error) {
        if(controls.state.enabled&&activation===controls.activation)$.ui.log(`[jev-model-router] classification failed: ${String(error)}`,{to:'debug'})
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
        if(controls.state.enabled&&activation===controls.activation)$.ui.log(`[jev-model-router] built-in classifier failed: ${String(error)}`,{to:'debug'})
      }
    }

    // What the decision model actually answered, whatever the policy then
    // does with it. This is the line that proves the classification ran.
    const elapsed=(await $.clock.now())-startedAt
    if(!controls.state.enabled||activation!==controls.activation)return next(e)
    if (logDecisions) $.ui.log(`[router] classification (recommendation only): ${describeDecision(decision, elapsed)}`,{to:'debug'})

    captureLegacyClassifier(harness,e.text,elapsed,legacyUsage)
    pending.put(decision)
    return next(e)
  }).catch(($,e,next)=>next.called||!controls.state.enabled||(boundEngine(harness)!=='v2'&&!controls.engineError)?next(e):{drop:'unavailable: unsupported policy engine; request held after guard error.'})

  on('turn.step', async function* ($, e, next) {
    if(!controls.state.enabled)return yield* next(e)
    const activation=controls.activation
    syncActivation()
    const plan=await nativeStepPlan($,harness,controls,e)
    if(!controls.state.enabled||activation!==controls.activation)return yield* next(e)
    if(plan.owned){
      if(plan.message||!plan.assignment){
        const text=plan.message??'unavailable: assignment association missing.'
        yield {kind:'text',index:0,text};yield {kind:'stop',stopReason:'end_turn',usage:null}
        return {turnId:e.turnId,index:e.index,answer:text,toolUses:[],stopReason:'end_turn',usage:null}
      }
      return yield* nativeV2Step($,harness,e,plan.assignment,next)
    }
    const runtime=controls.current()
    const taskMode=runtime.mode
    const taskEnabled=taskMode==='observe'||taskMode==='custom'
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
    if (taskEnabled && logDecisions) $.ui.log(`[router] task ${taskMode} recommendation: ${decision?.task?.role ?? 'unknown'}/${decision?.task?.implementationCategory ?? 'unknown'} → ${task.model ?? 'original tier policy'}${task.effort ? ` · effort ${task.effort}` : ''}; ${task.reason}`,{to:'debug'})
    if (taskMode === 'custom' && task.preferredModel && !task.model && (decision?.risky ?? 0) <= 0.7) {
      routing.model = null; routing.effort = null; routing.reason = task.reason
    }
    if (taskMode === 'custom' && task.model) {
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

    controls.lastApplied={engine:'legacy',assignmentId:e.turnId,model:change.model??e.model,effort:change.effort??e.effort??null}
    appliedTurnId = e.turnId
    applied = Object.keys(change).length > 0 ? change : null
    // A row in the transcript scrolls away; this line stays on screen.
    if (logDecisions) $.ui.status(`Router ${taskMode} · ${change.model ?? e.model} · effort ${change.effort ?? e.effort ?? 'harness default'}`)

    if (logDecisions) {
      const source = taskMode === 'custom' && task.model && (change.model || change.effort)
        ? 'custom' : taskMode === 'custom' && !task.preferredModel && applied ? 'basic fallback' : taskMode
      $.ui.log(`[router] ${taskLabel(decision?.task)} · ${change.model ?? e.model} · effort ${change.effort ?? e.effort ?? 'harness default'} · ${source}${applied ? '' : ' · unchanged'}`)
    }
    await recordLegacyRequest($,harness,e,change.model??e.model,change.effort??e.effort,taskMode)
    if(!controls.state.enabled||activation!==controls.activation)return yield* next(e)
    return yield* next({ ...e, ...change })
  }).catch(async function* ($,e,next) {
    if(next.called||!controls.state.enabled||(boundEngine(harness,e.turnId)!=='v2'&&!controls.engineError))return yield* next(e)
    const text='unavailable: unsupported policy engine; request held after guard error.'
    yield {kind:'text',index:0,text}
    yield {kind:'stop',stopReason:'end_turn',usage:null}
    return {turnId:e.turnId,index:e.index,answer:text,toolUses:[],stopReason:'end_turn',usage:null}
  })

  on('agent.spawn', async ($, e, next) => {
    if(!controls.state.enabled)return next(e)
    const activation=controls.activation
    const workflowGate=workflowSpawnGuard(harness,e,next.origin.plugin)
    if(workflowGate==='deny')return {deny:'unavailable: coordinator-only type cannot be reused or altered.'}
    if(workflowGate==='owned')return next(e)
    const spawnPlan=await nativePrepareSpawn($,harness,controls,e)
    if(!controls.state.enabled||activation!==controls.activation)return next(e)
    if(spawnPlan.deny)return {deny:spawnPlan.deny}
    if(spawnPlan.owned){
      const result=await next(spawnPlan.model?{...e,model:spawnPlan.model}:e)
      await nativeSpawnStarted($,harness,e,result)
      return result
    }
    const forward=async(input:typeof e)=>{const result=await next(input);try{await nativeSpawnStarted($,harness,e,result)}catch{}return result}
    const runtime=controls.current()
    const taskMode=runtime.mode
    const taskEnabled=taskMode==='observe'||taskMode==='custom'
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
          )}`, {to:'debug'},
        )
      }
    }

    // A fork inherits its parent's model; `model` is ignored for it.
    if (!routeSubagentModel || e.fork) return forward(e)

    if (!unusableReported) {
      unusableReported = true
      $.ui.log(`[jev-model-router] provider "${forced}" has no key set; using the built-in classifier`,{to:'debug'})
    }

    const startedAt = await $.clock.now()
    if(!controls.state.enabled||activation!==controls.activation)return next(e)
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
        else if (response&&controls.state.enabled&&activation===controls.activation) $.ui.log(`[jev-model-router] ${active} responded ${response.status}`,{to:'debug'})
        else if(controls.state.enabled&&activation===controls.activation) $.ui.log(`[jev-model-router] classification passed ${timeoutMs}ms; leaving the subagent alone`,{to:'debug'})
      } catch (error) {
        if(controls.state.enabled&&activation===controls.activation)$.ui.log(`[jev-model-router] classification failed: ${String(error)}`,{to:'debug'})
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
        if(controls.state.enabled&&activation===controls.activation)$.ui.log(`[jev-model-router] built-in classifier failed: ${String(error)}`,{to:'debug'})
      }
    }

    if(!controls.state.enabled||activation!==controls.activation)return next(e)
    if (logDecisions) {
      const ms = (await $.clock.now()) - startedAt
      if(!controls.state.enabled||activation!==controls.activation)return next(e)
      $.ui.log(`[jev-model-router] jev (${e.subagentType}): ${describeDecision(decision, ms)}`,{to:'debug'})
    }

    // The subagent's own model wins when the caller named one; otherwise it
    // would inherit the parent's, so that is what a change is measured from.
    // The Agent tool takes no effort, so only the model is ours to set here.
    const current = e.model ?? e.parentModel
    const routing = route(decision, { model: current }, policy)
    const task = recommendation(decision)
    if (taskEnabled && logDecisions) $.ui.log(`[router] task ${taskMode} recommendation: ${decision?.task?.role ?? 'unknown'}/${decision?.task?.implementationCategory ?? 'unknown'} → ${task.model ?? 'original tier policy'}${task.effort ? ` · effort ${task.effort}` : ''}; ${task.reason}`,{to:'debug'})
    // agent.spawn has no effort control: do not claim medium orchestration here.
    if (taskMode === 'custom' && task.preferredModel && (!task.model || task.effort) && (decision?.risky ?? 0) <= 0.7) {
      routing.model = null; routing.reason = task.effort ? 'agent.spawn cannot enforce orchestration effort; retain current model' : task.reason
    }
    if (taskMode === 'custom' && task.model && !task.effort) {
      routing.model = task.model === current ? null : task.model
      routing.reason = task.reason
    }
    const {model, reason} = routing
    if (!model) {
      if (logDecisions) $.ui.log(`[router] ${e.subagentType}: ${taskLabel(decision?.task)} · ${current} · unchanged`)
      return forward(e)
    }
    if (logDecisions) $.ui.log(`[router] ${e.subagentType}: ${taskLabel(decision?.task)} · ${model} · ${taskMode === 'custom' && task.model ? 'custom' : 'basic'}`)
    return forward({ ...e, model })
  }).catch(($,e,next)=>next.called||!controls.state.enabled||(boundEngine(harness)!=='v2'&&!controls.engineError)?next(e):{deny:'unavailable: unsupported policy engine; spawn held after guard error.'})
}

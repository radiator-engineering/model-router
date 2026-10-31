/**
 * Pure v2 selection (decision contract v3). One immutable snapshot in, one
 * decision out. No `$`, no I/O, no clock: time comes from `snapshot.now`.
 */
import {validateCatalog} from '../model-catalog.ts'
import type {CatalogV2, Configuration, WorkloadApproval} from '../model-catalog.ts'
import {CONTRACT_VERSION, DIMENSIONS, DIMENSION_KEYS, PIN_SCOPES, TASK_ROLES, canonicalEffort, confident, effortTokenOf, fingerprint, isId, isObject, validateSnapshot} from './contract.ts'
import type {CandidateCheck, CheckName, Dimension, EffortToken, Pin, PolicyDecision, PolicySnapshot, ReasonCode, ReviewDisposition, TaskRole} from './contract.ts'
import type {PolicyData, WorkloadRule} from './policy-data.ts'

type Candidate = {id: string | null; model: string | null; effort: EffortToken}
type Mode = {automatic: boolean; experimental: boolean; ruleId: string | null}
const CHECK_ORDER: CheckName[] = ['identity', 'resources', 'availability', 'compatibility', 'capability', 'effort', 'workload', 'context', 'independence']
/** Known failures that block even an unchanged inherited request. */
const HARD: ReasonCode[] = ['model_disabled', 'model_unavailable', 'capability_missing', 'budget_denied', 'accounting_unknown']

/** Policy diagnostics, including same-priority conflicts and approval rule references. */
export function validatePolicy(input: unknown, catalog: CatalogV2): string[] {
  if (!isObject(input)) return ['policy must be an object']
  const e: string[] = []
  const need = (ok: boolean, msg: string) => { if (!ok) e.push(msg) }
  const ids = (v: unknown): v is string[] => Array.isArray(v) && v.every(isId) && new Set(v).size === v.length
  const whenOk = (w: unknown) => isObject(w) && Object.entries(w).every(([k, v]) =>
    DIMENSION_KEYS.includes(k as Dimension) && ids(v) && v.length > 0 && v.every(x => x !== 'unknown' && (DIMENSIONS[k as Dimension] as readonly string[]).includes(x)))
  need(isId(input.policyRevision), 'policyRevision is required')
  need(input.contractVersion === CONTRACT_VERSION, `contractVersion must be ${CONTRACT_VERSION}`)
  need(typeof input.confidenceThreshold === 'number' && input.confidenceThreshold > 0 && input.confidenceThreshold <= 1, 'confidenceThreshold must be in (0,1]')
  need(ids(input.providerPreference), 'providerPreference must list unique providers')
  need(isObject(input.clarifyWhen) && whenOk(input.clarifyWhen) && 'specification' in input.clarifyWhen, 'clarifyWhen is invalid')
  if (!Array.isArray(input.reviewTriggers)) e.push('reviewTriggers must be an array')
  else for (const t of input.reviewTriggers) need(isObject(t) && isId(t.id) && whenOk(t.when), 'review trigger is invalid')
  const m = input.manualLimits
  need(isObject(m) && (m.contextMarginFraction === null || (typeof m.contextMarginFraction === 'number' && m.contextMarginFraction >= 0 && m.contextMarginFraction < 1)) &&
    (m.outputReserveTokens === null || (Number.isSafeInteger(m.outputReserveTokens) && Number(m.outputReserveTokens) > 0)), 'manualLimits are invalid')
  if (!Array.isArray(input.rules)) return [...e, 'rules must be an array']
  const configIds = new Set(catalog.configurations.map(c => c.id))
  const ruleIds = new Set<string>()
  for (const r of input.rules) {
    if (!isObject(r)) { e.push('rule must be an object'); continue }
    need(isId(r.id) && !ruleIds.has(r.id), `rule ${r.id} must have a unique ID`)
    if (isId(r.id)) ruleIds.add(r.id)
    need(Number.isSafeInteger(r.priority), `rule ${r.id} priority must be an integer`)
    need(r.purpose === 'execution' || r.purpose === 'review', `rule ${r.id} purpose is invalid`)
    need(ids(r.roles) && r.roles.length > 0 && r.roles.every(x => (TASK_ROLES as readonly string[]).includes(x)), `rule ${r.id} roles are invalid`)
    need(whenOk(r.when), `rule ${r.id} observation conditions are invalid`)
    need(ids(r.primary) && r.primary.length > 0, `rule ${r.id} needs unique primary configurations`)
    if (Array.isArray(r.primary)) for (const id of r.primary) need(configIds.has(id), `rule ${r.id} primary ${id} is not in the catalog`)
    need(r.preference === null || (Array.isArray(r.primary) && r.primary.includes(r.preference)), `rule ${r.id} preference must be one of its primary configurations`)
  }
  // Only compare well-formed rules. Disjoint conditions are not conflicts.
  if (!e.length) {
    const rules = input.rules as unknown as WorkloadRule[]
    rules.forEach((a, i) => rules.slice(i + 1).forEach(b => {
      const overlap = DIMENSION_KEYS.every(k => !a.when[k] || !b.when[k] || a.when[k]!.some(v => b.when[k]!.includes(v)))
      if (a.priority === b.priority && a.purpose === b.purpose && a.roles.some(x => b.roles.includes(x)) && overlap)
        e.push(`rules ${a.id} and ${b.id} conflict at priority ${a.priority}`)
    }))
  }
  for (const a of catalog.approvals) for (const id of a.policyRuleIds) need(ruleIds.has(id), `approval ${a.id} names unknown rule ${id}`)
  return e
}

const at = (t: string) => Date.parse(t)

/** Run every eligibility check on one complete model/effort pair. */
function evaluate(c: Candidate, role: CandidateCheck['role'], mode: Mode, s: PolicySnapshot, policy: PolicyData, catalog: CatalogV2, taskRole: TaskRole | null): CandidateCheck & {experimental: boolean} {
  const failed: CandidateCheck['failed'] = []
  const fail = (check: CheckName, reason: ReasonCode, detail: string) => failed.push({check, reason, detail})
  const now = at(s.now)
  const model = catalog.models.find(m => m.id === c.model)
  const cfg = catalog.configurations.find(x => x.id === c.id)
  const env = catalog.environments.find(x => x.id === s.environment.id)
  const envMatches = !!env && env.harnessVersion === s.environment.harnessVersion && env.proxyVersion === s.environment.proxyVersion && env.requestPath === s.environment.requestPath
  const approvals = catalog.approvals.filter(a => a.configurationId === c.id && a.environmentId === env?.id && a.role === taskRole)
  // Identity and enablement
  if (!model) fail('identity', 'compatibility_unknown', 'model is not in the catalog')
  else if (!model.enabled) fail('identity', 'model_disabled', 'model is disabled')
  else if (approvals.some(a => a.state !== 'approved')) fail('identity', 'model_disabled', 'configuration is restricted or retired for this role')
  // Resources and hard provider restrictions
  if (model && s.resources.restrictedProviders.includes(model.provider)) fail('resources', 'budget_denied', `provider ${model.provider} is restricted`)
  const budget = s.resources.hardBudget
  if (budget?.accounting === 'unavailable') fail('resources', 'accounting_unknown', 'hard budget has no reliable accounting')
  else if (budget && !budget.permits) fail('resources', 'budget_denied', 'hard budget denies the attempt')
  // Availability: the latest timed observation must be fresh; a contradicting tie fails.
  if (c.model !== null && s.resources.exhaustedModels.includes(c.model)) fail('availability', 'model_unavailable', 'confirmed exhaustion')
  else {
    const timed = catalog.availability.filter(a => a.modelId === c.model && a.observedAt !== null && at(a.observedAt) <= now)
    const latestAt = Math.max(...timed.map(a => at(a.observedAt!)))
    const latest = timed.filter(a => at(a.observedAt!) === latestAt)
    const ok = mode.automatic ? ['verified'] : ['verified', 'advertised']
    if (latest.some(a => a.status === 'unavailable')) fail('availability', 'model_unavailable', 'latest observation reports unavailable')
    else if (!latest.length || !latest.every(a => ok.includes(a.status) && a.validUntil !== null && now < at(a.validUntil)))
      fail('availability', 'availability_unknown', latest.length ? 'latest observation is insufficient or expired' : 'no timed availability observation')
  }
  let experimental = false
  let approval: WorkloadApproval | undefined
  const result = (ran: CheckName[]) => {
    const failedChecks = new Set(failed.map(f => f.check))
    const applicable = ran.filter(x => x !== 'independence' || (s.assignment.purpose === 'review' && s.requirements.distinctFamily))
    return {configurationId: c.id, model: c.model, effort: canonicalEffort(c.effort), role,
      approvalId: approval?.id ?? null, limits: approval ? {...approval.limits} : null,
      passed: applicable.filter(x => !failedChecks.has(x) && !(experimental && x === 'workload')), failed, experimental}
  }
  // A pair absent from the catalog has no evidence to check further.
  if (!cfg) {
    fail('effort', 'effort_unsupported', c.effort.kind === 'unknown' ? 'effort is unknown' : 'no catalog configuration for this pair')
    // The early return must not skip the independent-review gate below.
    if (s.assignment.purpose === 'review' && s.requirements.distinctFamily)
      fail('independence', 'independence_unverified', 'no qualified reviewer configuration establishes independence')
    return result(['identity', 'resources', 'availability'])
  }
  // Compatibility observations have no supersession field. Conflicting records
  // for an exact environment/path fail closed, never depend on array order.
  const compatible = envMatches && cfg.requestPath === env!.requestPath
    ? catalog.compatibility.filter(x => x.configurationId === cfg.id && x.environmentId === env!.id) : []
  const scopedEvidence = (ids: string[]) => ids.some(id => {
    const e = catalog.evidence.find(e => e.id === id)
    return e && e.source !== 'legacy-import' && e.environmentId === env?.id && e.observedAt !== null && at(e.observedAt) <= now
  })
  const verified = compatible.length > 0 && scopedEvidence(env!.evidenceIds) && compatible.every(x => x.status === 'verified' && scopedEvidence(x.evidenceIds))
  if (compatible.some(x => x.status === 'incompatible')) fail('compatibility', 'capability_missing', 'configuration is incompatible')
  else if (!verified) fail('compatibility', 'compatibility_unknown', envMatches ? 'no evidenced verified compatibility for this configuration and path' : 'environment is not a recorded match')
  // Tools, modality and required request behavior.
  const features = [[s.requirements.tools, 'toolCalling'], [s.requirements.imageInput, 'imageInput'],
    [s.requirements.streaming, 'streaming'], [s.requirements.continuation, 'continuation'], [s.requirements.interruptions, 'interruptions']] as const
  for (const [need, feature] of features) {
    if (!need) continue
    if (compatible.some(x => x[feature] === false)) fail('capability', 'capability_missing', `${feature} unsupported`)
    else if (!compatible.length || !compatible.every(x => x[feature] === true)) fail('capability', 'compatibility_unknown', `${feature} unknown`)
  }
  // Effort: exact token supported and effectively forwarded on this path.
  if (c.effort.kind === 'unknown') fail('effort', 'effort_unsupported', 'effort is unknown')
  else if (!compatible.length || !compatible.every(x => x.supportedEfforts.some(t => canonicalEffort(t) === canonicalEffort(c.effort)) && x.effectiveEffortVerified === true))
    fail('effort', 'effort_unsupported', 'effort support or effective forwarding is unverified')
  // Workload approval (automatic) or explicit experimental use (manual)
  approval = approvals.find(a => a.state === 'approved' && at(a.checkedAt) <= now && now < at(a.validUntil) && scopedEvidence(a.evidenceIds) && (mode.ruleId === null || a.policyRuleIds.includes(mode.ruleId)))
  if (role === 'primary' && mode.automatic && mode.ruleId !== null && !policy.rules.find(r => r.id === mode.ruleId)!.primary.includes(c.id!))
    fail('workload', 'workload_unapproved', 'the resulting fixed-field pair is not a permitted primary configuration')
  if (!approval) {
    if (!mode.automatic && mode.experimental) experimental = true
    else fail('workload', 'workload_unapproved', mode.ruleId ? `no current approval for rule ${mode.ruleId}` : 'no current approval for this role')
  }
  // Context fit: conservative estimate within the verified window, margin and reserve
  const limits = approval ? approval.limits : mode.automatic ? null : policy.manualLimits
  const window = compatible.length > 0 && compatible.every(x => x.contextWindowTokens !== null)
    ? Math.min(...compatible.map(x => x.contextWindowTokens!)) : null
  const input = s.requirements.inputTokens
  if (input !== null && window !== null && input >= window)
    fail('context', 'capability_missing', 'input alone exhausts the verified context window')
  else if (input === null || window === null || !limits || limits.contextMarginFraction === null || limits.outputReserveTokens === null)
    fail('context', 'context_fit_unknown', 'input estimate, verified window or margin/reserve is unknown')
  else if (input + limits.outputReserveTokens > Math.floor(window * (1 - limits.contextMarginFraction)) || (approval && input > approval.limits.maxInputTokens))
    fail('context', 'capability_missing', 'estimated input does not fit')
  // Independent review
  if (s.assignment.purpose === 'review' && s.requirements.distinctFamily) {
    const family = model?.family ?? null
    if (family === null || s.assignment.authorFamily === null) fail('independence', 'independence_unverified', 'reviewer or author family is unknown')
    else if (family === s.assignment.authorFamily) fail('independence', 'independence_unverified', 'reviewer shares the author family')
  }
  return result(CHECK_ORDER)
}

/** The catalog configuration for a pair, preferring the snapshot's request path. */
function lookup(catalog: CatalogV2, model: string | null, effort: EffortToken, path: string | null): Candidate {
  const matches = catalog.configurations.filter(c => c.modelId === model && canonicalEffort(c.effort) === canonicalEffort(effort))
  const cfg = matches.find(c => c.requestPath === path) ?? matches[0]
  return {id: cfg?.id ?? null, model, effort}
}
const fromConfig = (c: Configuration): Candidate => ({id: c.id, model: c.modelId, effort: c.effort})

function reviewDisposition(s: PolicySnapshot, policy: PolicyData): ReviewDisposition {
  if (s.requirements.requireReview) return {disposition: 'required', trigger: 'trusted-requirement', distinctFamily: s.requirements.distinctFamily}
  const none: ReviewDisposition = {disposition: 'not-requested', trigger: null, distinctFamily: false}
  if (s.assignment.purpose === 'review' || s.controls.reviewMode === 'off' || !s.classification.output) return none
  const o = s.classification.output
  const t = policy.reviewTriggers.find(t => Object.entries(t.when).every(([k, v]) => v!.includes(o[k as Dimension].value) && confident(o[k as Dimension], policy.confidenceThreshold)))
  return t ? {disposition: 'recommended', trigger: t.id, distinctFamily: false} : none
}

export function decide(snapshot: PolicySnapshot, policy: PolicyData, catalog: CatalogV2): PolicyDecision {
  const s = snapshot
  const snapshotErrors = validateSnapshot(s)
  const catalogErrors = validateCatalog(catalog)
  const errors = [...snapshotErrors, ...catalogErrors.map(x => `catalog: ${x}`),
    ...(catalogErrors.length || (catalog as {schemaVersion?: number})?.schemaVersion !== 2 ? ['catalog must be a valid schema v2 document'] : validatePolicy(policy, catalog).map(x => `policy: ${x}`))]
  const valid = !snapshotErrors.length
  const base: PolicyDecision = {
    contractVersion: CONTRACT_VERSION, policyRevision: String(policy?.policyRevision ?? ''), policyFingerprint: errors.length ? null : fingerprint(policy),
    catalogRevision: catalogErrors.length ? null : fingerprint(catalog), snapshotFingerprint: valid ? fingerprint(s) : null,
    assignmentId: valid ? s.assignment.id : null, parentAssignmentId: valid ? s.assignment.parentId : null, lineageId: valid ? s.assignment.lineageId : null,
    purpose: valid ? s.assignment.purpose : null, reviewStage: valid ? s.assignment.reviewStage : null, controls: valid ? {...s.controls} : null,
    outcome: 'unavailable', reasons: [], ruleId: null, configuration: null, changes: null, qualification: null, experimental: false,
    question: null, blocker: null, remedy: null, overrideSources: {model: null, effort: null}, candidates: [],
    fallback: {authorized: false, substitution: false}, reservation: {required: false},
    review: valid && !errors.length ? reviewDisposition(s, policy) : {disposition: 'not-requested', trigger: null, distinctFamily: false},
  }
  const unavailable = (reasons: ReasonCode[], blocker: string, remedy: string, extra: Partial<PolicyDecision> = {}): PolicyDecision =>
    ({...base, ...extra, outcome: 'unavailable', reasons: [...new Set(reasons)], blocker, remedy})
  if (errors.length) return unavailable(['configuration_invalid'], errors.slice(0, 5).join('; '), 'Fix the snapshot, policy or catalog; no request is dispatched under an invalid v2 policy.')

  const threshold = policy.confidenceThreshold
  const out = s.classification.status === 'ok' ? s.classification.output : null
  const currentEffort = effortTokenOf(s.current.effort, s.current.effortOrigin)
  const taskRole: TaskRole | null = s.assignment.purpose === 'review' ? 'review'
    : s.assignment.requestedRole ?? (out && confident(out.role, threshold) ? out.role.value as TaskRole : null)

  // 1. Pins within the assignment purpose, field by field, most specific scope first.
  const pinned: Partial<Record<'model' | 'effort', Pin>> = {}
  for (const field of ['model', 'effort'] as const) {
    for (const scope of PIN_SCOPES) {
      const pins = s.pins.filter(p => p.purpose === s.assignment.purpose && p.field === field && p.scope === scope)
      if (new Set(pins.map(p => JSON.stringify([p.value, p.experimental]))).size > 1)
        return {...base, outcome: 'clarify', reasons: ['override_conflict'], question: `Conflicting ${scope} ${field} pins: ${pins.map(p => p.value).join(', ')}. Which one applies?`}
      if (pins.length) { pinned[field] = pins[0]; break }
    }
  }
  const pinEffort = pinned.effort ? effortTokenOf(pinned.effort.value, 'pin') : null
  // Fixed fields: routing switch off, or an origin the adapter could not establish.
  const modelUnknownOrigin = s.current.modelOrigin === 'unknown', effortUnknownOrigin = s.current.effortOrigin === 'unknown'
  const modelFixed = !s.controls.changeModel || modelUnknownOrigin || (s.current.modelOrigin === 'pin' && !pinned.model)
  const effortFixed = !s.controls.changeEffort || effortUnknownOrigin || (s.current.effortOrigin === 'pin' && !pinned.effort)
  const source = (pin: Pin | undefined, fixed: boolean, unknown: boolean) =>
    pin ? `${pin.scope}-pin:${pin.source}` : unknown ? 'origin-unknown' : fixed ? 'routing-off' : null
  base.overrideSources = {model: source(pinned.model, modelFixed, modelUnknownOrigin), effort: source(pinned.effort, effortFixed, effortUnknownOrigin)}
  const originReasons: ReasonCode[] = modelUnknownOrigin || effortUnknownOrigin ? ['override_origin_unknown'] : []
  if ((pinned.model && modelFixed && pinned.model.value !== s.current.model) ||
      (pinEffort && effortFixed && canonicalEffort(pinEffort) !== canonicalEffort(currentEffort)))
    return unavailable(['routing_fixed', ...originReasons], 'A pin differs from a fixed outgoing field.', 'Reconcile the pin with the routing switch or field origin before dispatch.')

  const current = lookup(catalog, s.current.model, currentEffort, s.environment.requestPath)
  const evalCurrent = () => evaluate(current, 'current', {automatic: true, experimental: false, ruleId: null}, s, policy, catalog, taskRole)
  const isCurrent = (c: Candidate) => c.model === s.current.model && canonicalEffort(c.effort) === canonicalEffort(currentEffort)
  const hardFailures = (check: CandidateCheck) => check.failed.filter(f => HARD.includes(f.reason))

  // 2. Global hard limits and known failures on the fixed or pinned model
  // precede classification and clarification, even when model identity is unknown.
  if (s.resources.hardBudget?.accounting === 'unavailable')
    return unavailable(['accounting_unknown'], 'Hard budget has no reliable accounting.', 'Provide reliable accounting before dispatch.')
  if (s.resources.hardBudget && !s.resources.hardBudget.permits)
    return unavailable(['budget_denied'], 'Hard budget denies the attempt.', 'Reconcile the hard limit before dispatch.')
  const constrainedModel = pinned.model ? String(pinned.model.value) : modelFixed ? s.current.model : null
  if (constrainedModel !== null) {
    const candidate = lookup(catalog, constrainedModel, pinEffort ?? currentEffort, s.environment.requestPath)
    const check = evaluate(candidate, 'primary', {automatic: false, experimental: false, ruleId: null}, s, policy, catalog, taskRole)
    const hard = hardFailures(check).filter(f => ['resources', 'availability'].includes(f.check) ||
      (f.check === 'identity' && catalog.models.find(m => m.id === constrainedModel)?.enabled === false))
    // A mutable explicit pin may have a narrowly scoped authorized substitute;
    // defer that case to primary/fallback evaluation below.
    if (hard.length && (modelFixed || !s.fallback?.coversPins)) return unavailable(hard.map(f => f.reason), `Fixed or pinned model ${constrainedModel}: ${hard[0]!.detail}.`, 'Change the model control or pin an eligible model.', {candidates: [check]})
  }

  // 3. Material missing decisions.
  if (s.requirements.unresolved.length)
    return {...base, outcome: 'clarify', reasons: ['requirement_unresolved'], question: `Resolve before dispatch: ${s.requirements.unresolved.join('; ')}.`}
  if (out && policy.clarifyWhen.specification.includes(out.specification.value) && confident(out.specification, threshold))
    return {...base, outcome: 'clarify', reasons: ['requirement_unresolved'], question: 'A material requirement appears unresolved. Which behavior is required?'}

  // Preserve the current request unless a known hard failure or unmet mandatory requirement blocks it.
  const preserve = (reasons: ReasonCode[]): PolicyDecision => {
    const check = evalCurrent()
    const mandatory = s.requirements.mandatory
    const blocking = check.failed.filter(f => HARD.includes(f.reason) ||
      (s.assignment.purpose === 'review' && s.requirements.distinctFamily && f.check === 'independence') ||
      (mandatory && (f.check === 'compatibility' || f.check === 'capability' || f.check === 'context' || f.check === 'effort' || current.id === null)))
    if (blocking.length)
      return unavailable([...reasons, ...blocking.map(f => f.reason)], `Current request: ${blocking[0]!.detail}.`, 'Choose an eligible configuration or satisfy the requirement.', {candidates: [check]})
    return {...base, outcome: 'preserve', reasons: [...new Set([...reasons, ...originReasons])], candidates: [check],
      configuration: {id: current.id, model: s.current.model, effort: currentEffort}, qualification: check.failed.length ? 'unverified' : 'verified',
      reservation: {required: s.resources.hardBudget?.accounting === 'reliable'}}
  }

  // 4. Fully fixed request: preserve without demanding workload approval.
  if (modelFixed && effortFixed) return preserve(['routing_fixed'])

  // Find the highest-priority confident rule.
  let rule: WorkloadRule | null = null
  let uncertain = false
  if (out || s.assignment.purpose === 'review' || s.assignment.requestedRole !== null) {
    const rules = policy.rules.filter(r => r.purpose === s.assignment.purpose).sort((a, b) => b.priority - a.priority)
    for (const r of rules) {
      const role = taskRole ?? out?.role.value ?? 'unknown'
      const conds = Object.entries(r.when) as [Dimension, string[]][]
      const values = r.roles.includes(role as TaskRole) && conds.every(([k, v]) => out !== null && v.includes(out[k].value))
      if (!values) continue
      const sure = (s.assignment.purpose === 'review' || s.assignment.requestedRole !== null || confident(out!.role, threshold)) && conds.every(([k]) => confident(out![k], threshold))
      if (sure) { rule = r; break }
      uncertain = true
    }
  }
  base.ruleId = rule?.id ?? null
  const pinsAnything = !!(pinned.model || pinned.effort)

  // 5. No usable classification or rule: explicit pins still apply; otherwise preserve.
  if (!rule && !pinsAnything) {
    const status = s.classification.status
    const reason: ReasonCode = status === 'timeout' ? 'classification_timeout' : status === 'unmatched' ? 'classification_unmatched'
      : s.assignment.purpose === 'execution' && !out ? 'classification_invalid' : uncertain ? 'classification_uncertain' : 'no_matching_rule'
    return preserve([reason])
  }

  // 6. One primary configuration, respecting pins and fixed fields, before eligibility.
  const targetModel = pinned.model ? String(pinned.model.value) : modelFixed ? s.current.model : null
  const targetEffort = pinEffort ?? (effortFixed ? currentEffort : null)
  const provider = (id: string | null) => catalog.models.find(m => m.id === id)?.provider ?? null
  const family = (id: string | null) => catalog.models.find(m => m.id === id)?.family ?? null
  const rank = (c: Configuration) => {
    const i = policy.providerPreference.indexOf(provider(c.modelId) ?? '')
    return i === -1 ? policy.providerPreference.length : i
  }
  let primary: Candidate
  const experimental = !!(pinned.model?.experimental || pinned.effort?.experimental)
  let mode: Mode
  if (rule) {
    const ordered = rule.primary.map(id => catalog.configurations.find(c => c.id === id)!)
      .sort((a, b) => Number(b.id === rule!.preference) - Number(a.id === rule!.preference) || rank(a) - rank(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    // A pinned field is manual intent; a rule-chosen pair needs workload approval for the rule.
    mode = pinsAnything ? {automatic: false, experimental, ruleId: null} : {automatic: true, experimental: false, ruleId: rule.id}
    const fitting = ordered.filter(c => (targetModel === null || c.modelId === targetModel) && (targetEffort === null || canonicalEffort(c.effort) === canonicalEffort(targetEffort)))
    // Resolve the primary before eligibility. Other primaries are not fallback permission.
    const fits = fitting[0]
    primary = fits ? fromConfig(fits) : lookup(catalog, targetModel ?? ordered[0]!.modelId, targetEffort ?? ordered[0]!.effort, s.environment.requestPath)
    if (!fits && !pinsAnything && isCurrent(primary)) return preserve(['routing_fixed'])
  } else {
    primary = lookup(catalog, targetModel ?? s.current.model, targetEffort ?? currentEffort, s.environment.requestPath)
    mode = {automatic: false, experimental, ruleId: null}
  }
  const selected: ReasonCode = pinsAnything ? 'pin_selected' : 'rule_selected'
  const accept = (c: Candidate, check: ReturnType<typeof evaluate>, candidates: CandidateCheck[], substitution: boolean): PolicyDecision => {
    const {experimental: exp, ...clean} = check
    const all = [...candidates, clean]
    const shared = {...base, candidates: all, experimental: exp, configuration: {id: c.id, model: c.model, effort: {...c.effort}},
      fallback: {authorized: base.fallback.authorized, substitution}, reservation: {required: s.resources.hardBudget?.accounting === 'reliable'}}
    if (isCurrent(c)) return {...shared, outcome: 'preserve', reasons: ['already_selected', ...originReasons], qualification: 'verified'}
    const changes: PolicyDecision['changes'] = {}
    if (c.model !== s.current.model && c.model !== null) changes.model = c.model
    if (canonicalEffort(c.effort) !== canonicalEffort(currentEffort)) changes.effort = {...c.effort}
    return {...shared, outcome: 'select', reasons: [selected, ...originReasons], changes}
  }

  // 7. Eligible primary: select, or preserve when it is already the request.
  const primaryCheck = evaluate(primary, 'primary', mode, s, policy, catalog, taskRole)
  if (!primaryCheck.failed.length) return accept(primary, primaryCheck, [], false)
  const {experimental: _, ...primaryClean} = primaryCheck
  const failureReasons = primaryCheck.failed.map(f => f.reason)

  // 8. Only explicitly authorized alternatives, in order, within the substitution limit.
  const f = s.fallback
  const covered = !!f && f.lineageId === s.assignment.lineageId && f.policyRevision === policy.policyRevision &&
    f.purpose === s.assignment.purpose && taskRole !== null && f.roles.includes(taskRole) &&
    f.from.modelId === primary.model && canonicalEffort(f.from.effort) === canonicalEffort(primary.effort) &&
    ((rule !== null && !pinsAnything && f.ruleIds.includes(rule.id)) || (pinsAnything && f.coversPins)) &&
    failureReasons.every(r => f.failures.includes(r))
  if (!f || !covered)
    return unavailable(failureReasons, `${primary.model ?? 'unknown model'}/${canonicalEffort(primary.effort)}: ${primaryCheck.failed[0]!.detail}.`,
      'Record qualifying evidence/approval, authorize an alternative, or choose an eligible configuration explicitly.', {candidates: [primaryClean]})
  base.fallback.authorized = true
  if (f.used >= f.maxSubstitutions)
    return unavailable(['fallback_exhausted', ...failureReasons], 'The substitution limit for this assignment lineage is reached.', 'Start a new explicit assignment or adjust authorization.', {candidates: [primaryClean]})
  const tried: CandidateCheck[] = [primaryClean]
  for (const id of f.alternatives) {
    const cfg = catalog.configurations.find(c => c.id === id)
    const alt: Candidate = cfg ? fromConfig(cfg) : {id, model: null, effort: {kind: 'unknown'}}
    const refusal = !cfg ? 'alternative is not in the catalog'
      : modelFixed && alt.model !== s.current.model ? 'alternative changes a fixed model'
      : effortFixed && canonicalEffort(alt.effort) !== canonicalEffort(currentEffort) ? 'alternative changes a fixed effort'
      : !f.allowProviderChange && provider(alt.model) !== provider(primary.model) ? 'provider change is not authorized'
      : !f.allowFamilyChange && (family(alt.model) === null || family(primary.model) === null || family(alt.model) !== family(primary.model)) ? 'family continuity is unknown or change is not authorized' : null
    if (refusal) { tried.push({configurationId: id, model: alt.model, effort: canonicalEffort(alt.effort), role: 'alternative', approvalId: null, limits: null, passed: [], failed: [{check: 'identity', reason: 'fallback_exhausted', detail: refusal}]}); continue }
    const check = evaluate(alt, 'alternative', {automatic: true, experimental: false, ruleId: rule && !pinsAnything ? rule.id : null}, s, policy, catalog, taskRole)
    if (!check.failed.length) return accept(alt, check, tried, true)
    const {experimental: __, ...clean} = check
    tried.push(clean)
  }
  return unavailable(['fallback_exhausted', ...failureReasons], 'No authorized alternative passed every check.', 'Record qualifying evidence or authorize another alternative.', {candidates: tried})
}

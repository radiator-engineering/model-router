/** Catalog schema and validation. No network, credentials, or filesystem access. */
import {TASK_ROLES, canonicalEffort, isEffortToken, isId, isTimestamp} from './v2/contract.ts'
import type {EffortToken, TaskRole} from './v2/contract.ts'
export const USE_CASES = ['implementation', 'investigation', 'review', 'planning', 'explanation'] as const
export type UseCase = typeof USE_CASES[number]
export type Rating = 1 | 2 | 3 | 4 | 5
export interface ModelProfile {
  id: string
  provider: 'anthropic' | 'openai'
  enabled: boolean
  /** Advertised by the proxy is not proof of successful inference. */
  availability: 'advertised' | 'verified' | 'unknown'
  claudeCodeCompatibility: 'unverified' | 'verified' | 'incompatible'
  capabilities: {
    /** Human/evaluation ratings, 1..5. Null means unmeasured. */
    qualityByUseCase: Record<UseCase, Rating | null>
    maxComplexity: 'low' | 'medium' | 'high' | null
    contextWindowTokens: number | null
    toolCalling: boolean | null
    reasoningEfforts: string[]
  }
  cost: {
    /** Relative subscription consumption estimate, not a dollar price. */
    allowanceWeight: number | null
    /** USD per million tokens, only when a real API price is known. */
    inputUsdPerMillion: number | null
    outputUsdPerMillion: number | null
  }
  evidence: {
    source: 'unmeasured' | 'manual' | 'evaluation'
    checkedAt: string | null
    notes: string
  }
}
export interface ModelCatalog { schemaVersion: 1; models: ModelProfile[] }
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const oneOf = (v: unknown, values: readonly unknown[]) => values.includes(v)
const nonnegative = (v: unknown) => v === null || (typeof v === 'number' && Number.isFinite(v) && v >= 0)

/** Return all diagnostics so an editor can fix a catalog in one pass. Accepts schema v1 or v2. */
export function validateCatalog(input: unknown): string[] {
  if (object(input) && input.schemaVersion === 2) return validateCatalogV2(input)
  return validateCatalogV1(input)
}

function validateCatalogV1(input: unknown): string[] {
  const errors: string[] = []
  if (!object(input)) return ['catalog must be an object']
  if (input.schemaVersion !== 1) errors.push('schemaVersion must be 1')
  if (!Array.isArray(input.models)) return [...errors, 'models must be an array']
  const ids = new Set<string>()
  for (const [index, m] of input.models.entries()) {
    const prefix = `models[${index}]`
    const check = (ok: boolean, field: string) => { if (!ok) errors.push(`${prefix}.${field}`) }
    if (!object(m)) { errors.push(`${prefix} must be an object`); continue }
    check(typeof m.id === 'string' && m.id.trim() === m.id && m.id.length > 0, 'id must be a nonempty trimmed string')
    if (typeof m.id === 'string') {
      check(!ids.has(m.id), 'id must be unique'); ids.add(m.id)
    }
    check(oneOf(m.provider, ['anthropic', 'openai']), 'provider is unsupported')
    check(typeof m.enabled === 'boolean', 'enabled must be boolean')
    check(oneOf(m.availability, ['advertised', 'verified', 'unknown']), 'availability is invalid')
    check(oneOf(m.claudeCodeCompatibility, ['unverified', 'verified', 'incompatible']), 'claudeCodeCompatibility is invalid')
    if (!object(m.capabilities)) errors.push(`${prefix}.capabilities must be an object`)
    else {
      const c = m.capabilities
      check(oneOf(c.maxComplexity, ['low', 'medium', 'high', null]), 'capabilities.maxComplexity is invalid')
      check(c.contextWindowTokens === null || (Number.isSafeInteger(c.contextWindowTokens) && Number(c.contextWindowTokens) > 0), 'capabilities.contextWindowTokens must be a positive integer or null')
      check(oneOf(c.toolCalling, [true, false, null]), 'capabilities.toolCalling must be boolean or null')
      check(Array.isArray(c.reasoningEfforts) && c.reasoningEfforts.every(x => typeof x === 'string' && x.trim().length > 0) && new Set(c.reasoningEfforts).size === c.reasoningEfforts.length, 'capabilities.reasoningEfforts must contain unique nonempty strings')
      if (!object(c.qualityByUseCase)) errors.push(`${prefix}.capabilities.qualityByUseCase must be an object`)
      else {
        for (const useCase of USE_CASES) check(oneOf(c.qualityByUseCase[useCase], [null, 1, 2, 3, 4, 5]), `capabilities.qualityByUseCase.${useCase} must be 1..5 or null`)
        check(Object.keys(c.qualityByUseCase).every(k => USE_CASES.includes(k as UseCase)), 'capabilities.qualityByUseCase contains an unknown use case')
      }
    }
    if (!object(m.cost)) errors.push(`${prefix}.cost must be an object`)
    else for (const field of ['allowanceWeight', 'inputUsdPerMillion', 'outputUsdPerMillion']) {
      check(nonnegative(m.cost[field]), `cost.${field} must be a finite nonnegative number or null`)
    }
    if (!object(m.evidence)) errors.push(`${prefix}.evidence must be an object`)
    else {
      check(oneOf(m.evidence.source, ['unmeasured', 'manual', 'evaluation']), 'evidence.source is invalid')
      const date = m.evidence.checkedAt
      check(date === null || (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date), 'evidence.checkedAt must be a valid YYYY-MM-DD date or null')
      check(typeof m.evidence.notes === 'string', 'evidence.notes must be a string')
    }
  }
  return errors
}

function assertValid(errors: string[]) {
  if (errors.length) throw new Error(`Invalid model catalog:\n${errors.join('\n')}`)
}

/** Legacy reader: a validated deep clone of the v1 input or of the v2 `legacy` snapshot. */
export function parseCatalog(input: unknown): ModelCatalog {
  assertValid(validateCatalog(input))
  // Own the returned data: callers cannot mutate the input through the result.
  return structuredClone(object(input) && input.schemaVersion === 2 ? input.legacy : input) as ModelCatalog
}

/** Discovery alone never marks a model compatible or assigns quality/cost. */
export function reconcileAvailability(catalog: ModelCatalog, advertisedIds: readonly string[]): ModelCatalog {
  const available = new Set(advertisedIds)
  const copy = parseCatalog(catalog)
  for (const model of copy.models) {
    model.availability = available.has(model.id) ? (model.availability === 'verified' ? 'verified' : 'advertised') : 'unknown'
  }
  return copy
}

// Schema v2 (docs/v2/runtime-contracts.md#catalog-document-version-2) -------

export interface ModelIdentity { id: string; provider: string; family: string | null; enabled: boolean }
export interface Environment { id: string; harnessVersion: string; proxyVersion: string; requestPath: string; evidenceIds: string[] }
export interface AvailabilityObservation {
  id: string; modelId: string; status: 'unknown' | 'advertised' | 'verified' | 'unavailable'
  observedAt: string | null; validUntil: string | null; evidenceId: string
}
export interface Configuration { id: string; modelId: string; effort: EffortToken; requestPath: string | null }
export interface CompatibilityObservation {
  id: string; configurationId: string; environmentId: string | null; status: 'unverified' | 'verified' | 'incompatible'
  toolCalling: boolean | null; imageInput: boolean | null; streaming: boolean | null; continuation: boolean | null
  interruptions: boolean | null; effectiveEffortVerified: boolean | null; contextWindowTokens: number | null
  supportedEfforts: EffortToken[]; evidenceIds: string[]
}
export interface Evidence {
  id: string; source: 'legacy-import' | 'manual' | 'evaluation'; checkedDate: string | null; observedAt: string | null
  environmentId: string | null; notes: string; payload: unknown
}
export interface ApprovalLimits {
  maxInputTokens: number; maxGeneratedTokens: number; maxToolCalls: number; maxWallTimeMs: number
  outputReserveTokens: number; contextMarginFraction: number
}
export interface WorkloadApproval {
  id: string; configurationId: string; environmentId: string; role: TaskRole; policyRuleIds: string[]
  state: 'approved' | 'restricted' | 'retired'; evidenceIds: string[]; checkedAt: string; validUntil: string; limits: ApprovalLimits
}
export interface CatalogV2 {
  schemaVersion: 2
  legacy: ModelCatalog
  models: ModelIdentity[]
  environments: Environment[]
  availability: AvailabilityObservation[]
  configurations: Configuration[]
  compatibility: CompatibilityObservation[]
  evidence: Evidence[]
  approvals: WorkloadApproval[]
}
export const V2_COLLECTIONS = ['models', 'environments', 'availability', 'configurations', 'compatibility', 'evidence', 'approvals'] as const

const isDate = (v: unknown) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v
const nullable = (f: (v: unknown) => boolean) => (v: unknown) => v === null || f(v)
const bool = (v: unknown): v is boolean => typeof v === 'boolean'
const positiveInt = (v: unknown) => Number.isSafeInteger(v) && (v as number) > 0
function isJson(v: unknown, ancestors = new Set<object>()): boolean {
  if (v === null || typeof v === 'string' || typeof v === 'boolean') return true
  if (typeof v === 'number') return Number.isFinite(v)
  if (typeof v !== 'object' || ancestors.has(v)) return false
  if (!Array.isArray(v) && Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return false
  if (Object.getOwnPropertySymbols(v).length) return false
  ancestors.add(v)
  const valid = (Array.isArray(v) ? Array.from(v) : Object.values(v)).every(x => isJson(x, ancestors))
  ancestors.delete(v)
  return valid
}

/** Validate a whole v2 document, its legacy snapshot, IDs, ordering and references. */
function validateCatalogV2(input: Record<string, unknown>): string[] {
  const errors = validateCatalogV1(input.legacy).map(e => `legacy: ${e}`)
  const ids: Record<string, Set<string>> = {}
  for (const name of V2_COLLECTIONS) {
    const list = input[name]
    ids[name] = new Set()
    if (!Array.isArray(list)) { errors.push(`${name} must be an array`); continue }
    let previous: string | null = null
    for (const [i, r] of list.entries()) {
      if (!object(r) || !isId(r.id)) { errors.push(`${name}[${i}].id must be a nonempty trimmed string`); continue }
      if (ids[name].has(r.id)) errors.push(`${name}[${i}].id must be unique`)
      // Code-unit order, not locale order, so canonical output is portable.
      if (previous !== null && !(previous < r.id)) errors.push(`${name} must be sorted by id`)
      ids[name].add(r.id); previous = r.id
    }
  }
  const allowed = new Set(['schemaVersion', 'legacy', ...V2_COLLECTIONS])
  for (const key of Object.keys(input)) if (!allowed.has(key)) errors.push(`unknown top-level field ${key}`)
  const each = (name: typeof V2_COLLECTIONS[number], fn: (r: Record<string, unknown>, check: (ok: unknown, msg: string) => void) => void) => {
    const list = input[name]
    if (Array.isArray(list)) list.forEach((r, i) => { if (object(r)) fn(r, (ok, msg) => { if (!ok) errors.push(`${name}[${i}].${msg}`) }) })
  }
  const ref = (name: string, v: unknown) => typeof v === 'string' && ids[name]?.has(v)
  const refs = (name: string, v: unknown, nonempty = true) => Array.isArray(v) && (!nonempty || v.length > 0) && v.every(x => ref(name, x)) && new Set(v).size === v.length
  const exactKeys = (r: Record<string, unknown>, keys: string[]) => Object.keys(r).sort().join() === [...keys].sort().join()
  each('models', (r, check) => {
    check(exactKeys(r, ['id', 'provider', 'family', 'enabled']), 'fields must be id, provider, family, enabled')
    check(isId(r.provider), 'provider must be a string'); check(r.family === null || isId(r.family), 'family must be a string or null')
    check(bool(r.enabled), 'enabled must be boolean')
  })
  each('environments', (r, check) => {
    check(exactKeys(r, ['id', 'harnessVersion', 'proxyVersion', 'requestPath', 'evidenceIds']), 'fields are invalid')
    for (const f of ['harnessVersion', 'proxyVersion', 'requestPath']) check(isId(r[f]), `${f} must be an exact string`)
    check(refs('evidence', r.evidenceIds), 'evidenceIds must be a nonempty list of known evidence')
  })
  each('availability', (r, check) => {
    check(exactKeys(r, ['id', 'modelId', 'status', 'observedAt', 'validUntil', 'evidenceId']), 'fields are invalid')
    check(ref('models', r.modelId), 'modelId must reference a model')
    check(['unknown', 'advertised', 'verified', 'unavailable'].includes(r.status as string), 'status is invalid')
    check(nullable(isTimestamp)(r.observedAt) && nullable(isTimestamp)(r.validUntil), 'observedAt/validUntil must be UTC timestamps or null')
    check(ref('evidence', r.evidenceId), 'evidenceId must reference evidence')
  })
  each('configurations', (r, check) => {
    check(exactKeys(r, ['id', 'modelId', 'effort', 'requestPath']), 'fields are invalid')
    check(ref('models', r.modelId), 'modelId must reference a model')
    check(isEffortToken(r.effort), 'effort must be an effort token')
    check(r.requestPath === null || isId(r.requestPath), 'requestPath must be a string or null')
  })
  each('compatibility', (r, check) => {
    check(exactKeys(r, ['id', 'configurationId', 'environmentId', 'status', 'toolCalling', 'imageInput', 'streaming', 'continuation', 'interruptions', 'effectiveEffortVerified', 'contextWindowTokens', 'supportedEfforts', 'evidenceIds']), 'fields are invalid')
    check(ref('configurations', r.configurationId), 'configurationId must reference a configuration')
    check(r.environmentId === null || ref('environments', r.environmentId), 'environmentId must reference an environment or be null')
    check(['unverified', 'verified', 'incompatible'].includes(r.status as string), 'status is invalid')
    for (const f of ['toolCalling', 'imageInput', 'streaming', 'continuation', 'interruptions', 'effectiveEffortVerified']) check(nullable(bool)(r[f]), `${f} must be boolean or null`)
    check(r.contextWindowTokens === null || positiveInt(r.contextWindowTokens), 'contextWindowTokens must be a positive integer or null')
    check(Array.isArray(r.supportedEfforts) && r.supportedEfforts.every(isEffortToken) &&
      new Set(r.supportedEfforts.map(t => canonicalEffort(t as EffortToken))).size === r.supportedEfforts.length, 'supportedEfforts must be unique effort tokens')
    check(refs('evidence', r.evidenceIds, false), 'evidenceIds must reference evidence')
  })
  each('evidence', (r, check) => {
    check(exactKeys(r, ['id', 'source', 'checkedDate', 'observedAt', 'environmentId', 'notes', 'payload']), 'fields are invalid')
    check(['legacy-import', 'manual', 'evaluation'].includes(r.source as string), 'source is invalid')
    check(r.checkedDate === null || isDate(r.checkedDate), 'checkedDate must be YYYY-MM-DD or null')
    check(nullable(isTimestamp)(r.observedAt), 'observedAt must be a UTC timestamp or null')
    check(r.environmentId === null || ref('environments', r.environmentId), 'environmentId must reference an environment or be null')
    check(typeof r.notes === 'string', 'notes must be a string'); check(isJson(r.payload), 'payload must be JSON data')
  })
  each('approvals', (r, check) => {
    check(exactKeys(r, ['id', 'configurationId', 'environmentId', 'role', 'policyRuleIds', 'state', 'evidenceIds', 'checkedAt', 'validUntil', 'limits']), 'fields are invalid')
    check(ref('configurations', r.configurationId), 'configurationId must reference a configuration')
    check(ref('environments', r.environmentId), 'environmentId must reference an environment')
    check(TASK_ROLES.includes(r.role as TaskRole), 'role must be a TaskRole')
    check(Array.isArray(r.policyRuleIds) && r.policyRuleIds.length > 0 && r.policyRuleIds.every(isId), 'policyRuleIds must be a nonempty ID list')
    check(['approved', 'restricted', 'retired'].includes(r.state as string), 'state is invalid')
    check(refs('evidence', r.evidenceIds), 'evidenceIds must be a nonempty list of known evidence')
    check(isTimestamp(r.checkedAt) && isTimestamp(r.validUntil) && Date.parse(r.checkedAt as string) < Date.parse(r.validUntil as string), 'checkedAt/validUntil must be ordered UTC timestamps')
    const l = r.limits
    check(object(l) && exactKeys(l, ['maxInputTokens', 'maxGeneratedTokens', 'maxToolCalls', 'maxWallTimeMs', 'outputReserveTokens', 'contextMarginFraction']) &&
      ['maxInputTokens', 'maxGeneratedTokens', 'maxToolCalls', 'maxWallTimeMs', 'outputReserveTokens'].every(f => positiveInt(l[f])) &&
      (l.outputReserveTokens as number) >= (l.maxGeneratedTokens as number) &&
      typeof l.contextMarginFraction === 'number' && l.contextMarginFraction >= 0 && l.contextMarginFraction < 1,
    'limits must be positive integers, outputReserveTokens >= maxGeneratedTokens, contextMarginFraction in [0,1)')
  })
  return errors
}

/** V2 reader: only schema version 2, validated and deep-cloned. */
export function parseCatalogV2(input: unknown): CatalogV2 {
  if (!object(input) || input.schemaVersion !== 2) throw new Error('Invalid model catalog:\nschemaVersion must be 2')
  assertValid(validateCatalogV2(input))
  return structuredClone(input) as unknown as CatalogV2
}

/** Full-document reader for generation: preserves the input schema version and all data. */
export function parseCatalogDocument(input: unknown): ModelCatalog | CatalogV2 {
  assertValid(validateCatalog(input))
  return structuredClone(input) as ModelCatalog | CatalogV2
}

/** The explicit legacy snapshot. Never reconstructed from v2 observations. */
export function projectLegacyCatalog(v2: CatalogV2): ModelCatalog {
  return parseCatalog(parseCatalogV2(v2))
}

const byId = <T extends {id: string}>(list: T[]) => list.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

/**
 * Deterministic schema-v1 migration. Imports grant no approvals, no
 * environments, no observation times and no request paths, so a migrated
 * catalog cannot automatically qualify any configuration.
 */
export function migrateCatalogV1(input: unknown): CatalogV2 {
  if (!object(input) || input.schemaVersion !== 1) throw new Error('Invalid model catalog:\nschemaVersion must be 1')
  const legacy = parseCatalog(input)
  const models: ModelIdentity[] = [], evidence: Evidence[] = [], availability: AvailabilityObservation[] = []
  const configurations: Configuration[] = [], compatibility: CompatibilityObservation[] = []
  for (const m of legacy.models) {
    const key = encodeURIComponent(m.id)
    const evidenceId = `legacy/${key}`
    models.push({id: m.id, provider: m.provider, family: null, enabled: m.enabled})
    evidence.push({id: evidenceId, source: 'legacy-import', checkedDate: m.evidence.checkedAt, observedAt: null, environmentId: null, notes: m.evidence.notes, payload: structuredClone(m)})
    availability.push({id: `availability/legacy/${key}`, modelId: m.id, status: m.availability, observedAt: null, validUntil: null, evidenceId})
    const efforts: EffortToken[] = m.capabilities.reasoningEfforts.map(value => ({kind: 'level', value}))
    for (const effort of efforts.length ? efforts : [{kind: 'unknown'} as EffortToken]) {
      const id = `configuration/${key}/${canonicalEffort(effort)}/unknown`
      configurations.push({id, modelId: m.id, effort, requestPath: null})
      compatibility.push({
        id: `compatibility/legacy/${encodeURIComponent(id)}`, configurationId: id, environmentId: null, status: m.claudeCodeCompatibility,
        toolCalling: m.capabilities.toolCalling, imageInput: null, streaming: null, continuation: null, interruptions: null,
        effectiveEffortVerified: null, contextWindowTokens: m.capabilities.contextWindowTokens,
        supportedEfforts: structuredClone(efforts), evidenceIds: [evidenceId],
      })
    }
  }
  const out: CatalogV2 = {
    schemaVersion: 2, legacy, models: byId(models), environments: [], availability: byId(availability),
    configurations: byId(configurations), compatibility: byId(compatibility), evidence: byId(evidence), approvals: [],
  }
  assertValid(validateCatalogV2(out as unknown as Record<string, unknown>))
  return out
}

/**
 * V2 decision contract (version 3): normalized records shared by the
 * classifier adapter, catalog and pure policy. No `$`, no I/O, no Node APIs.
 * Behavior lives in docs/v2/decision-contract.md; this file owns the shapes.
 */
import {ROLES} from '../task-routing.ts'
import type {ApprovalLimits} from '../model-catalog.ts'

export const CONTRACT_VERSION = 3
/** V2-only additions must not change the frozen legacy classifier vocabulary. */
export const TASK_ROLES = [...ROLES, 'planning', 'research', 'writing', 'summarization', 'translation', 'extraction', 'data-analysis', 'mathematics', 'operations'] as const
export type TaskRole = typeof TASK_ROLES[number]

/** Logical classifier dimensions. `unknown` never carries confidence. */
export const DIMENSIONS = {
  specification: ['explicit', 'inferable', 'unresolved', 'unknown'],
  verification: ['executable', 'partial', 'judgment', 'unknown'],
  executionSpan: ['bounded', 'dependent-steps', 'extended', 'unknown'],
  consequence: ['reversible', 'consequential', 'unknown'],
} as const
export type Dimension = keyof typeof DIMENSIONS
export const DIMENSION_KEYS = Object.keys(DIMENSIONS) as Dimension[]

export interface Observation<T> {
  value: T
  /** Finite 0..1, or null when unavailable. */
  confidence: number | null
}
export interface ClassifierInput { prompt: string; context?: string }
export interface ClassifierOutput {
  role: Observation<TaskRole | 'unknown'>
  specification: Observation<typeof DIMENSIONS.specification[number]>
  verification: Observation<typeof DIMENSIONS.verification[number]>
  executionSpan: Observation<typeof DIMENSIONS.executionSpan[number]>
  consequence: Observation<typeof DIMENSIONS.consequence[number]>
}
export type ObservationKey = keyof ClassifierOutput
export const OBSERVATION_KEYS: readonly ObservationKey[] = ['role', ...DIMENSION_KEYS]
export const allowedValues = (key: ObservationKey): readonly string[] =>
  key === 'role' ? [...TASK_ROLES, 'unknown'] : DIMENSIONS[key]

/** True only for a known value whose confidence meets the threshold. */
export function confident(o: Observation<string> | undefined, threshold: number): boolean {
  return !!o && o.value !== 'unknown' && isConfidence(o.confidence) && o.confidence >= threshold
}

// Effort tokens -------------------------------------------------------------
export type EffortToken =
  | {kind: 'level'; value: string}
  | {kind: 'budget'; value: number}
  | {kind: 'default'}
  | {kind: 'unknown'}

export function isEffortToken(v: unknown): v is EffortToken {
  if (!isObject(v)) return false
  const keys = Object.keys(v).sort().join(',')
  // Match the legacy validator without trimming: migration preserves literal declarations.
  if (v.kind === 'level') return keys === 'kind,value' && typeof v.value === 'string' && v.value.trim().length > 0
  if (v.kind === 'budget') return keys === 'kind,value' && Number.isSafeInteger(v.value) && (v.value as number) >= 0
  return (v.kind === 'default' || v.kind === 'unknown') && keys === 'kind'
}
/** Canonical token used inside stable configuration IDs. */
export function canonicalEffort(t: EffortToken): string {
  if (t.kind === 'level') return `level-${encodeURIComponent(t.value)}`
  if (t.kind === 'budget') return `budget-${t.value}`
  return t.kind
}
/** A caller value carried literally: numbers stay budgets, never named levels. */
export function effortTokenOf(value: string | number | null, origin: Origin): EffortToken {
  if (typeof value === 'string' && value.trim() === value && value) return {kind: 'level', value}
  if (Number.isSafeInteger(value) && (value as number) >= 0) return {kind: 'budget', value: value as number}
  if (value === null && origin === 'harness-default') return {kind: 'default'}
  return {kind: 'unknown'}
}

// Snapshot ------------------------------------------------------------------
export type Purpose = 'execution' | 'review'
export type ReviewStage = 'full' | 'targeted'
export type Origin = 'pin' | 'inherited' | 'harness-default' | 'router' | 'unknown'
export type PinScope = 'assignment' | 'session' | 'persistent'
export const PIN_SCOPES: readonly PinScope[] = ['assignment', 'session', 'persistent']
export interface Pin {
  field: 'model' | 'effort'
  value: string | number
  scope: PinScope
  purpose: Purpose
  /** Trusted control that created it, e.g. `router-command`, `coordinator`. */
  source: string
  /** Explicit experimental use of a compatible but workload-unapproved pair. */
  experimental: boolean
}
export interface FallbackAuthorization {
  /** Resolved trusted authorization; matching strings alone do not establish authority. */
  authorizationRef: string
  lineageId: string
  policyRevision: string
  purpose: Purpose
  roles: TaskRole[]
  /** Exact original pair this grant covers, including an explicit pin when coversPins is true. */
  from: {modelId: string; effort: EffortToken}
  /** Workload rules this authorization covers. */
  ruleIds: string[]
  coversPins: boolean
  /** Exact ordered alternative configuration IDs. */
  alternatives: string[]
  failures: ReasonCode[]
  maxSubstitutions: number
  /** Substitutions already dispatched in this assignment lineage. */
  used: number
  allowProviderChange: boolean
  allowFamilyChange: boolean
}
export interface PolicySnapshot {
  schemaVersion: 1
  assignment: {
    id: string; parentId: string | null; lineageId: string
    boundary: 'main' | 'subagent' | 'review' | 'retry' | 'escalation'
    purpose: Purpose; reviewStage: ReviewStage | null
    /** Trusted assignment metadata; null means the role must come from classification. */
    requestedRole: TaskRole | null
    /** Known author family, for independent review; null is unknown. */
    authorFamily: string | null
  }
  current: {model: string | null; modelOrigin: Origin; effort: string | number | null; effortOrigin: Origin}
  controls: {changeModel: boolean; changeEffort: boolean; reviewMode: 'off' | 'recommend' | 'automatic'}
  pins: Pin[]
  classification: {status: 'ok' | 'timeout' | 'invalid' | 'unmatched'; output: ClassifierOutput | null}
  requirements: {
    tools: boolean; imageInput: boolean
    streaming: boolean; continuation: boolean; interruptions: boolean
    /** Optional diagnostic estimate only; the harness/provider owns context fitting. */
    inputTokens: number | null
    /**
     * Trusted requirement that makes unknown compatibility, capability,
     * or effort block even an unchanged inherited request.
     * Known hard failures always block regardless of this flag.
     */
    mandatory: boolean
    /** Trusted material decisions still missing. */
    unresolved: string[]
    requireReview: boolean; distinctFamily: boolean
  }
  environment: {id: string | null; harnessVersion: string | null; proxyVersion: string | null; requestPath: string | null}
  resources: {
    restrictedProviders: string[]; exhaustedModels: string[]
    hardBudget: null | {accounting: 'reliable' | 'unavailable'; permits: boolean}
  }
  fallback: FallbackAuthorization | null
  /** Evaluation time supplied by the adapter; selection never reads a clock. */
  now: string
}

// Decision ------------------------------------------------------------------
export const REASON_CODES = [
  'rule_selected', 'pin_selected', 'already_selected', 'routing_fixed', 'override_origin_unknown', 'configuration_invalid',
  'classification_timeout', 'classification_invalid', 'classification_unmatched', 'classification_uncertain',
  'no_matching_rule', 'requirement_unresolved', 'override_conflict', 'model_disabled', 'availability_unknown',
  'model_unavailable', 'compatibility_unknown', 'capability_missing', 'context_fit_unknown', 'effort_unsupported',
  'workload_unapproved', 'budget_denied', 'accounting_unknown', 'independence_unverified', 'fallback_exhausted',
] as const
export type ReasonCode = typeof REASON_CODES[number]
export type Outcome = 'select' | 'preserve' | 'clarify' | 'unavailable'
export type CheckName = 'identity' | 'availability' | 'compatibility' | 'capability' | 'context' | 'effort' | 'workload' | 'resources' | 'independence'
export interface CandidateCheck {
  configurationId: string | null
  model: string | null
  effort: string
  role: 'primary' | 'alternative' | 'current'
  approvalId: string | null
  /** Finite operating ceilings the adapter must enforce, not evidence of completed execution. */
  limits: ApprovalLimits | null
  passed: CheckName[]
  failed: {check: CheckName; reason: ReasonCode; detail: string}[]
}
export interface ReviewDisposition {
  disposition: 'not-requested' | 'recommended' | 'required'
  trigger: string | null
  distinctFamily: boolean
}
export interface PolicyDecision {
  contractVersion: typeof CONTRACT_VERSION
  policyRevision: string
  policyFingerprint: string | null
  catalogRevision: string | null
  snapshotFingerprint: string | null
  assignmentId: string | null
  parentAssignmentId: string | null
  lineageId: string | null
  purpose: Purpose | null
  reviewStage: ReviewStage | null
  controls: PolicySnapshot['controls'] | null
  outcome: Outcome
  reasons: ReasonCode[]
  ruleId: string | null
  configuration: {id: string | null; model: string | null; effort: EffortToken} | null
  changes: {model?: string; effort?: EffortToken} | null
  qualification: 'verified' | 'configured' | 'unverified' | null
  experimental: boolean
  question: string | null
  blocker: string | null
  remedy: string | null
  overrideSources: {model: string | null; effort: string | null}
  candidates: CandidateCheck[]
  fallback: {authorized: boolean; substitution: boolean}
  reservation: {required: boolean}
  review: ReviewDisposition
}

// Validation helpers --------------------------------------------------------
export const isObject = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
export const isId = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.trim() === v
export const isTimestamp = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/.test(v) && !Number.isNaN(Date.parse(v)) &&
  new Date(v).toISOString().replace('.000Z', 'Z') === v.replace('.000Z', 'Z')
export const isConfidence = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1

export function validateClassifierOutput(v: unknown): string[] {
  if (!isObject(v)) return ['classification must be an object']
  const errors: string[] = []
  for (const key of OBSERVATION_KEYS) {
    const o = v[key]
    if (!isObject(o)) { errors.push(`${key} must be an observation`); continue }
    if (!allowedValues(key).includes(o.value as string)) errors.push(`${key}.value is invalid`)
    if (!(o.confidence === null || isConfidence(o.confidence))) errors.push(`${key}.confidence must be 0..1 or null`)
    if (o.value === 'unknown' && o.confidence !== null) errors.push(`${key} unknown cannot carry confidence`)
  }
  return errors
}

const strings = (v: unknown) => Array.isArray(v) && v.every(isId)
const oneOf = (v: unknown, values: readonly unknown[]) => values.includes(v)
const ORIGINS: Origin[] = ['pin', 'inherited', 'harness-default', 'router', 'unknown']

/** Structural snapshot validation; any diagnostic makes the decision `configuration_invalid`. */
export function validateSnapshot(s: unknown): string[] {
  if (!isObject(s)) return ['snapshot must be an object']
  const e: string[] = []
  const need = (ok: boolean, msg: string) => { if (!ok) e.push(msg) }
  need(s.schemaVersion === 1, 'schemaVersion must be 1')
  const a = s.assignment, c = s.current, k = s.controls, r = s.requirements, env = s.environment, res = s.resources, cl = s.classification
  if (!isObject(a)) e.push('assignment must be an object'); else {
    need(isId(a.id) && isId(a.lineageId), 'assignment.id and lineageId are required')
    need(a.parentId === null || isId(a.parentId), 'assignment.parentId must be an ID or null')
    need(oneOf(a.boundary, ['main', 'subagent', 'review', 'retry', 'escalation']), 'assignment.boundary is invalid')
    need(oneOf(a.purpose, ['execution', 'review']), 'assignment.purpose is invalid')
    need(a.purpose === 'review' ? oneOf(a.reviewStage, ['full', 'targeted']) : a.reviewStage === null, 'assignment.reviewStage must match purpose')
    need(a.authorFamily === null || isId(a.authorFamily), 'assignment.authorFamily must be an ID or null')
    need(a.requestedRole === null || oneOf(a.requestedRole, TASK_ROLES), 'assignment.requestedRole must be a TaskRole or null')
    need(a.purpose !== 'review' || a.requestedRole === null || a.requestedRole === 'review', 'review purpose requires review role')
  }
  if (!isObject(c)) e.push('current must be an object'); else {
    need(c.model === null || isId(c.model), 'current.model must be an ID or null')
    need(c.effort === null || isId(c.effort) || (Number.isSafeInteger(c.effort) && (c.effort as number) >= 0), 'current.effort must be a level, nonnegative integer or null')
    need(oneOf(c.modelOrigin, ORIGINS) && oneOf(c.effortOrigin, ORIGINS), 'current origins are invalid')
  }
  if (!isObject(k)) e.push('controls must be an object'); else
    need(typeof k.changeModel === 'boolean' && typeof k.changeEffort === 'boolean' && oneOf(k.reviewMode, ['off', 'recommend', 'automatic']), 'controls are invalid')
  if (!Array.isArray(s.pins)) e.push('pins must be an array'); else s.pins.forEach((p, i) => {
    need(isObject(p) && oneOf(p.field, ['model', 'effort']) && oneOf(p.scope, PIN_SCOPES) && oneOf(p.purpose, ['execution', 'review']) &&
      isId(p.source) && typeof p.experimental === 'boolean' &&
      (p.field === 'model' ? isId(p.value) : isId(p.value) || (Number.isSafeInteger(p.value) && (p.value as number) >= 0)), `pins[${i}] is invalid`)
  })
  if (!isObject(cl)) e.push('classification must be an object'); else {
    need(oneOf(cl.status, ['ok', 'timeout', 'invalid', 'unmatched']), 'classification.status is invalid')
    if (cl.status === 'ok') e.push(...validateClassifierOutput(cl.output).map(x => `classification.output: ${x}`))
    else need(cl.output === null, 'classification.output must be null unless status is ok')
  }
  if (!isObject(r)) e.push('requirements must be an object'); else {
    need(['tools', 'imageInput', 'streaming', 'continuation', 'interruptions', 'mandatory', 'requireReview', 'distinctFamily'].every(k => typeof r[k] === 'boolean'), 'requirement flags must be boolean')
    need(r.inputTokens === null || (Number.isSafeInteger(r.inputTokens) && (r.inputTokens as number) > 0), 'requirements.inputTokens must be a positive integer or null')
    need(Array.isArray(r.unresolved) && r.unresolved.every(x => typeof x === 'string' && x.length > 0), 'requirements.unresolved must list strings')
  }
  if (!isObject(env)) e.push('environment must be an object'); else
    for (const f of ['id', 'harnessVersion', 'proxyVersion', 'requestPath']) need(env[f] === null || isId(env[f]), `environment.${f} must be a string or null`)
  if (!isObject(res)) e.push('resources must be an object'); else {
    need(strings(res.restrictedProviders) && strings(res.exhaustedModels), 'resources lists are invalid')
    const b = res.hardBudget
    need(b === null || (isObject(b) && oneOf(b.accounting, ['reliable', 'unavailable']) && typeof b.permits === 'boolean'), 'resources.hardBudget is invalid')
  }
  const f = s.fallback
  if (f !== null) need(isObject(f) && isId(f.authorizationRef) && isId(f.lineageId) && isId(f.policyRevision) &&
    isObject(f.from) && isId(f.from.modelId) && isEffortToken(f.from.effort) && oneOf(f.purpose, ['execution', 'review']) &&
    Array.isArray(f.roles) && f.roles.length > 0 && f.roles.every(x => oneOf(x, TASK_ROLES)) &&
    strings(f.ruleIds) && typeof f.coversPins === 'boolean' && strings(f.alternatives) &&
    Array.isArray(f.failures) && f.failures.every(x => oneOf(x, REASON_CODES)) && Number.isSafeInteger(f.maxSubstitutions) &&
    (f.maxSubstitutions as number) >= 0 && (f.maxSubstitutions as number) <= 1 &&
    Number.isSafeInteger(f.used) && (f.used as number) >= 0 && typeof f.allowProviderChange === 'boolean' && typeof f.allowFamilyChange === 'boolean', 'fallback is invalid')
  need(isTimestamp(s.now), 'now must be a UTC timestamp')
  return e
}

// Fingerprints --------------------------------------------------------------
/** JSON with sorted object keys and no whitespace. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  if (isObject(v)) return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`
  return JSON.stringify(v)
}
/**
 * Deterministic 53-bit fingerprint (cyrb53) of canonical JSON.
 * ponytail: not collision-resistant; identifies replay inputs, not a security digest.
 * Artifact revisions (phase 6) need SHA-256 through an adapter.
 */
export function fingerprint(v: unknown): string {
  const text = canonicalJson(v)
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57
  for (let i = 0; i < text.length; i++) {
    const ch = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0')
}

/** Catalog schema and validation. No network, credentials, or filesystem access. */
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

/** Return all diagnostics so an editor can fix a catalog in one pass. */
export function validateCatalog(input: unknown): string[] {
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

export function parseCatalog(input: unknown): ModelCatalog {
  const errors = validateCatalog(input)
  if (errors.length) throw new Error(`Invalid model catalog:\n${errors.join('\n')}`)
  // Own the returned data: callers cannot mutate the input through the result.
  return structuredClone(input) as ModelCatalog
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

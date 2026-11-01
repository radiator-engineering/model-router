/** Purpose-aware pin intent and assignment snapshots. Pure data; no host or Node APIs. */
import {PIN_SCOPES, isId, isObject} from './contract.ts'
import type {Pin, PinScope, Purpose} from './contract.ts'

export const PIN_STATE_VERSION = 2
export const MAX_PIN_ASSIGNMENTS = 64
export type PinField = 'model' | 'effort'
export type IntentScope = 'next' | 'session'
export interface PinIntent {
  field: PinField
  value: string | number
  scope: IntentScope
  purpose: Purpose | null
  origin: 'router-command' | 'coordinator' | 'unknown'
  source: string
  experimental: boolean
}
export interface AssignmentPins {
  id: string
  purpose: Purpose
  pins: Pin[]
  /** Unknown native intent is diagnostic data, never authority in `pins`. */
  unknownOrigins: PinField[]
}
export interface PinState {
  schemaVersion: 2
  conversationId: string
  pins: PinIntent[]
  assignments: AssignmentPins[]
}

const purpose = (v: unknown): v is Purpose => v === 'execution' || v === 'review'
const field = (v: unknown): v is PinField => v === 'model' || v === 'effort'
const value = (f: unknown, v: unknown) => isId(v) || (f === 'effort' && Number.isSafeInteger(v) && Number(v) >= 0)
const validPin = (p: unknown): p is Pin => isObject(p) && field(p.field) && value(p.field, p.value) &&
  PIN_SCOPES.includes(p.scope as PinScope) && purpose(p.purpose) && isId(p.source) && typeof p.experimental === 'boolean'

export function emptyPinState(conversationId: string): PinState {
  if (!isId(conversationId)) throw new Error('conversation identity unavailable')
  return {schemaVersion: 2, conversationId, pins: [], assignments: []}
}

/** Undefined means no record. Invalid/foreign data is never silently overwritten. */
export function parsePinState(input: unknown, conversationId: string): PinState {
  if (input === undefined) return emptyPinState(conversationId)
  if (!isObject(input) || (input.schemaVersion !== 1 && input.schemaVersion !== 2) || input.conversationId !== conversationId || !Array.isArray(input.pins))
    throw new Error('invalid pin state or mismatched conversation identity')
  let copy = structuredClone(input)
  if (copy.schemaVersion === 1) {
    // The validated array was cloned above; migrate that copy, not caller-owned metadata.
    const legacyPins = copy.pins as unknown[]
    // Only a known router-owned v1 origin establishes execution intent.
    copy = {...copy, schemaVersion: 2, assignments: [], pins: legacyPins.map((p: unknown) => {
      if (!isObject(p)) return p
      const known = p.source === 'router-command'
      return {...p, origin: known ? 'router-command' : 'unknown', purpose: known ? 'execution' : null, experimental: p.experimental ?? false}
    })}
  }
  if (!isId(copy.conversationId) || !Array.isArray(copy.pins) || !Array.isArray(copy.assignments) || copy.assignments.length > MAX_PIN_ASSIGNMENTS ||
      !copy.pins.every((p: unknown) => isObject(p) && field(p.field) && value(p.field, p.value) &&
        ['next', 'session'].includes(p.scope as string) && isId(p.source) && typeof p.experimental === 'boolean' &&
        (p.origin === 'unknown' ? p.purpose === null : ['router-command', 'coordinator'].includes(p.origin as string) && purpose(p.purpose))))
    throw new Error('invalid version-2 pin state')
  const ids = new Set<string>()
  for (const a of copy.assignments) {
    if (!isObject(a) || !isId(a.id) || ids.has(a.id) || !purpose(a.purpose) || !Array.isArray(a.pins) ||
        !a.pins.every(p => validPin(p) && p.purpose === a.purpose) || !Array.isArray(a.unknownOrigins) || !a.unknownOrigins.every(field))
      throw new Error('invalid assignment pin snapshot')
    ids.add(a.id)
  }
  return copy as unknown as PinState
}

/** An explicit router control replaces only its own purpose/field/scope. */
export function changePin(state: PinState, change: {field: PinField; value: string | number | null; scope: IntentScope}): PinState {
  const next = parsePinState(state, state.conversationId)
  if (!field(change.field) || !['next', 'session'].includes(change.scope) || (change.value !== null && !value(change.field, change.value)))
    throw new Error('invalid pin change')
  next.pins = next.pins.filter(p => !(p.field === change.field && p.scope === change.scope && p.purpose === 'execution' && p.origin === 'router-command'))
  if (change.value !== null) next.pins.push({...change, value: change.value, purpose: 'execution', origin: 'router-command', source: 'router-command', experimental: false})
  return next
}

/** Reused by policy: field-wise scope precedence, with no arbitrary conflict winner. */
export function resolvePinFields(pins: readonly Pin[], assignmentPurpose: Purpose): {
  fields: Partial<Record<PinField, Pin>>
  conflict: {field: PinField; scope: PinScope; pins: Pin[]} | null
} {
  const fields: Partial<Record<PinField, Pin>> = {}
  for (const f of ['model', 'effort'] as const) for (const scope of PIN_SCOPES) {
    const matches = pins.filter(p => p.purpose === assignmentPurpose && p.field === f && p.scope === scope)
    if (new Set(matches.map(p => JSON.stringify([p.value, p.experimental]))).size > 1)
      return {fields, conflict: {field: f, scope, pins: matches}}
    if (matches.length) { fields[f] = matches[0]; break }
  }
  return {fields, conflict: null}
}

/**
 * Called only by a trusted adapter with an established assignment association.
 * Commands/notifications do not bind or consume; delegated and review work do
 * not consume execution `next` intent. No text classification mints this input.
 */
export function bindAssignmentPins(state: PinState, input: {
  conversationId: string; id: string; purpose: Purpose
  kind: 'user' | 'delegated' | 'review' | 'control' | 'notification'
}, persistentPins: readonly Pin[] = [], assignmentPins: readonly Pin[] = []): {state: PinState; binding: AssignmentPins | null} {
  const next = parsePinState(state, input.conversationId)
  if (!isId(input.id) || !purpose(input.purpose) || !['user', 'delegated', 'review', 'control', 'notification'].includes(input.kind) ||
      (input.kind === 'review' ? input.purpose !== 'review' : ['user', 'delegated'].includes(input.kind) && input.purpose !== 'execution'))
    throw new Error('invalid assignment association')
  if (input.kind === 'control' || input.kind === 'notification') return {state: next, binding: null}
  const existing = next.assignments.find(a => a.id === input.id)
  if (existing) {
    if (existing.purpose !== input.purpose) throw new Error('assignment purpose changed')
    return {state: next, binding: structuredClone(existing)}
  }
  // ponytail: at most 64 active bindings; the adapter must release ended assignments, never evict live pins.
  if (next.assignments.length === MAX_PIN_ASSIGNMENTS) throw new Error('active assignment pin limit reached')
  if (!persistentPins.every(p => validPin(p) && p.scope === 'persistent') || !assignmentPins.every(p => validPin(p) && p.scope === 'assignment'))
    throw new Error('invalid trusted pin inputs')
  const takeNext = input.kind === 'user' && input.purpose === 'execution'
  const applicable = next.pins.filter(p => (p.scope === 'session' || takeNext) && (p.purpose === input.purpose || p.origin === 'unknown'))
  const binding: AssignmentPins = {
    id: input.id, purpose: input.purpose,
    pins: [
      ...applicable.filter(p => p.origin !== 'unknown').map(p => ({field: p.field, value: p.value,
        scope: p.scope === 'next' ? 'assignment' as const : 'session' as const, purpose: input.purpose, source: p.source, experimental: p.experimental})),
      ...persistentPins.filter(p => p.purpose === input.purpose), ...assignmentPins.filter(p => p.purpose === input.purpose),
    ],
    unknownOrigins: [...new Set(applicable.filter(p => p.origin === 'unknown').map(p => p.field))],
  }
  next.assignments.push(structuredClone(binding))
  if (takeNext) next.pins = next.pins.filter(p => !(p.scope === 'next' && p.purpose === 'execution' && p.origin !== 'unknown'))
  return {state: next, binding: structuredClone(binding)}
}

export function releaseAssignmentPins(state: PinState, assignmentId: string): PinState {
  const next = parsePinState(state, state.conversationId)
  next.assignments = next.assignments.filter(a => a.id !== assignmentId)
  return next
}

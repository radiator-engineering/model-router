import {expect, test} from 'claude-code/testing'
import {throws} from 'node:assert/strict'
import {bindAssignmentPins, changePin, emptyPinState, MAX_PIN_ASSIGNMENTS, parsePinState, releaseAssignmentPins, resolvePinFields} from '../hooks/v2/pins.ts'
import type {PinIntent} from '../hooks/v2/pins.ts'
import type {Pin} from '../hooks/v2/contract.ts'

const pin = (field: Pin['field'], value: Pin['value'], scope: Pin['scope'], purpose: Pin['purpose'] = 'execution'): Pin =>
  ({field, value, scope, purpose, source: 'coordinator', experimental: false})
const intent = (field: PinIntent['field'], value: PinIntent['value'], scope: PinIntent['scope'] = 'next'): PinIntent =>
  ({field, value, scope, purpose: 'execution', origin: 'router-command', source: 'router-command', experimental: false})
const user = (id = 'author') => ({conversationId: 'conversation', id, purpose: 'execution' as const, kind: 'user' as const})
const pending = () => ({...emptyPinState('conversation'), pins: [intent('model', 'next-model'), intent('effort', 4096)]})

test('resolvePinFields applies assignment, session and persistent precedence independently per field', () => {
  const persistent = [pin('model', 'persistent-model', 'persistent'), pin('effort', 'low', 'persistent')]
  const session = [pin('model', 'session-model', 'session'), pin('effort', 'medium', 'session')]
  for (const [pins, model, effort] of [
    [persistent, 'persistent-model', 'low'],
    [[...persistent, session[0]], 'session-model', 'low'],
    [[...persistent, ...session, pin('model', 'assignment-model', 'assignment')], 'assignment-model', 'medium'],
    [[...persistent, ...session, pin('effort', 4096, 'assignment')], 'session-model', 4096],
  ] as [Pin[], string, string | number][]) {
    for (const order of [pins, [...pins].reverse()]) {
      const result = resolvePinFields(order, 'execution')
      expect(result.conflict).toBeNull()
      expect(result.fields.model?.value).toBe(model)
      expect(result.fields.effort?.value).toBe(effort)
    }
  }
  expect(resolvePinFields([], 'execution')).toEqual({fields: {}, conflict: null})
})

test('same-scope literal or experimental conflicts have no arbitrary winner; identical duplicates agree', () => {
  const numeric = pin('effort', 4096, 'session'), text = pin('effort', '4096', 'session')
  for (const pins of [[numeric, text], [text, numeric], [numeric, {...numeric, experimental: true}]]) {
    const result = resolvePinFields(pins, 'execution')
    expect(result.conflict).toEqual({field: 'effort', scope: 'session', pins})
    expect(result.fields.effort).toBeUndefined()
  }
  expect(resolvePinFields([numeric, {...numeric, source: 'router-command'}], 'execution').conflict).toBeNull()
  const specific = pin('effort', 'high', 'assignment')
  expect(resolvePinFields([numeric, text, specific], 'execution')).toEqual({fields: {effort: specific}, conflict: null})
})

test('execution intent cannot choose a reviewer; trusted review assignment pins resolve separately', () => {
  const state = pending()
  state.pins.push(intent('effort', 'medium', 'session'))
  const review = pin('model', 'review-model', 'assignment', 'review')
  const result = bindAssignmentPins(state, {...user('review'), purpose: 'review', kind: 'review'},
    [pin('effort', 'high', 'persistent', 'review'), pin('model', 'author-model', 'persistent')],
    [review, pin('effort', 'low', 'assignment')])
  expect(result.binding?.pins).toEqual([pin('effort', 'high', 'persistent', 'review'), review])
  expect(result.state.pins).toEqual(state.pins)
  const resolved = resolvePinFields([pin('model', 'author-model', 'assignment'), review], 'review')
  expect(resolved).toEqual({fields: {model: review}, conflict: null})
})

test('changePin replaces or clears only router execution intent at the requested field and scope', () => {
  const keep: PinIntent[] = [intent('model', 'next-model'), intent('effort', 0, 'session'),
    {...intent('model', 'review-model', 'session'), purpose: 'review', origin: 'coordinator'},
    {...intent('model', 'native-model', 'session'), purpose: null, origin: 'unknown'}]
  const state = {...emptyPinState('conversation'), pins: [...keep, intent('model', 'old-model', 'session')]}
  const changed = changePin(state, {field: 'model', value: 'new-model', scope: 'session'})
  expect(changed.pins).toEqual([...keep, intent('model', 'new-model', 'session')])
  expect(changePin(changed, {field: 'model', value: null, scope: 'session'}).pins).toEqual(keep)
  expect(state.pins.at(-1)?.value).toBe('old-model')
})

test('eligible user execution consumes next model and effort once and snapshots them as assignment pins', () => {
  const state = pending(), session = intent('effort', 'medium', 'session')
  state.pins.push(session)
  const first = bindAssignmentPins(state, user())
  expect(first.binding?.pins).toEqual([
    {...pin('model', 'next-model', 'assignment'), source: 'router-command'},
    {...pin('effort', 4096, 'assignment'), source: 'router-command'},
    {...pin('effort', 'medium', 'session'), source: 'router-command'},
  ])
  expect(first.state.pins).toEqual([session])
  const second = bindAssignmentPins(first.state, user('second'))
  expect(second.binding?.pins).toEqual([{...pin('effort', 'medium', 'session'), source: 'router-command'}])
  expect(state.pins.length).toBe(3)
})

test('control, notification, delegated and review associations do not consume execution next intent', () => {
  for (const kind of ['control', 'notification', 'delegated', 'review'] as const) {
    const state = pending()
    const result = bindAssignmentPins(state, {...user(kind), kind, purpose: kind === 'review' ? 'review' : 'execution'})
    expect(result.state.pins).toEqual(state.pins)
    if (kind === 'control' || kind === 'notification') {
      expect(result.binding).toBeNull()
      expect(result.state.assignments).toEqual([])
    } else expect(result.binding?.pins).toEqual([])
    expect(bindAssignmentPins(result.state, user()).state.pins).toEqual([])
  }
})

test('duplicate binding reuses its snapshot and does not consume newly queued next intent', () => {
  const first = bindAssignmentPins(pending(), user())
  const updated = changePin(first.state, {field: 'model', value: 'later-model', scope: 'next'})
  const duplicate = bindAssignmentPins(updated, user(), [pin('model', 'new-persistent', 'persistent')], [pin('effort', 'high', 'assignment')])
  expect(duplicate.binding).toEqual(first.binding)
  expect(duplicate.state).toEqual(updated)
  expect(duplicate.state.assignments.length).toBe(1)
  throws(() => bindAssignmentPins(updated, {...user(), kind: 'review', purpose: 'review'}), /purpose changed/)
})

test('session and persistent changes affect new assignments, never a bound tool-loop snapshot', () => {
  const state = changePin(emptyPinState('conversation'), {field: 'model', value: 'old-session', scope: 'session'})
  const persistent = [pin('effort', 'low', 'persistent')]
  const first = bindAssignmentPins(state, user(), persistent)
  const changed = changePin(first.state, {field: 'model', value: 'new-session', scope: 'session'})
  persistent[0].value = 'high'
  expect(bindAssignmentPins(changed, user(), persistent).binding).toEqual(first.binding)
  const second = bindAssignmentPins(changed, user('second'), persistent)
  expect(resolvePinFields(second.binding!.pins, 'execution').fields.model?.value).toBe('new-session')
  expect(resolvePinFields(second.binding!.pins, 'execution').fields.effort?.value).toBe('high')
  expect(first.binding?.pins.map(p => p.value)).toEqual(['old-session', 'low'])
})

test('persisted API reload preserves same-identity bindings and pending intent; clear or new identity starts empty', () => {
  const bound = bindAssignmentPins(pending(), user())
  const queued = changePin(bound.state, {field: 'effort', value: 0, scope: 'next'})
  const reloaded = parsePinState(JSON.parse(JSON.stringify(queued)), 'conversation')
  expect(reloaded).toEqual(queued)
  expect(bindAssignmentPins(reloaded, user()).binding).toEqual(bound.binding)
  expect(bindAssignmentPins(reloaded, user('second')).binding?.pins[0].value).toBe(0)
  expect(parsePinState(undefined, 'conversation')).toEqual(emptyPinState('conversation'))
  expect(parsePinState(undefined, 'new-conversation')).toEqual(emptyPinState('new-conversation'))
  throws(() => parsePinState(queued, 'new-conversation'), /identity/)
})

test('v1 migration grants execution purpose only to router-command sources, never unknown native origins', () => {
  const legacy = {schemaVersion: 1, conversationId: 'conversation', pins: [
    {field: 'model', value: 'router-model', scope: 'next', source: 'router-command'},
    {field: 'effort', value: 4096, scope: 'session', source: 'native', origin: 'router-command', purpose: 'execution'},
  ]}
  const state = parsePinState(legacy, 'conversation')
  expect(state).toEqual({schemaVersion: 2, conversationId: 'conversation', assignments: [], pins: [
    intent('model', 'router-model'),
    {...intent('effort', 4096, 'session'), source: 'native', origin: 'unknown', purpose: null},
  ]})
  const bound = bindAssignmentPins(state, user())
  expect(bound.binding?.pins.map(p => p.value)).toEqual(['router-model'])
  expect(bound.binding?.unknownOrigins).toEqual(['effort'])
  expect(bindAssignmentPins(state, {...user('review'), kind: 'review', purpose: 'review'}).binding?.pins).toEqual([])
  expect(legacy.schemaVersion).toBe(1)
  const metadata = {schemaVersion:1, conversationId:'conversation', pins:[{field:'model', value:'literal', scope:'session', source:'router-command', metadata:{note:'original'}}]}
  const isolated=parsePinState(metadata,'conversation')
  ;(isolated.pins[0] as any).metadata.note='returned-only'
  expect(metadata.pins[0].metadata.note).toBe('original')
})

test('unknown native intent stays diagnostic, deduplicated and unconsumed across execution and review', () => {
  const unknown = {...intent('model', 'native-model', 'session'), purpose: null, origin: 'unknown'} as const
  const state = {...pending(), pins: [unknown, {...unknown}, {...unknown, scope: 'next' as const}]}
  const author = bindAssignmentPins(state, user())
  expect(author.binding?.pins).toEqual([])
  expect(author.binding?.unknownOrigins).toEqual(['model'])
  expect(author.state.pins).toEqual(state.pins)
  const review = bindAssignmentPins(author.state, {...user('review'), kind: 'review', purpose: 'review'})
  expect(review.binding?.pins).toEqual([])
  expect(review.binding?.unknownOrigins).toEqual(['model'])
  expect(review.state.pins).toEqual(state.pins)
})

test('malformed persisted state is rejected rather than normalized or silently reset', () => {
  const state = pending(), snapshot = bindAssignmentPins(state, user()).state.assignments[0]
  for (const input of [null, [], {}, {...state, schemaVersion: 3}, {...state, pins: null},
    {...state, pins: [{...state.pins[0], value: 4096}]},
    {...state, pins: [{...state.pins[1], value: -1}]},
    {...state, pins: [{...state.pins[1], value: 0.5}]},
    {...state, pins: [{...state.pins[0], origin: 'unknown'}]},
    {...state, pins: [{...state.pins[0], purpose: null}]},
    {...state, pins: [{...state.pins[0], source: ''}]},
    {...state, assignments: [snapshot, snapshot]},
    {...state, assignments: [{...snapshot, purpose: 'review'}]},
    {...state, assignments: [{...snapshot, unknownOrigins: ['budget']}]},
    {...state, schemaVersion: '2'},
  ]) throws(() => parsePinState(input, 'conversation'), `accepted malformed state: ${JSON.stringify(input)}`)
  throws(() => emptyPinState(' '), /identity/)
})

test('invalid changes, associations and trusted pin scopes fail without consuming pending intent', () => {
  const state = pending(), before = structuredClone(state)
  for (const change of [
    {field: 'model', value: 1, scope: 'next'},
    {field: 'effort', value: -1, scope: 'session'},
    {field: 'effort', value: Number.MAX_SAFE_INTEGER + 1, scope: 'next'},
    {field: 'model', value: 'model', scope: 'persistent'},
  ]) throws(() => changePin(state, change as Parameters<typeof changePin>[1]), /invalid pin change/)
  for (const input of [{...user(), id: ''}, {...user(), purpose: 'review' as const},
    {...user(), kind: 'delegated' as const, purpose: 'review' as const},
    {...user(), kind: 'review' as const}, {...user(), conversationId: 'other'}])
    throws(() => bindAssignmentPins(state, input))
  throws(() => bindAssignmentPins(state, user(), [pin('model', 'wrong-scope', 'assignment')]), /trusted pin/)
  throws(() => bindAssignmentPins(state, user(), [], [pin('model', 'wrong-scope', 'session')]), /trusted pin/)
  expect(state).toEqual(before)
})

test('state APIs isolate caller inputs, returned bindings and stored snapshots in both directions', () => {
  const state = pending(), original = structuredClone(state), parsed = parsePinState(state, 'conversation')
  parsed.pins[0].value = 'parsed-only'
  const persistent = [pin('effort', 'low', 'persistent')], assignment = [pin('model', 'explicit', 'assignment')]
  const bound = bindAssignmentPins(state, user(), persistent, assignment)
  const saved = structuredClone(bound.state), expected = structuredClone(bound.binding)
  persistent[0].value = 'external-change'; assignment[0].value = 'external-change'
  bound.binding!.pins[0].value = 'returned-change'
  expect(bound.state).toEqual(saved)
  const duplicate = bindAssignmentPins(bound.state, user())
  bound.state.assignments[0].pins[0].value = 'state-change'
  expect(duplicate.binding).toEqual(expected)
  expect(duplicate.state).toEqual(saved)
  const released = releaseAssignmentPins(duplicate.state, 'missing')
  released.assignments[0].pins[0].value = 'released-only'
  expect(duplicate.state).toEqual(saved)
  expect(state).toEqual(original)
})

test('capacity fails closed without eviction or next consumption; release permits a new binding', () => {
  let state = emptyPinState('conversation')
  for (let i = 0; i < MAX_PIN_ASSIGNMENTS; i++) state = bindAssignmentPins(state, user(`active-${i}`)).state
  state = changePin(state, {field: 'model', value: 'queued-model', scope: 'next'})
  const before = structuredClone(state)
  throws(() => bindAssignmentPins(state, user('overflow')), /limit/)
  expect(state).toEqual(before)
  expect(bindAssignmentPins(state, user('active-0')).binding).toEqual(state.assignments[0])
  expect(bindAssignmentPins(state, {...user('control'), kind: 'control'}).binding).toBeNull()
  throws(() => parsePinState({...state, assignments: [...state.assignments, {...state.assignments[0], id: 'extra'}]}, 'conversation'))
  const released = releaseAssignmentPins(state, 'active-0')
  expect(released.assignments.length).toBe(MAX_PIN_ASSIGNMENTS - 1)
  expect(released.pins).toEqual(state.pins)
  const replacement = bindAssignmentPins(released, user('replacement'))
  expect(replacement.state.assignments.length).toBe(MAX_PIN_ASSIGNMENTS)
  expect(replacement.state.assignments.slice(0, -1)).toEqual(state.assignments.slice(1))
  expect(replacement.binding?.pins[0].value).toBe('queued-model')
  expect(replacement.state.pins).toEqual([])
})

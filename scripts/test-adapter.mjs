import assert from 'node:assert/strict';
export const cases = [];
export function test(name, fn) { cases.push({name, fn}); }
/** Capture the host registration contract, including fail-closed error handlers. */
export function recordHooks(handlers, errors = {}) {
  const registrations = new Map();
  return (name, matcherOrHook, hook = matcherOrHook) => {
    const rows = registrations.get(name) ?? [];
    const row = {hook, matcher: hook === matcherOrHook ? null : matcherOrHook, caught: null};
    rows.push(row); registrations.set(name, rows);
    const applicable = e => rows.filter(r => !r.matcher || Object.entries(r.matcher).every(([k, v]) => e[k] === v));
    const streaming = name === 'turn.step' || name === 'process.spawn';
    handlers[name] = streaming ? async function* ($, e, bottom) {
      const chain = applicable(e);
      async function* run(i, input) {
        const r = chain[i]; if (!r) return yield* bottom(input);
        let called = false, stream;
        const next = value => { called = true; return stream ??= run(i + 1, value); };
        Object.assign(next, {origin: {plugin: 'engine'}, called: false});
        try { return yield* r.hook($, input, next); }
        catch (error) { if (!r.caught) throw error; Object.assign(next, {called, error}); return yield* r.caught($, input, next); }
      }
      return yield* run(0, e);
    } : async ($, e, bottom) => {
      const chain = applicable(e);
      async function run(i, input) {
        const r = chain[i]; if (!r) return bottom(input);
        let called = false, answer;
        const next = value => { called = true; return answer ??= Promise.resolve(run(i + 1, value)); };
        Object.assign(next, {origin: {plugin: 'engine'}, called: false});
        try { return await r.hook($, input, next); }
        catch (error) { if (!r.caught) throw error; Object.assign(next, {called, error}); return r.caught($, input, next); }
      }
      return run(0, e);
    };
    return {catch: handler => { row.caught = handler; errors[name] = handler; }};
  };
}
export function expect(actual) {
  return {
    toBe: expected => assert.strictEqual(actual, expected),
    toEqual: expected => assert.deepStrictEqual(actual, expected),
    toBeNull: () => assert.strictEqual(actual, null),
    toBeUndefined: () => assert.strictEqual(actual, undefined),
    toContain: expected => assert.ok(actual.includes(expected)),
    toBeGreaterThan: expected => assert.ok(actual > expected),
  };
}

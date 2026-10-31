import assert from 'node:assert/strict';
export const cases = [];
export function test(name, fn) { cases.push({name, fn}); }
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

// Shared by scripts/replay-v2.mjs and tests/v2-policy.test.ts. Offline only: no inference.
import {readFile} from 'node:fs/promises';
import {isDeepStrictEqual} from 'node:util';
import {decide} from '../hooks/v2/policy.ts';
import {POLICY} from '../hooks/v2/policy-data.ts';
import {parseCatalogV2} from '../hooks/model-catalog.ts';

const read = async path => JSON.parse(await readFile(new URL(path, import.meta.url), 'utf8'));

/** Fixture cases with the catalog/policy each one names. */
export async function loadReplay() {
  const fixture = await read('../tests/fixtures/v2-decisions.json');
  const sources = {
    synthetic: {catalog: parseCatalogV2(fixture.synthetic.catalog), policy: fixture.synthetic.policy, label: 'synthetic fixture catalog/policy'},
    production: {catalog: parseCatalogV2(await read('../catalog/models.json')), policy: POLICY, label: 'catalog/models.json + hooks/v2/policy-data.ts'},
  };
  if (fixture.schemaVersion !== 1 || !Array.isArray(fixture.cases) || !fixture.cases.length)
    throw new Error('Replay requires schema version 1 and at least one fixed case.');
  const ids = new Set();
  for (const c of fixture.cases) {
    if (typeof c.id !== 'string' || !c.id || ids.has(c.id) || !Object.hasOwn(sources, c.catalog) ||
        !['select', 'preserve', 'clarify', 'unavailable'].includes(c.expected?.outcome))
      throw new Error('Replay cases need unique IDs, a known catalog and a fixed expected outcome.');
    ids.add(c.id);
  }
  return {fixture, sources};
}

/** Differences between a decision and a hand-written expectation. */
export function mismatches(d, e) {
  const out = [];
  const same = (label, actual, expected) => { if (expected !== undefined && !isDeepStrictEqual(actual, expected)) out.push(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`); };
  same('outcome', d.outcome, e.outcome);
  same('reasons', d.reasons, e.reasons);
  for (const r of e.reasonsInclude ?? []) if (!d.reasons.includes(r)) out.push(`reasons: missing ${r} in ${JSON.stringify(d.reasons)}`);
  same('ruleId', d.ruleId, e.ruleId);
  same('qualification', d.qualification, e.qualification);
  same('experimental', d.experimental, e.experimental);
  same('configurationId', d.configuration?.id, e.configurationId);
  same('effort', d.configuration?.effort, e.effort);
  same('changes', d.changes, e.changes);
  same('substitution', d.fallback.substitution, e.substitution);
  same('reservationRequired', d.reservation.required, e.reservationRequired);
  same('review', d.review.disposition, e.review);
  same('candidateIds', d.candidates.map(c => c.configurationId), e.candidateIds);
  return out;
}

/** Decide twice; identical inputs must give identical decisions and candidate order. */
export function runCase(c, sources) {
  const {catalog, policy} = sources[c.catalog];
  const first = decide(c.snapshot, policy, catalog);
  const second = decide(structuredClone(c.snapshot), policy, catalog);
  const problems = mismatches(first, c.expected);
  if (JSON.stringify(first) !== JSON.stringify(second)) problems.push('nondeterministic decision');
  return {decision: first, problems};
}

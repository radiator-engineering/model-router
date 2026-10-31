#!/usr/bin/env node
// Deterministic v2 replay over saved snapshots. No model or network calls.
import {register} from 'node:module';
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
if (process.argv.length > 2) throw new Error('Usage: node scripts/replay-v2.mjs (offline only)');
register('./test-loader.mjs', import.meta.url);
const {loadReplay, runCase} = await import('./v2-replay-lib.mjs');
const {route} = await import('../hooks/policy.ts');
const {projectLegacyCatalog} = await import('../hooks/model-catalog.ts');
const {fingerprint, CONTRACT_VERSION} = await import('../hooks/v2/contract.ts');

const root = fileURLToPath(new URL('../', import.meta.url));
const {fixture, sources} = await loadReplay();
// Basic uses saved tier/effort/risk answers, not catalog admission. Name the
// legacy projection for provenance; do not imply Basic evaluates v2 evidence.
const legacyConfig = {tiers: {fast: 'haiku', balanced: 'sonnet', deep: 'opus'}, minUpgradeConfidence: 0.3, minDowngradeConfidence: 0.6};
const legacyProjection = projectLegacyCatalog(sources.production.catalog);
const results = fixture.cases.map(c => {
  const {decision, problems} = runCase(c, sources);
  const legacy = 'legacy' in c ? route(c.legacy, {model: c.snapshot.current.model ?? '', effort: c.snapshot.current.effort ?? undefined}, legacyConfig) : undefined;
  return {id: c.id, catalog: c.catalog, example: c.example, status: problems.length ? 'fail' : 'pass', problems,
    v2: {outcome: decision.outcome, reasons: decision.reasons, configuration: decision.configuration?.id ?? null, review: decision.review.disposition},
    decision, ...(legacy !== undefined ? {legacyBasic: legacy} : {})};
});
for (const r of results) console.log(`${r.status.toUpperCase()} [${r.catalog}] ${r.id}: ${r.v2.outcome} ${r.v2.reasons.join(',')}${r.problems.length ? '\n  ' + r.problems.join('\n  ') : ''}`);
const counts = {};
for (const r of results) counts[`${r.catalog}/${r.v2.outcome}`] = (counts[`${r.catalog}/${r.v2.outcome}`] ?? 0) + 1;
const failed = results.filter(r => r.status !== 'pass');
let commit = null, dirty = null;
try {
  const git = (...args) => execFileSync('git', args, {cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim();
  commit = git('rev-parse', 'HEAD'); dirty = Boolean(git('status', '--porcelain'));
} catch { /* A source snapshot may have no git metadata; leave it unknown. */ }
const fingerprints = {};
for (const file of ['.claude-plugin/plugin.json', 'catalog/models.json', 'hooks/model-catalog.ts', 'hooks/policy.ts', 'hooks/task-routing.ts', 'hooks/v2/contract.ts', 'hooks/v2/classifier.ts', 'hooks/v2/policy.ts', 'hooks/v2/policy-data.ts', 'scripts/replay-v2.mjs', 'scripts/v2-replay-lib.mjs', 'tests/fixtures/v2-decisions.json'])
  fingerprints[file] = createHash('sha256').update(await readFile(path.join(root, file))).digest('hex');
const plugin = JSON.parse(await readFile(path.join(root, '.claude-plugin/plugin.json'), 'utf8'));
const report = {
  schemaVersion: 1, generatedAt: new Date().toISOString(), inference: 'none',
  provenance: {commit, dirty, node: process.version, pluginVersion: plugin.version, contractVersion: CONTRACT_VERSION,
    observedHarnessVersion: null, observedProxyVersion: null, fingerprints},
  sources: Object.fromEntries(Object.entries(sources).map(([k, s]) => [k, {label: s.label, policyRevision: s.policy.policyRevision, policyFingerprint: fingerprint(s.policy), catalogRevision: fingerprint(s.catalog)}])),
  engines: {applied: null, proposed: 'v2', legacyBaselineMode: 'basic'},
  legacyProjection: {label: 'production catalog v2.legacy via projectLegacyCatalog', models: legacyProjection.models.length, tiers: legacyConfig.tiers},
  counterfactualCompletion: 'not measured: replay compares decisions only, not task outcomes',
  summary: {passed: results.length - failed.length, total: results.length, outcomes: counts}, results,
};
await mkdir(path.join(root, 'test-results'), {recursive: true});
const file = path.join(root, 'test-results', `replay-v2-${report.generatedAt.replace(/[:.]/g, '-')}.json`);
await writeFile(file, JSON.stringify(report, null, 2) + '\n');
console.log(`Replay: ${report.summary.passed}/${report.summary.total} fixed outcomes; ${JSON.stringify(counts)}`);
console.log('Counterfactual completion evidence: none (decision replay only).');
console.log(`Report: ${file}`);
process.exitCode = failed.length ? 1 : 0;

#!/usr/bin/env node
import {register} from 'node:module';
import {readFile, mkdir, writeFile, readdir} from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import os from 'node:os';
import {performance} from 'node:perf_hooks';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.some(x => !['--live', '--tasks', '--v2', '--help'].includes(x))) throw new Error('Usage: node scripts/smoke.mjs [--live] [--tasks|--v2]');
if (args.includes('--help')) {
  console.log('node scripts/smoke.mjs [--live] [--tasks|--v2]\nOffline: policy, catalog and task-hook tests. Live: also classify fixed prompts using TypeSafe. --tasks: legacy role/category questions. --v2: v2 role coverage/confidence only; no task execution.\nJEV_API_KEY overrides plugin settings; JEV_MODEL optionally pins the model.');
  process.exit(0);
}
const live = args.includes('--live');
const tasks = args.includes('--tasks'),v2=args.includes('--v2');
if(v2&&(!live||tasks))throw new Error('--v2 requires --live and cannot be combined with --tasks');
const mode = live ? (v2?'live-v2':tasks ? 'live-tasks' : 'live') : 'offline';
register('./test-loader.mjs', import.meta.url);
const {cases} = await import('./test-adapter.mjs');
const policy = await import('../hooks/policy.ts');
const hash = text => createHash('sha256').update(text).digest('hex');
const {v2RequestBody,normalizeV2Response}=await import('../hooks/v2/classifier.ts');
const {normalizeUsage}=await import('../hooks/v2/records.ts');
const fixturesText = await readFile(path.join(root, v2?'tests/fixtures/v2-classification.json':'tests/fixtures/smoke.json'), 'utf8');
const fixtures = v2?JSON.parse(fixturesText).cases:JSON.parse(fixturesText).filter(x=>tasks || !x.taskOnly);
const {recommendTask} = await import('../hooks/task-routing.ts');
const {parseCatalog} = await import('../hooks/model-catalog.ts');
// Legacy consumers receive the validated legacy projection, never raw v2 JSON.
const catalog = parseCatalog(JSON.parse(await readFile(path.join(root,'catalog/models.json'),'utf8')));
const git = (...a) => execFileSync('git', a, {cwd:root, encoding:'utf8'}).trim();
const policyHash = hash(await readFile(path.join(root, 'hooks/policy.ts')));
const startedAt = new Date().toISOString();
const id = startedAt.replace(/[:.]/g, '-') + '-' + mode + '-' + process.pid;
const report = {
  schemaVersion:1, id, startedAt, mode,
  commit:git('rev-parse', 'HEAD'), dirty:Boolean(git('status', '--porcelain')),
  node:process.version, policyHash, fixtureHash:hash(fixturesText),
  questionsHash:hash(JSON.stringify(JSON.parse(v2?v2RequestBody('typesafe',{prompt:''},'hash'):policy.requestBody('typesafe',{},'hash',tasks)).questions)),
  suiteHash:hash(await readFile(path.join(root, 'tests/policy.test.ts'))),
  controlsCodeHash:hash(await readFile(path.join(root,'hooks/router-controls.ts'))),
  controlsSuiteHash:hash(await readFile(path.join(root,'tests/router-controls.test.ts'))),
  taskCodeHash:hash(await readFile(path.join(root,'hooks/task-routing.ts'))),
  taskSuiteHash:hash(await readFile(path.join(root,'tests/task-routing.test.ts'))),
  taskHookHash:hash(await readFile(path.join(root,'hooks/jev-model-router.ts'))),
  catalogHash:hash(await readFile(path.join(root, 'catalog/models.json'))),
  catalogCodeHash:hash(await readFile(path.join(root, 'hooks/model-catalog.ts'))),
  catalogSuiteHash:hash(await readFile(path.join(root, 'tests/catalog.test.ts'))),
  runnerHash:hash(await readFile(fileURLToPath(import.meta.url))),
  tests:[], classifications:[],
};
// Each suite must register cases; a runner that never imported a suite is not verification.
const SUITES = ['policy', 'catalog', 'task-routing', 'router-controls', 'legacy-regression', 'v2-classifier', 'v2-policy', 'v2-pins', 'v2-harness', 'v2-artifacts', 'v2-verification', 'v2-review'];
report.suites = [];
for (const suite of SUITES) {
  const file = `tests/${suite}.test.ts`;
  const before = cases.length;
  await import(`../${file}`);
  for (const c of cases.slice(before)) c.suite = suite;
  report.suites.push({suite, file, hash:hash(await readFile(path.join(root, file))), cases:cases.length-before});
}
for (const {name, fn, suite} of cases) {
  const start = performance.now();
  try { await fn(); report.tests.push({name, suite, status:'pass', latencyMs:performance.now()-start}); }
  catch (error) { report.tests.push({name, suite, status:'fail', error:String(error.message), latencyMs:performance.now()-start}); }
}
for (const s of report.suites) if (!s.cases) report.tests.push({name:`${s.suite} registered no cases`, suite:s.suite, status:'fail', latencyMs:0});
report.fingerprints = {};
for (const file of ['.claude-plugin/plugin.json', 'types/router-state.d.ts', 'hooks/v2/pins.ts', 'hooks/v2/harness.ts', 'hooks/v2/records.ts', 'hooks/v2/artifacts.ts', 'hooks/v2/verification.ts', 'hooks/v2/review.ts', 'hooks/v2/review-harness.ts', 'hooks/v2/native-review.ts', 'scripts/test-v2-native.mjs', 'scripts/test-v2-live.mjs', 'tests/native-v2/helpers.ts', 'tests/native-v2/contracts.test.ts', 'tests/native-v2/review.test.ts', 'hooks/v2/contract.ts', 'hooks/v2/classifier.ts', 'hooks/v2/policy.ts', 'hooks/v2/policy-data.ts', 'scripts/build-catalog.mjs', 'scripts/test-adapter.mjs', 'scripts/v2-replay-lib.mjs', 'scripts/replay-v2.mjs', 'tests/fixtures/v2-decisions.json', 'tests/fixtures/v2-classification.json', 'tests/fixtures/legacy-regression.json', 'tests/fixtures/catalog-v1-migration.json', 'tests/fixtures/catalog-v2-migrated.json'])
  report.fingerprints[file] = hash(await readFile(path.join(root, file)));
if (live) {
  let options = {};
  try {
    const settings = JSON.parse(await readFile(path.join(os.homedir(), '.claude/settings.json'), 'utf8'));
    options = settings.pluginConfigs?.['jev-model-router']?.options ?? {};
  } catch (error) { if (!process.env.JEV_API_KEY) throw new Error('Cannot load Jev settings; set JEV_API_KEY.'); }
  const key = process.env.JEV_API_KEY || options.typesafeApiKey;
  if (!key) throw new Error('Missing TypeSafe key: set JEV_API_KEY or configure the plugin.');
  const model = process.env.JEV_MODEL || options.typesafeModel || policy.DEFAULT_MODEL.typesafe;
  // Never send a stored API key to a custom endpoint from a smoke-test override.
  const url = 'https://api.typesafe.ai/v1/systemone';
  report.requestedModel = model;
  report.provider = 'typesafe';
  for (const fixture of fixtures) {
    const start = performance.now();
    const result = {id:fixture.id, expected:v2?{role:fixture.expected.role}:{tier:fixture.tier, risky:fixture.risky, ...(tasks ? {task:fixture.task ?? null} : {})}};
    try {
      const response = await fetch(url, {
        method:'POST', headers:policy.requestHeaders('typesafe', key, model),
        body:v2?v2RequestBody('typesafe',{prompt:fixture.prompt},model):policy.requestBody('typesafe', {prompt:fixture.prompt}, model, tasks),
        signal:AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
      if(v2){
        const observation=normalizeV2Response(text);if(!observation)throw new Error('Invalid v2 classification')
        const payload=JSON.parse(text);result.observation=observation;result.actualModel=payload.model??null;result.usage=normalizeUsage(payload.usage)
        result.roleCorrect=observation.role.value===fixture.expected.role;result.confidentRole=observation.role.confidence!==null&&observation.role.confidence>=.8
        result.status=result.roleCorrect?'pass':'fail'
      }else{
      const decision = policy.readDecision(text);
      if (!decision) throw new Error('Response contained no valid decision');
      const payload = JSON.parse(text);
      result.decision = decision;
      result.actualModel = payload.model ?? null;
      result.usage = payload.usage ?? null;
      result.routing = policy.route(decision, {model:'sonnet', effort:'medium'}, {
        tiers:{fast:'haiku', balanced:'sonnet', deep:'opus'}, minUpgradeConfidence:0.3, minDowngradeConfidence:0.6,
      });
      result.tierCorrect = fixture.tier === null ? null : decision.tier === fixture.tier;
      result.riskCorrect = decision.risky === null ? false : (decision.risky > 0.7) === fixture.risky;
      result.taskCorrect = tasks && fixture.task ? decision.task?.role===fixture.task.role && decision.task?.implementationCategory===fixture.task.category : null;
      if(tasks) result.recommendation=recommendTask(decision.task ?? null,catalog,undefined,.8,(decision.risky ?? 0)>.7);
      result.status = result.tierCorrect !== false && result.riskCorrect && result.taskCorrect!==false ? 'pass' : 'fail';
      }
    } catch (error) {
      result.status = 'error';
      // Do not save request headers, keys, raw response bodies or settings.
      result.error = error.name === 'TimeoutError' ? 'Request timed out' :
        /^HTTP \d+$/.test(error.message) ? error.message : 'Request or response processing failed';
    }
    result.latencyMs = performance.now()-start;
    report.classifications.push(result);
    console.log(`${result.status.toUpperCase()} ${fixture.id}: ${v2?result.observation?.role.value??result.error:result.decision?.tier??result.error}`);
    if(v2&&result.status==='error'&&/^HTTP (401|403|429)$/.test(result.error))break;
  }
}
const failed = report.tests.filter(x => x.status !== 'pass');
for (const t of failed) console.error(`FAIL [${t.suite}] ${t.name}: ${t.error ?? 'no cases registered'}`);
report.summary = {
  policyPassed:report.tests.length-failed.length, policyTotal:report.tests.length,
  livePassed:report.classifications.filter(x=>x.status==='pass').length,
  liveTotal:report.classifications.length,
  liveErrors:report.classifications.filter(x=>x.status==='error').length,
  tierChecks:report.classifications.filter(x=>x.tierCorrect!==null && x.tierCorrect!==undefined).length,
  tierCorrect:report.classifications.filter(x=>x.tierCorrect===true).length,
  riskCorrect:report.classifications.filter(x=>x.riskCorrect===true).length,
  taskChecks:report.classifications.filter(x=>x.taskCorrect!==null && x.taskCorrect!==undefined).length,
  taskCorrect:report.classifications.filter(x=>x.taskCorrect===true).length,
  roleChecks:report.classifications.filter(x=>typeof x.roleCorrect==='boolean').length,
  roleCorrect:report.classifications.filter(x=>x.roleCorrect===true).length,
  confidentRoles:report.classifications.filter(x=>x.confidentRole===true).length,
  unexpectedUnknowns:report.classifications.filter(x=>x.observation?.role.value==='unknown'&&x.expected.role!=='unknown').length,
  meanLatencyMs:report.classifications.length ? report.classifications.reduce((n,x)=>n+x.latencyMs,0)/report.classifications.length : null,
  meanTierConfidence: (()=>{
    const values=report.classifications.map(x=>x.decision?.confidence).filter(x=>typeof x==='number');
    return values.length ? values.reduce((a,b)=>a+b,0)/values.length : null;
  })(),
};
const resultsDir = path.join(root, 'test-results');
await mkdir(resultsDir, {recursive:true});
const files = (await readdir(resultsDir)).filter(x=>x.endsWith(`-${mode}.json`)).sort();
if (files.length) {
  const previous = JSON.parse(await readFile(path.join(resultsDir, files.at(-1)), 'utf8'));
  report.comparison = {previousRun:previous.id, sameFixtures:previous.fixtureHash===report.fixtureHash,
    sameQuestions:previous.questionsHash===report.questionsHash,
    sameRequestedModel:previous.requestedModel===report.requestedModel,
    previousSummary:previous.summary,
    changedTests:report.tests.filter(t=>previous.tests.some(p=>p.name===t.name && p.status!==t.status)).map(t=>({name:t.name,status:t.status})),
    changedClassifications:report.classifications.flatMap(t=>{
      const p=previous.classifications.find(p=>p.id===t.id);
      return p && JSON.stringify(p.decision)!==JSON.stringify(t.decision) ? [{id:t.id,before:p.decision,after:t.decision}] : [];
    }),
  };
}
const filename = `${id}-${mode}.json`;
await writeFile(path.join(resultsDir, filename), JSON.stringify(report,null,2)+'\n');
await writeFile(path.join(resultsDir, `latest-${mode}.txt`), filename+'\n');
console.log('Suites: '+report.suites.map(s=>`${s.suite} ${s.cases}`).join(', '));
console.log(`Local tests: ${report.summary.policyPassed}/${report.summary.policyTotal}; live: ${report.summary.livePassed}/${report.summary.liveTotal}`);
console.log(`Report: ${path.join(resultsDir,filename)}`);
if (report.comparison) console.log(`Compared with ${report.comparison.previousRun}: ${report.comparison.changedTests.length} changed test results, ${report.comparison.changedClassifications.length} changed decisions.`);
process.exitCode = failed.length || report.classifications.some(x=>x.status!=='pass') ? 1 : 0;

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
if (args.some(x => !['--live', '--tasks', '--help'].includes(x))) throw new Error('Usage: node scripts/smoke.mjs [--live] [--tasks]');
if (args.includes('--help')) {
  console.log('node scripts/smoke.mjs [--live] [--tasks]\nOffline: policy, catalog and task-hook tests. Live: also classify fixed prompts using TypeSafe. --tasks: evaluate the new role/category questions.\nJEV_API_KEY overrides plugin settings; JEV_MODEL optionally pins the model.');
  process.exit(0);
}
const live = args.includes('--live');
const tasks = args.includes('--tasks');
const mode = live ? (tasks ? 'live-tasks' : 'live') : 'offline';
register('./test-loader.mjs', import.meta.url);
const {cases} = await import('./test-adapter.mjs');
const policy = await import('../hooks/policy.ts');
const hash = text => createHash('sha256').update(text).digest('hex');
const fixturesText = await readFile(path.join(root, 'tests/fixtures/smoke.json'), 'utf8');
const fixtures = JSON.parse(fixturesText).filter(x=>tasks || !x.taskOnly);
const {recommendTask} = await import('../hooks/task-routing.ts');
const catalog = JSON.parse(await readFile(path.join(root,'catalog/models.json'),'utf8'));
const git = (...a) => execFileSync('git', a, {cwd:root, encoding:'utf8'}).trim();
const policyHash = hash(await readFile(path.join(root, 'hooks/policy.ts')));
const startedAt = new Date().toISOString();
const id = startedAt.replace(/[:.]/g, '-') + '-' + mode + '-' + process.pid;
const report = {
  schemaVersion:1, id, startedAt, mode,
  commit:git('rev-parse', 'HEAD'), dirty:Boolean(git('status', '--porcelain')),
  node:process.version, policyHash, fixtureHash:hash(fixturesText),
  questionsHash:hash(JSON.stringify(JSON.parse(policy.requestBody('typesafe',{},'hash',tasks)).questions)),
  suiteHash:hash(await readFile(path.join(root, 'tests/policy.test.ts'))),
  taskCodeHash:hash(await readFile(path.join(root,'hooks/task-routing.ts'))),
  taskSuiteHash:hash(await readFile(path.join(root,'tests/task-routing.test.ts'))),
  taskHookHash:hash(await readFile(path.join(root,'hooks/jev-model-router.ts'))),
  catalogHash:hash(await readFile(path.join(root, 'catalog/models.json'))),
  catalogCodeHash:hash(await readFile(path.join(root, 'hooks/model-catalog.ts'))),
  catalogSuiteHash:hash(await readFile(path.join(root, 'tests/catalog.test.ts'))),
  runnerHash:hash(await readFile(fileURLToPath(import.meta.url))),
  tests:[], classifications:[],
};
await import('../tests/policy.test.ts');
await import('../tests/catalog.test.ts');
await import('../tests/task-routing.test.ts');
for (const {name, fn} of cases) {
  const start = performance.now();
  try { await fn(); report.tests.push({name, status:'pass', latencyMs:performance.now()-start}); }
  catch (error) { report.tests.push({name, status:'fail', error:String(error.message), latencyMs:performance.now()-start}); }
}
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
    const result = {id:fixture.id, expected:{tier:fixture.tier, risky:fixture.risky, ...(tasks ? {task:fixture.task ?? null} : {})}};
    try {
      const response = await fetch(url, {
        method:'POST', headers:policy.requestHeaders('typesafe', key, model),
        body:policy.requestBody('typesafe', {prompt:fixture.prompt}, model, tasks),
        signal:AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const text = await response.text();
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
    } catch (error) {
      result.status = 'error';
      // Do not save request headers, keys, raw response bodies or settings.
      result.error = error.name === 'TimeoutError' ? 'Request timed out' :
        /^HTTP \d+$/.test(error.message) ? error.message : 'Request or response processing failed';
    }
    result.latencyMs = performance.now()-start;
    report.classifications.push(result);
    console.log(`${result.status.toUpperCase()} ${fixture.id}: ${result.decision?.tier ?? result.error}`);
  }
}
const failed = report.tests.filter(x => x.status !== 'pass');
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
console.log(`Local tests: ${report.summary.policyPassed}/${report.summary.policyTotal}; live: ${report.summary.livePassed}/${report.summary.liveTotal}`);
console.log(`Report: ${path.join(resultsDir,filename)}`);
if (report.comparison) console.log(`Compared with ${report.comparison.previousRun}: ${report.comparison.changedTests.length} changed test results, ${report.comparison.changedClassifications.length} changed decisions.`);
process.exitCode = failed.length || report.classifications.some(x=>x.status!=='pass') ? 1 : 0;

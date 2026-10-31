import {expect,test} from 'claude-code/testing'
import {readFileSync} from 'node:fs'
import {requestBody,requestHeaders,route,readDecision} from '../hooks/policy.ts'
import {recommendTask} from '../hooks/task-routing.ts'
import {parseCatalog} from '../hooks/model-catalog.ts'
// Frozen before v2 work: legacy request payloads and routing must not drift.
const frozen=JSON.parse(readFileSync(new URL('./fixtures/legacy-regression.json',import.meta.url),'utf8'))
const catalog=parseCatalog(JSON.parse(readFileSync(new URL('../catalog/models.json',import.meta.url),'utf8')))
test('legacy classifier request bodies and headers are unchanged',()=>{
 for(const r of frozen.requests){
  expect(JSON.parse(requestBody(r.provider,r.state,r.model,r.tasks))).toEqual(r.body)
  expect(requestHeaders(r.provider,'KEY',r.model)).toEqual(r.headers)
 }
})
test('legacy tier/effort/risk routing is unchanged',()=>{
 expect(frozen.routes.length).toBe(28)
 for(const r of frozen.routes)expect(route(r.decision,r.current,r.config)).toEqual(r.routing)
})
test('legacy response reading is unchanged',()=>{for(const r of frozen.reads)expect(readDecision(r.text)).toEqual(r.decision)})
test('legacy Custom recommendations over the legacy catalog projection are unchanged',()=>{
 for(const r of frozen.tasks)expect(recommendTask(r.task,catalog,undefined,.8,r.risky)).toEqual(r.recommendation)
})

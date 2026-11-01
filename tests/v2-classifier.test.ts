import {expect,test} from 'claude-code/testing'
import {readFileSync} from 'node:fs'
import {v2Questions,v2RequestBody,normalizeV2Response} from '../hooks/v2/classifier.ts'
import {OBSERVATION_KEYS,TASK_ROLES,allowedValues,confident,validateClassifierOutput} from '../hooks/v2/contract.ts'
import {ROLES} from '../hooks/task-routing.ts'
const answer=(value:string,confidence:unknown=.95)=>({choice:value,confidence})
const full=(over:Record<string,unknown>={})=>JSON.stringify({answers:{role:answer('implementation'),specification:answer('explicit'),verification:answer('executable'),executionSpan:answer('bounded'),consequence:answer('reversible'),...over}})
const norm=(text:string)=>{const o=normalizeV2Response(text);if(o)expect(validateClassifierOutput(o)).toEqual([]);return o}
test('v2 questions ask the five dimensions as choices and name no models or permissions',()=>{
 const q=v2Questions() as any
 expect(Object.keys(q)).toEqual([...OBSERVATION_KEYS])
 for(const k of OBSERVATION_KEYS){expect(q[k].type).toBe('choice');for(const v of Object.keys(q[k].criteria))expect(allowedValues(k).includes(v)).toBe(true)}
 expect(/claude|gpt|haiku|sonnet|opus|astra|fallback|budget/i.test(JSON.stringify(q))).toBe(false)
})
test('lightweight communication reuses simple-answer without treating approvals or continuations as chat',()=>{
 const q=v2Questions() as any
 expect(q.role.criteria['simple-answer']).toContain('standalone social reply')
 expect(q.role.instructions).toContain('greeting or thanks is simple-answer')
 expect(q.role.instructions).toContain('Approvals, confirmations and requests to continue prior work are not social replies')
 expect(q.role.instructions).toContain('otherwise unknown')
 expect(q.executionSpan.instructions).toContain('greeting or thanks is bounded')
 expect(q.executionSpan.instructions).toContain('unspecified prior work is unknown')
 expect(norm(full({role:answer('unknown',1)}))!.role).toEqual({value:'unknown',confidence:null})
})
test('v2-only roles cover the taxonomy exactly without changing legacy labels',()=>{
 const q=v2Questions() as any
 expect(Object.keys(q.role.criteria).sort()).toEqual([...TASK_ROLES,'unknown'].sort())
 expect(ROLES.length).toBe(8);expect(TASK_ROLES.length).toBe(17)
 for(const role of TASK_ROLES){expect(norm(full({role:answer(role)}))!.role.value).toBe(role);expect(q.role.criteria[role].length>30).toBe(true)}
 expect(q.role.instructions).toContain('primary deliverable')
 expect(q.role.criteria.writing).toContain('planning')
 expect(q.role.criteria.implementation).toContain('operations')
})
test('request bodies follow each backend shape and keep context optional',()=>{
 const t=JSON.parse(v2RequestBody('typesafe',{prompt:'p'},'jev-latest'))
 expect(t.model).toBe('jev-latest');expect(t.state).toEqual({prompt:'p'})
 const g=JSON.parse(v2RequestBody('gateway',{prompt:'p',context:'c'},'typesafe-ai/jev'))
 expect(g.model).toBeUndefined();expect(g.state).toEqual({prompt:'p',context:'c'})
 expect(g.questions).toEqual(t.questions)
})
test('valid TypeSafe answers keep their per-field confidence',()=>{
 const o=norm(full({consequence:answer('consequential',.81)}))!
 expect(o.role).toEqual({value:'implementation',confidence:.95})
 expect(o.consequence).toEqual({value:'consequential',confidence:.81})
})
test('Gateway probabilities give the chosen value confidence only as a unique maximum',()=>{
 const p=(choice:string,probabilities:Record<string,unknown>)=>({choice,probabilities})
 const o=norm(full({specification:p('explicit',{explicit:.7,inferable:.3}),verification:p('partial',{executable:.6,partial:.4}),executionSpan:p('bounded',{bounded:.5,extended:.5})}))!
 expect(o.specification).toEqual({value:'explicit',confidence:.7})
 expect(o.verification).toEqual({value:'partial',confidence:null})
 expect(o.executionSpan).toEqual({value:'bounded',confidence:null})
 expect(norm(full({role:p('review',{review:2})}))!.role.confidence).toBeNull()
 expect(norm(full({role:{choice:'review'}}))!.role).toEqual({value:'review',confidence:null})
})
test('invalid values and missing dimensions become unknown, never low-demand values',()=>{
 const o=norm(JSON.stringify({answers:{role:answer('wizard'),specification:answer('trivial'),executionSpan:'bounded'}}))!
 for(const k of OBSERVATION_KEYS)expect(o[k]).toEqual({value:'unknown',confidence:null})
})
test('invalid or missing confidence is null and is not rescued from probabilities',()=>{
 for(const bad of [1.5,-0.1,'0.9',null,Number.NaN]){
  const o=norm(full({role:{choice:'review',confidence:bad,probabilities:{review:.99}}}))!
  expect(o.role).toEqual({value:'review',confidence:null})
 }
})
test('an unknown answer cannot carry confidence (inconsistent output)',()=>{
 expect(norm(full({consequence:answer('unknown',.99)}))!.consequence).toEqual({value:'unknown',confidence:null})
})
test('legacy tier-only, unreadable and empty responses are not v2 classifications',()=>{
 expect(normalizeV2Response(JSON.stringify({answers:{tier:{choice:'fast',confidence:.99},effort:{score:0},risky:{noul:.01}}}))).toBeNull()
 for(const t of ['not json','null','{}','{"answers":[]}','{"answers":{}}'])expect(normalizeV2Response(t)).toBeNull()
})
test('confidence threshold requires a known value at or above the threshold',()=>{
 expect(confident({value:'explicit',confidence:.8},.8)).toBe(true)
 expect(confident({value:'explicit',confidence:.79},.8)).toBe(false)
 expect(confident({value:'explicit',confidence:null},.8)).toBe(false)
 expect(confident({value:'unknown',confidence:1},.8)).toBe(false)
 expect(confident(undefined,.8)).toBe(false)
})
test('invalid Gateway distributions cannot authorize high-confidence observations',()=>{
 for(const probabilities of [{review:.9,implementation:.8},{review:.9},{review:.9,implementation:-.1},{review:.9,wizard:.1}])
  expect(norm(full({role:{choice:'review',probabilities}}))!.role.confidence).toBeNull()
 expect(confident({value:'explicit',confidence:2},.8)).toBe(false)
})
test('question callers cannot mutate later classifier requests',()=>{
 const first=v2Questions() as any; first.role.criteria.review='changed'
 expect((v2Questions() as any).role.criteria.review==='changed').toBe(false)
})
test('classification development fixtures are well formed and grouped',()=>{
 const f=JSON.parse(readFileSync(new URL('./fixtures/v2-classification.json',import.meta.url),'utf8'))
 expect(new Set(f.cases.map((c:any)=>c.id)).size).toBe(f.cases.length)
 expect(new Set(f.cases.map((c:any)=>c.group)).size>1).toBe(true)
 for(const role of TASK_ROLES)expect(f.cases.some((c:any)=>c.expected.role===role)).toBe(true)
 for(const c of f.cases){
  expect(typeof c.prompt==='string'&&c.prompt.length>0).toBe(true)
  expect(Object.keys(c.expected)).toEqual([...OBSERVATION_KEYS])
  for(const k of OBSERVATION_KEYS)expect(allowedValues(k).includes(c.expected[k])).toBe(true)
 }
})

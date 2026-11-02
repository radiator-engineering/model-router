import {test,expect} from 'claude-code/testing'
import {ok,rejects} from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {spawnSync} from 'node:child_process'
import {fileURLToPath} from 'node:url'
import {createRouterControls} from '../hooks/router-controls.ts'
import {emptyPinState,changePin} from '../hooks/v2/pins.ts'
import {beginAssignment,createHarness,durableRuntime,evaluateStep,invalidateHarness,prepareDispatch,requestChanges,observeResponse} from '../hooks/v2/harness.ts'
import type {HarnessPorts,RequestFacts,AssignmentInput} from '../hooks/v2/harness.ts'
import {appendRecord,normalizeUsage,recordConsumption} from '../hooks/v2/records.ts'
const saved=JSON.parse(readFileSync(new URL('./fixtures/v2-decisions.json',import.meta.url),'utf8'))
const clone=<T>(v:T):T=>structuredClone(v)
const input:AssignmentInput={id:'turn',text:'private prompt; never store',parentId:null,lineageId:'lineage',purpose:'execution',stage:null,kind:'user',matched:true}
export function harnessFixture(engine:'legacy'|'v2-shadow'|'v2'='v2') {
 const sample=clone(saved.cases[0].snapshot)
 const controls=createRouterControls({enabled:true,mode:'observe',mainModel:true,mainEffort:true,subagents:true,classifyTurns:true},{policyEngine:engine})
 controls.pins.pins=emptyPinState('conversation');controls.pins.authorityError=null
 const state=createHarness(controls,{...clone(saved.synthetic),classifier:{provider:null,url:'',model:'',apiKey:'private-key',deadlineMs:800},pluginVersion:'fixture',sourceRevision:null})
 state.conversationId='conversation'
 let now=Date.parse(sample.now),conversation='conversation',pins=emptyPinState('conversation')
 const facts:RequestFacts={routingAvailable:true,modelOrigin:'inherited',effortOrigin:'inherited',requirements:sample.requirements,environment:sample.environment,resources:sample.resources,fallback:null,shadowClassifierOptIn:false}
 const calls={classify:0,pins:0,reserve:0,save:0}
 const timers:(()=>void)[]=[]
 const ports:HarnessPorts={now:async()=>now,conversationId:async()=>conversation,sleep:()=>new Promise<void>(resolve=>timers.push(resolve)),
 classify:async()=>{calls.classify++;return {status:'ok',output:clone(sample.classification.output),elapsedMs:4,usage:{input_tokens:10,output_tokens:2}}},
 facts:async()=>clone(facts),pinState:async()=>clone(pins),commitPins:async(expected,next)=>{calls.pins++;if(JSON.stringify(pins)!==JSON.stringify(expected))return false;pins=clone(next);return true},
 reserve:async()=>{calls.reserve++;return true},save:async()=>{calls.save++}}
 const request={model:'syn-opus',effort:'medium'}
 return {state,controls,ports,facts,calls,timers,request,input:clone(input),sample,setPins:(v:typeof pins)=>{pins=clone(v)},getPins:()=>clone(pins),setConversation:(id:string)=>{conversation=id},advance:(ms:number)=>{now+=ms}}
}
test('live probe arguments fail closed before model spending on missing approval or malformed roles',()=>{
 const script=fileURLToPath(new URL('../scripts/test-v2-live.mjs',import.meta.url))
 for(const args of [[],['--confirm-live','--role',''],['--confirm-live','--role','__proto__'],['--confirm-live','--role','writing','--greeting']]){
  const r=spawnSync(process.execPath,[script,...args],{encoding:'utf8',timeout:5000})
  expect(r.status).toBe(1);expect(r.stdout).toBe('')
  expect(/after approval|Unknown role probe|Choose one live case/.test(r.stderr)).toBe(true)
 }
})
test('qualified assignment classifies once, freezes controls/pins and keeps the tool loop on one pair',async()=>{
 const f=harnessFixture(),a=await beginAssignment(f.state,f.input,f.ports)
 expect(a.prepared).toBe(true);expect(f.calls.classify).toBe(1)
 const d=await evaluateStep(f.state,a,f.request,f.ports);expect(d.outcome).toBe('select')
 expect(await prepareDispatch(f.state,a,0,f.ports)).toBe(true)
 expect(requestChanges(a)).toEqual({model:'syn-haiku',effort:'medium'})
 f.controls.state.mainModel=false;f.controls.v2.policyEngine='legacy'
 await evaluateStep(f.state,a,{model:'syn-haiku',effort:'medium'},f.ports)
 expect(await prepareDispatch(f.state,a,1,f.ports)).toBe(true)
 expect(f.calls.classify).toBe(1);expect(f.calls.pins).toBe(1);expect(a.engine).toBe('v2');expect(a.controlSnapshot.changeModel).toBe(true)
})
test('duplicate starts reuse identity but incompatible agent/purpose associations fail',async()=>{
 const f=harnessFixture(),a=await beginAssignment(f.state,f.input,f.ports)
 expect(await beginAssignment(f.state,f.input,f.ports)).toBe(a)
 await rejects(beginAssignment(f.state,{...f.input,purpose:'review'},f.ports),/identity conflict/)
 await rejects(beginAssignment(f.state,{...f.input,agentId:'wrong'},f.ports),/identity conflict/)
 expect(f.calls.classify).toBe(1)
})
test('in-flight classifier cannot dispatch early; timeout ignores the late result',async()=>{
 const f=harnessFixture();let finish!:(v:any)=>void
 f.ports.classify=()=>new Promise(resolve=>{finish=resolve})
 const starting=beginAssignment(f.state,f.input,f.ports)
 for(let i=0;i<12&&!f.timers.length;i++)await Promise.resolve()
 const a=f.state.assignments.turn!;expect(a.prepared).toBe(false)
 await evaluateStep(f.state,a,f.request,f.ports);expect(await prepareDispatch(f.state,a,0,f.ports)).toBe(false)
 f.timers[0]!();await starting;expect(a.classification.status).toBe('timeout')
 finish({status:'ok',output:f.sample.classification.output,elapsedMs:1000});await Promise.resolve()
 expect(a.classification.status).toBe('timeout')
})
test('cancellation and conversation changes invalidate delayed classification',async()=>{
 for(const cancel of ['invalidate','conversation']){
  const f=harnessFixture();let finish!:(v:any)=>void
  f.ports.classify=()=>new Promise(resolve=>{finish=resolve})
  const starting=beginAssignment(f.state,f.input,f.ports)
  for(let i=0;i<12&&!f.timers.length;i++)await Promise.resolve()
  if(cancel==='invalidate')invalidateHarness(f.state);else f.setConversation('another')
  finish({status:'ok',output:f.sample.classification.output,elapsedMs:1});const a=await starting
  expect(a.cancelled).toBe(true);await evaluateStep(f.state,a,f.request,f.ports)
  expect(a.decision!.outcome).toBe('unavailable');expect(await prepareDispatch(f.state,a,0,f.ports)).toBe(false)
 }
})
test('unmatched inputs and unavailable rewrites do not call the dimension classifier',async()=>{
 for(const patch of [{matched:false},{routingAvailable:false}]){
  const f=harnessFixture();Object.assign(f.facts,patch)
  const a=await beginAssignment(f.state,{...f.input,...('matched' in patch?{matched:false}:{})},f.ports)
  expect(f.calls.classify).toBe(0)
  await evaluateStep(f.state,a,f.request,f.ports)
  if(!f.facts.routingAvailable)expect(a.decision!.outcome).toBe('preserve')
 }
})
test('shadow classifier requires explicit opt-in and never consumes pins, reserves or applies',async()=>{
 for(const optIn of [false,true]){
  const f=harnessFixture('v2-shadow');f.facts.shadowClassifierOptIn=optIn
  const next=changePin(f.getPins(),{field:'model',value:'syn-haiku',scope:'next'});f.setPins(next)
  const a=await beginAssignment(f.state,f.input,f.ports);await evaluateStep(f.state,a,f.request,f.ports)
  expect(f.calls.classify).toBe(optIn?1:0);expect(await prepareDispatch(f.state,a,0,f.ports)).toBe(false)
  expect(f.getPins()).toEqual(next);expect(f.calls.pins+f.calls.reserve).toBe(0);expect(a.applied).toBeNull()
 }
})
test('next intent commits only before eligible dispatch; concurrent replacement is not overwritten',async()=>{
 const f=harnessFixture();f.setPins(changePin(f.getPins(),{field:'model',value:'syn-haiku',scope:'next'}))
 const a=await beginAssignment(f.state,f.input,f.ports);expect(f.getPins().pins.length).toBe(1)
 await evaluateStep(f.state,a,f.request,f.ports)
 f.setPins(changePin(f.getPins(),{field:'model',value:'syn-sonnet',scope:'next'}))
 expect(await prepareDispatch(f.state,a,0,f.ports)).toBe(false)
 expect(f.getPins().pins[0]!.value).toBe('syn-sonnet');expect(a.decision!.outcome).toBe('unavailable')
})
test('duplicate requests, unexpected target changes and lost eligibility hold continuation',async()=>{
 for(const scenario of ['duplicate','target']){
  const f=harnessFixture(),a=await beginAssignment(f.state,f.input,f.ports)
  await evaluateStep(f.state,a,f.request,f.ports);ok(await prepareDispatch(f.state,a,0,f.ports))
  if(scenario==='duplicate')expect(await prepareDispatch(f.state,a,0,f.ports)).toBe(false)
  else {if(scenario==='eligibility')f.facts.routingAvailable=false;await evaluateStep(f.state,a,{model:'unexpected',effort:'medium'},f.ports);expect(await prepareDispatch(f.state,a,1,f.ports)).toBe(false)}
  expect(a.decision!.outcome).toBe('unavailable')
 }
})
test('required atomic reservation failure holds and does not report an applied request',async()=>{
 const f=harnessFixture(),a=await beginAssignment(f.state,f.input,f.ports)
 await evaluateStep(f.state,a,f.request,f.ports);a.decision!.reservation.required=true
 f.ports.reserve=async()=>false
 expect(await prepareDispatch(f.state,a,0,f.ports)).toBe(false);expect(a.applied).toBeNull()
})
test('dispatch persistence failure cancels assignment rather than authorizing retry',async()=>{
 const f=harnessFixture(),a=await beginAssignment(f.state,f.input,f.ports)
 await evaluateStep(f.state,a,f.request,f.ports);f.ports.save=async()=>{throw Error('store failed')}
 await rejects(prepareDispatch(f.state,a,0,f.ports),/store failed/);expect(a.cancelled).toBe(true);expect(a.record!.applied).toBeNull()
 f.ports.save=async()=>{}
 expect(await prepareDispatch(f.state,a,1,f.ports)).toBe(false);expect(a.record!.outcome).toBe('unavailable')
})
test('fallback allowance is shared across lineage and cannot reset on a new assignment',async()=>{
 const f=harnessFixture(),a=await beginAssignment(f.state,f.input,f.ports)
 await evaluateStep(f.state,a,f.request,f.ports);a.decision!.fallback.substitution=true
 expect(await prepareDispatch(f.state,a,0,f.ports)).toBe(true)
 const b=await beginAssignment(f.state,{...f.input,id:'second'},f.ports)
 await evaluateStep(f.state,b,f.request,f.ports);b.decision!.fallback.substitution=true
 expect(await prepareDispatch(f.state,b,0,f.ports)).toBe(false);expect(f.state.lineageSubstitutions.lineage).toBe(1)
})
test('observed unexpected serving identity cancels continuation and records actual usage',async()=>{
 const f=harnessFixture(),a=await beginAssignment(f.state,f.input,f.ports)
 await evaluateStep(f.state,a,f.request,f.ports);await prepareDispatch(f.state,a,0,f.ports)
 observeResponse(f.state,a,{usage:{model:'unexpected',inputTokens:10,outputTokens:3}} as any)
 expect(a.cancelled).toBe(true);expect(a.record!.observed.model).toBe('unexpected')
 expect(a.record!.consumption.at(-1)!.usage!.outputTokens).toBe(3)
})
test('persistent metadata excludes prompts, credentials, headers and config objects',async()=>{
 const f=harnessFixture(),a=await beginAssignment(f.state,f.input,f.ports)
 await evaluateStep(f.state,a,f.request,f.ports)
 const serialized=JSON.stringify(durableRuntime(f.state))
 for(const secret of [f.input.text,'private-key','apiKey','headers','classifier.url'])expect(serialized.includes(secret)).toBe(false)
 expect(serialized.includes('syn-haiku')).toBe(true)
})
test('record usage is allow-listed, finite and bounded without inventing quota or effort',async()=>{
 expect(normalizeUsage({input_tokens:NaN,output_tokens:-1,apiKey:'secret'})).toEqual({inputTokens:null,outputTokens:null,cacheReadTokens:null,cacheWriteTokens:null})
 expect(normalizeUsage(null)).toBeNull()
 const f=harnessFixture(),a=await beginAssignment(f.state,f.input,f.ports);await evaluateStep(f.state,a,f.request,f.ports)
 let r=a.record!;for(let i=0;i<200;i++)r=recordConsumption(r,'author',{inputTokens:i,outputTokens:1})
 expect(r.consumption.length).toBe(128);expect(r.remainingProviderQuota).toBeNull();expect(r.observed.effort).toBeNull()
 expect(appendRecord([r],r).length).toBe(1)
})
test('wall-time exhaustion holds the next request without consuming a next pin',async()=>{
 const f=harnessFixture();f.setPins(changePin(f.getPins(),{field:'model',value:'syn-haiku',scope:'next'}))
 const a=await beginAssignment(f.state,f.input,f.ports);await evaluateStep(f.state,a,f.request,f.ports)
 f.advance(24*60*60*1000)
 expect(await prepareDispatch(f.state,a,0,f.ports)).toBe(false);expect(f.getPins().pins.length).toBe(1)
})
test('cancel during pin commit never becomes an applied dispatch',async()=>{
 const f=harnessFixture(),a=await beginAssignment(f.state,f.input,f.ports);await evaluateStep(f.state,a,f.request,f.ports)
 f.ports.commitPins=async()=>{invalidateHarness(f.state);return true}
 expect(await prepareDispatch(f.state,a,0,f.ports)).toBe(false);expect(a.applied).toBeNull()
})
test('atomic reservation failure leaves next intent unconsumed',async()=>{
 const f=harnessFixture();f.setPins(changePin(f.getPins(),{field:'model',value:'syn-haiku',scope:'next'}))
 const a=await beginAssignment(f.state,f.input,f.ports);await evaluateStep(f.state,a,f.request,f.ports)
 a.decision!.reservation.required=true;f.ports.reserve=async()=>false
 expect(await prepareDispatch(f.state,a,0,f.ports)).toBe(false);expect(f.getPins().pins.length).toBe(1);expect(f.calls.pins).toBe(0)
})
test('separately authorized subagent effort is resolved at the canonical first request, not spawn',async()=>{
 const f=harnessFixture();f.controls.v2.routeSubagentEffort=true
 const a=await beginAssignment(f.state,{...f.input,id:'spawn:tool',agentId:'spawn:tool',kind:'delegated'},f.ports)
 await evaluateStep(f.state,a,f.request,f.ports);await prepareDispatch(f.state,a,-1,f.ports)
 a.applied!.effort={kind:'unknown'};a.id='child-turn';a.agentId='child-agent'
 await evaluateStep(f.state,a,{model:'syn-haiku',effort:'high',agentId:'child-agent',index:0},f.ports)
 expect(a.snapshot!.controls.changeModel).toBe(false);expect(a.snapshot!.controls.changeEffort).toBe(true)
 expect(a.applied!.effort).toEqual({kind:'level',value:'medium'});expect(await prepareDispatch(f.state,a,0,f.ports)).toBe(true)
})
test('stopping while request facts are loading prevents a new classifier call',async()=>{
 const f=harnessFixture();f.controls.runtime=f.state
 let finish!:(v:any)=>void
 f.ports.facts=()=>new Promise(resolve=>{finish=resolve})
 const starting=beginAssignment(f.state,f.input,f.ports)
 for(let i=0;i<30&&!finish;i++)await Promise.resolve()
 expect(typeof finish).toBe('function')
 f.controls.update({enabled:false});f.controls.update({enabled:true})
 finish(f.facts);const a=await starting
 expect(a.cancelled).toBe(true);expect(f.calls.classify).toBe(0)
})

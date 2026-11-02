import {test,expect} from 'claude-code/testing'
import {setup,start,step,drain,command} from './helpers.ts'
test('actual router registration classifies once, applies exact pair and preserves it across the tool loop',async($,on)=>{
 const f=await setup($,on);let calls=0;const requests:any[]=[]
 on('turn.step',async function*(_,e){calls++;requests.push(e);yield {kind:'stop',stopReason:'end_turn',usage:null};return {turnId:e.turnId,index:e.index,answer:'ok',toolUses:[],stopReason:'end_turn',usage:null}})
 await f.initialize();await start($);await drain($.turn.step(step));await drain($.turn.step({...step,model:'syn-opus',index:1}))
 expect(calls).toBe(2);expect(requests.map(e=>[e.model,e.effort])).toEqual([['syn-haiku','medium'],['syn-haiku','medium']]);expect(f.calls.http).toBe(1)
})
test('clear restores new conversation controls without session.start and never transfers old session or next pins',async($,on)=>{
 const f=await setup($,on);const requests:any[]=[]
 on('turn.step',async function*(_,e){requests.push(e);return {turnId:e.turnId,index:e.index,answer:'ok',toolUses:[],stopReason:'end_turn',usage:null}})
 await f.initialize();await $.command.run(command('pin model syn-opus'));await $.command.run(command('pin model syn-opus --scope next'))
 const old=f.store.get('model-router.pins.v2/native-conversation')
 await $.session.end({reason:'clear',sessionId:'native-conversation',resume:{id:'native-conversation'}})
 f.setConversation('after-clear')
 await start($);await drain($.turn.step(step))
 await $.turn.complete({turnId:'turn',answer:'ok',durationMs:1,isAborted:false,reason:'answer'})
 await $.prompt.submit({text:'Mechanical change',wait:false,origin:{kind:'composer'}});await $.turn.start({turnId:'second',text:'Mechanical change'})
 await drain($.turn.step({...step,turnId:'second'}))
 expect(requests.map(e=>e.model)).toEqual(['syn-haiku','syn-haiku']);expect(f.calls.http).toBe(2)
 expect(f.store.get('model-router.pins.v2/native-conversation')).toEqual(old)
 expect(f.store.get('model-router.pins.v2/after-clear').pins).toEqual([])
})
test('production role rules dispatch Sonnet, Terra and Luna through actual native hooks',async($,on)=>{
 const f=await setup($,on);let role='explanation';const requests:any[]=[]
 on('turn.step',async function*(_,e){requests.push(e);return {turnId:e.turnId,index:e.index,answer:'ok',toolUses:[],stopReason:'end_turn',usage:null}})
 await f.clock.advance(48*60*60*1000);await f.initialize();await $.command.run({...command(''),command:'native-default-workflow'})
 for(const next of ['explanation','writing','extraction']){
  role=next;const id='role-'+role
  f.setClassification({role:{choice:role,confidence:.99},specification:{choice:'unknown'},verification:{choice:'judgment',confidence:.9},executionSpan:{choice:'bounded',confidence:.99},consequence:{choice:'reversible',confidence:.9}})
  await $.prompt.submit({text:'Bounded '+role,wait:false,origin:{kind:'composer'}});await $.turn.start({turnId:id,text:'Bounded '+role})
  await drain($.turn.step({...step,turnId:id,model:'gpt-6.1-sol',effort:'high'}))
  await $.turn.complete({turnId:id,answer:'ok',durationMs:1,isAborted:false,reason:'answer'})
 }
 expect(requests.map(e=>[e.model,e.effort])).toEqual([['claude-sonnet-5-5','medium'],['gpt-6.1-terra','medium'],['gpt-6-luna','low']])
})
test('missing turn association produces a synthetic hold, never a downstream request',async($,on)=>{
 const f=await setup($,on);let calls=0;on('turn.step',async function*(){calls++;throw Error('unexpected request')})
 await f.initialize();const out=await drain($.turn.step(step));expect(calls).toBe(0);expect(out.result.toolUses).toEqual([]);expect(out.result.answer.includes('unavailable')).toBe(true)
})
test('unavailable rewrites preserve the native request instead of dropping ordinary prompts',async($,on)=>{
 const f=await setup($,on);let model=''
 on('turn.step',async function*(_,e){model=e.model;return {turnId:e.turnId,index:e.index,answer:'ok',toolUses:[],stopReason:'end_turn',usage:null}})
 await f.initialize();await start($);await drain($.turn.step({...step,model:'unsupported'}))
 expect(model).toBe('unsupported');expect(f.calls.http).toBe(1)
})
test('duplicate request and unexpected tool-loop target cannot dispatch twice or silently substitute',async($,on)=>{
 const f=await setup($,on);let calls=0;on('turn.step',async function*(_,e){calls++;return {turnId:e.turnId,index:e.index,answer:'',toolUses:[],stopReason:'end_turn',usage:null}})
 await f.initialize();await start($);await drain($.turn.step(step));const duplicate=await drain($.turn.step(step));const changed=await drain($.turn.step({...step,index:1,model:'forbidden-target'}))
 expect(calls).toBe(1);expect(duplicate.result.answer.includes('unavailable')).toBe(true);expect(changed.result.answer.includes('unavailable')).toBe(true)
})
test('next pin remains intent until qualified dispatch, then remains bound only to that assignment',async($,on)=>{
 const f=await setup($,on);on('turn.step',async function*(_,e){return {turnId:e.turnId,index:e.index,answer:'',toolUses:[],stopReason:'end_turn',usage:null}})
 await f.initialize();await $.command.run(command('pin model syn-haiku --scope next'));await start($)
 const before:any=f.store.get('model-router.pins.v2/native-conversation');expect(before.pins.length).toBe(1)
 await drain($.turn.step(step));const after:any=f.store.get('model-router.pins.v2/native-conversation')
 expect(after.pins.length).toBe(0);expect(after.assignments.length).toBe(1)
 await $.turn.complete({turnId:'turn',answer:'done',durationMs:1,isAborted:false,reason:'answer'})
 const ended:any=f.store.get('model-router.pins.v2/native-conversation');expect(ended.assignments.length).toBe(0)
})
test('unassociated spawn is refused before native operation',async($,on)=>{
 const f=await setup($,on);let calls=0;on('agent.spawn',()=>{calls++;return {model:'syn-opus',agentId:'unexpected'}})
 await f.initialize();const result=await $.agent.spawn({prompt:'work',subagentType:'general-purpose'})
 expect(result.deny!==undefined).toBe(true);expect(calls).toBe(0)
})
test('shadow keeps legacy requests untouched and additional classifier calls require trusted opt-in',async($,on)=>{
 const f=await setup($,on);const requests:any[]=[]
 f.rows.push({key:'jev-model-router.policyEngine',value:'v2-shadow',provider:{plugin:'jev-model-router',tier:'plugin'}})
 on('turn.step',async function*(_,e){requests.push(e);return {turnId:e.turnId,index:e.index,answer:'',toolUses:[],stopReason:'end_turn',usage:null}})
 await f.initialize();await $.command.run(command('pin model syn-haiku --scope next'));await start($);await drain($.turn.step(step))
 expect(requests[0].model).toBe('syn-opus');expect(requests[0].effort).toBe('medium');expect(f.calls.http).toBe(1)
 expect(f.store.get('model-router.pins.v2/native-conversation').pins.length).toBe(1)
 const workflow=await $.command.run(command('candidate register candidate.json'));expect(workflow.text!.includes('shadow cannot')).toBe(true)
 expect(f.calls.spawn+f.calls.tools).toBe(0)
})
test('trusted shadow opt-in adds only a proposal classifier, not v2 application',async($,on)=>{
 const f=await setup($,on);let model=''
 f.rows.push({key:'jev-model-router.policyEngine',value:'v2-shadow',provider:{plugin:'jev-model-router',tier:'plugin'}})
 f.settings.user={pluginConfigs:{'jev-model-router':{options:{v2ShadowClassifier:true}}}}
 on('turn.step',async function*(_,e){model=e.model;return {turnId:e.turnId,index:e.index,answer:'',toolUses:[],stopReason:'end_turn',usage:null}})
 await f.initialize();await start($);await drain($.turn.step(step))
 expect(f.calls.http).toBe(2);expect(model).toBe('syn-opus');expect(f.calls.spawn+f.calls.tools).toBe(0)
})
test('master off bypasses v2 association, classification and spawn guards; on resumes new turns',async($,on)=>{
 const f=await setup($,on);const requests:any[]=[]
 on('turn.step',async function*(_,e){requests.push(e);return {turnId:e.turnId,index:e.index,answer:'ok',toolUses:[],stopReason:'end_turn',usage:null}})
 on('agent.spawn',()=>({model:'syn-opus',agentId:'host-agent'}))
 await f.initialize();await $.command.run(command('off'))
 await start($);await drain($.turn.step({...step,model:'host-model',effort:'high'}))
 const spawn=await $.agent.spawn({prompt:'work',subagentType:'general-purpose'})
 expect(spawn.agentId).toBe('host-agent');expect(f.calls.http).toBe(0)
 expect(requests.map(e=>[e.model,e.effort])).toEqual([['host-model','high']])
 const review=await $.command.run(command('review candidate'));expect(review.text!.includes('stopped')).toBe(true)
 await $.command.run(command('on'));await start($);await drain($.turn.step(step))
 expect(requests[1].model).toBe('syn-haiku');expect(f.calls.http).toBe(1)
})
test('disabled startup leaves native requests and stored router evidence untouched',async($,on)=>{
 const f=await setup($,on);const requests:any[]=[]
 f.rows.push({key:'jev-model-router.enabled',value:false,provider:{plugin:'jev-model-router',tier:'plugin'}})
 on('turn.step',async function*(_,e){requests.push(e);return {turnId:e.turnId,index:e.index,answer:'ok',toolUses:[],stopReason:'end_turn',usage:null}})
 await f.initialize();expect(f.store.size).toBe(0)
 await start($);await drain($.turn.step(step))
 expect(requests[0].model).toBe('syn-opus');expect(f.calls.http).toBe(0);expect(f.store.size).toBe(0)
 const status=await $.command.run(command('status'));expect(status.text!.includes('Model router: off')).toBe(true)
})

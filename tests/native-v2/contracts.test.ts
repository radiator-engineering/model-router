import {test,expect} from 'claude-code/testing'
import {setup,start,step,drain,command} from './helpers.ts'
test('actual router registration classifies once, applies exact pair and preserves it across the tool loop',async($,on)=>{
 const f=await setup($,on);let calls=0;const requests:any[]=[]
 on('turn.step',async function*(_,e){calls++;requests.push(e);yield {kind:'stop',stopReason:'end_turn',usage:null};return {turnId:e.turnId,index:e.index,answer:'ok',toolUses:[],stopReason:'end_turn',usage:null}})
 await f.initialize();await start($);await drain($.turn.step(step));await drain($.turn.step({...step,model:'syn-haiku',index:1}))
 expect(calls).toBe(2);expect(requests.map(e=>[e.model,e.effort])).toEqual([['syn-haiku','medium'],['syn-haiku','medium']]);expect(f.calls.http).toBe(1)
})
test('missing turn association produces a synthetic hold, never a downstream request',async($,on)=>{
 const f=await setup($,on);let calls=0;on('turn.step',async function*(){calls++;throw Error('unexpected request')})
 await f.initialize();const out=await drain($.turn.step(step));expect(calls).toBe(0);expect(out.result.toolUses).toEqual([]);expect(out.result.answer.includes('unavailable')).toBe(true)
})
test('real unqualified facts hold submission before classification or model dispatch',async($,on)=>{
 const f=await setup($,on);await f.initialize();f.setModel('unqualified')
 const out=await $.prompt.submit({text:'work',wait:false,origin:{kind:'composer'}})
 expect(out.drop!==undefined).toBe(true);expect(f.calls.http).toBe(0)
})
test('duplicate request and unexpected tool-loop target cannot dispatch twice or silently substitute',async($,on)=>{
 const f=await setup($,on);let calls=0;on('turn.step',async function*(_,e){calls++;return {turnId:e.turnId,index:e.index,answer:'',toolUses:[],stopReason:'end_turn',usage:null}})
 await f.initialize();await start($);await drain($.turn.step(step));const duplicate=await drain($.turn.step(step));const changed=await drain($.turn.step({...step,index:1,model:'syn-opus'}))
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

import {expect,test} from 'claude-code/testing'
import {registerRouterControls,createRouterControls,parseRouterCommand,routerStatus,ROUTER_TOGGLES} from '../hooks/router-controls.ts'
import type {RouterSettings} from '../hooks/router-controls.ts'
import {register} from '../hooks/jev-model-router.ts'
const initial:RouterSettings={mode:'custom',mainModel:false,mainEffort:false,subagents:true,classifyTurns:true}
function setup(saved?:unknown){
 const handlers:any={};const store=new Map<string,unknown>();if(saved!==undefined)store.set('model-router.defaults.v1',saved)
 const registered:any[]=[];const choices:string[]=[];const asks:any[]=[];const timers:any[]=[];const opened:any[]=[];let menu=false
 const controls=createRouterControls(initial);registerRouterControls(((n:string,f:any)=>handlers[n]=f) as any,controls)
 const $:any={state:{get:async()=>({value:menu}),set:async(_:any,v:boolean)=>{menu=v}},clock:{after:(_:number,fn:any)=>{timers.push(fn)}},store:{get:async(k:string)=>store.get(k),set:async(k:string,v:unknown)=>{store.set(k,structuredClone(v))},delete:async(k:string)=>{store.delete(k)}},command:{run:async(v:any)=>{opened.push(v);return new Promise(()=>{})},register:async(v:any)=>{registered.push(v);return {command:v.name}}},ui:{invalidate:()=>{},log:()=>{},ask:async(q:string,opts:string[])=>{asks.push({q,opts});if(!choices.length)throw Error('dismissed');return choices.shift()}}}
 const run=(args:string,origin='composer')=>handlers['command.run']($,{command:'router',args,origin:{kind:origin}},async()=>({text:'other'}))
 return {handlers,store,registered,choices,asks,controls,$,run,timers,opened}
}
test('session start registers /router and loads valid saved defaults',async()=>{
 const h=setup({...initial,classifyTurns:false})
 await h.handlers['session.start'](h.$,{},async()=>({}))
 expect(h.registered[0].name).toBe('router');expect(h.controls.current().classifyTurns).toBe(false)
})
test('invalid saved defaults do not override plugin options',async()=>{
 const h=setup({mode:'custom',mainModel:'yes'})
 await h.handlers['session.start'](h.$,{},async()=>({}))
 expect(h.controls.current()).toEqual(initial)
})
test('direct controls apply immediately and do not persist implicitly',async()=>{
 const h=setup();await h.run('main-effort on');await h.run('mode observe');await h.run('classify-turns off')
 expect(h.controls.current()).toEqual({...initial,mainEffort:true,mode:'observe',classifyTurns:false})
 expect(h.store.size).toBe(0)
})
test('save persists and reset restores original plugin settings',async()=>{
 const h=setup();await h.run('subagents off');await h.run('save')
 expect((h.store.get('model-router.defaults.v1') as RouterSettings).subagents).toBe(false)
 await h.run('reset');expect(h.controls.current()).toEqual(initial);expect(h.store.size).toBe(0)
})
test('native config opens after the command returns without a question dialog',async()=>{
 const h=setup();await h.run('');expect(h.opened.length).toBe(0)
 h.timers[0]();await new Promise(resolve=>setTimeout(resolve,0))
 expect(h.opened[0]).toEqual({command:'config',args:''})
})
test('native config describes router rows and hides unrelated settings',async()=>{
 const h=setup();await h.$.state.set({},true)
 const other=await h.handlers['config.describe'](h.$,{key:'theme'},async(e:any)=>e)
 expect(other.isHidden).toBe(true)
 const row=await h.handlers['config.describe'](h.$,{key:'jev-model-router.routeMainModel',provider:{plugin:'jev-model-router@inline'}},async(e:any)=>e)
 expect(row.label).toBe('Router · Main model routing');expect(row.description).toContain('main conversation')
})
test('successful native writes update runtime and persist immediately',async()=>{
 const h=setup();await h.handlers['config.set'](h.$,{key:'jev-model-router.routeSubagentModel',provider:{plugin:'jev-model-router@inline'}},async()=>({value:false}))
 expect(h.controls.current().subagents).toBe(false)
 expect((h.store.get('model-router.defaults.v1') as RouterSettings).subagents).toBe(false)
})
test('denied native writes leave runtime unchanged',async()=>{
 const h=setup();await h.handlers['config.set'](h.$,{key:'jev-model-router.routeSubagentModel',provider:{plugin:'jev-model-router@inline'}},async()=>({deny:'policy'}))
 expect(h.controls.current()).toEqual(initial);expect(h.store.size).toBe(0)
})
test('unknown commands and invalid values are rejected',()=>{
 expect(parseRouterCommand('main-model maybe')).toEqual({kind:'error'})
 expect(parseRouterCommand('classify-turns off')).toEqual({kind:'change',patch:{classifyTurns:false}})
})
test('status reads do not write storage; unrelated commands pass through',async()=>{
 const h=setup();expect((await h.run('status')).text).toContain('Main model routing: off')
 expect(h.store.size).toBe(0)
 expect((await h.handlers['command.run'](h.$,{command:'other'},async()=>({text:'passed'}))).text).toBe('passed')
 expect(routerStatus(initial)).toContain('Per-turn classification/logging: on')
})
test('classification and recommendation logging operate with both main switches off',async()=>{
 const handlers:any={};const logs:string[]=[];let calls=0
 register(((n:string,f:any)=>handlers[n]=f) as any,{typesafeApiKey:'fake',routeMainModel:false,routeMainEffort:false,classifyTurns:true} as any)
 const $:any={ui:{log:(s:string)=>logs.push(s),status:()=>{}},clock:{now:async()=>0,sleep:()=>new Promise(()=>{})},http:{fetch:async()=>{calls++;return {ok:true,text:JSON.stringify({answers:{tier:{choice:'deep',confidence:1},effort:{score:3,confidence:1},risky:{noul:0},taskRole:{choice:'implementation',confidence:1},implementationCategory:{choice:'design-led',confidence:1}}})}}}}
 await handlers['prompt.submit']($,{text:'Design an architecture'},async(e:any)=>e)
 let result:any;for await(const _ of handlers['turn.step']($,{model:'sonnet',effort:'medium',index:0,turnId:'a'},async function*(e:any){result=e;yield e})){}
 expect(calls).toBe(1);expect(result.model).toBe('sonnet');expect(result.effort).toBe('medium')
 expect(logs.some(l=>l.includes('task observe recommendation'))).toBe(true)
 expect(logs.some(l=>l.includes('main unchanged: sonnet · effort medium; model routing off, effort routing off; recommendations only'))).toBe(true)
 expect(logs.some(l=>l.includes('classification (recommendation only)'))).toBe(true)
 await handlers['command.run']($,{command:'router',args:'classify-turns off',origin:{kind:'composer'}},async()=>({}))
 await handlers['prompt.submit']($,{text:'Another task'},async(e:any)=>e)
 expect(calls).toBe(1)
})
test('router commands are never sent to Jev as task prompts',async()=>{
 const handlers:any={};let calls=0
 register(((n:string,f:any)=>handlers[n]=f) as any,{typesafeApiKey:'fake',classifyTurns:true} as any)
 const $:any={ui:{log:()=>{}},http:{fetch:async()=>{calls++;throw Error('unexpected')}}}
 await handlers['prompt.submit']($,{text:'/router main-effort on'},async(e:any)=>e)
 expect(calls).toBe(0)
})


test('router menu filtering survives a fresh hook registration',async()=>{
 const h=setup();await h.$.state.set({},true)
 const handlers:any={};registerRouterControls(((n:string,f:any)=>handlers[n]=f) as any,createRouterControls(initial))
 const result=await handlers['config.describe'](h.$,{key:'theme'},async(e:any)=>e)
 expect(result.isHidden).toBe(true)
 await handlers['command.run'](h.$,{command:'config',origin:{kind:'composer'}},async()=>({}))
 const normal=await handlers['config.describe'](h.$,{key:'theme'},async(e:any)=>e)
 expect(normal.isHidden).toBeUndefined()
})

test('old mode names preserve the selected policy after upgrade',async()=>{
 const custom=setup({...initial,mode:'apply'})
 await custom.handlers['session.start'](custom.$,{},async()=>({}))
 expect(custom.controls.current().mode).toBe('custom')
 const basic=setup({...initial,mode:'off'})
 await basic.handlers['session.start'](basic.$,{},async()=>({}))
 expect(basic.controls.current().mode).toBe('basic')
 expect(parseRouterCommand('mode custom')).toEqual({kind:'change',patch:{mode:'custom'}})
 expect(parseRouterCommand('mode basic')).toEqual({kind:'change',patch:{mode:'basic'}})
 expect(parseRouterCommand('mode apply')).toEqual({kind:'change',patch:{mode:'custom'}})
})

test('native menu values override stale legacy saved defaults at startup',async()=>{
 const h=setup({...initial,mainModel:false,mainEffort:false})
 h.$.config={list:async()=>[
  {key:'jev-model-router.routeMainModel',provider:{plugin:'jev-model-router@inline'},value:true},
  {key:'jev-model-router.routeMainEffort',provider:{plugin:'jev-model-router@inline'},value:true},
 ]}
 await h.handlers['session.start'](h.$,{},async()=>({}))
 expect(h.controls.current().mainModel).toBe(true)
 expect(h.controls.current().mainEffort).toBe(true)
 expect((await h.run('status')).text).toContain('Main model routing: on')
})

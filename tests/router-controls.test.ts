import {expect,test} from 'claude-code/testing'
import {registerRouterControls,createRouterControls,parseRouterCommand,routerStatus} from '../hooks/router-controls.ts'
import type {RouterSettings} from '../hooks/router-controls.ts'
import {register} from '../hooks/jev-model-router.ts'
const initial:RouterSettings={mode:'apply',mainModel:false,mainEffort:false,subagents:true,classifyTurns:true}
function setup(saved?:unknown){
 const handlers:any={};const store=new Map<string,unknown>();if(saved!==undefined)store.set('model-router.defaults.v1',saved)
 const registered:any[]=[];const choices:string[]=[];const asks:any[]=[]
 const controls=createRouterControls(initial);registerRouterControls(((n:string,f:any)=>handlers[n]=f) as any,controls)
 const $:any={store:{get:async(k:string)=>store.get(k),set:async(k:string,v:unknown)=>{store.set(k,structuredClone(v))},delete:async(k:string)=>{store.delete(k)}},command:{register:async(v:any)=>{registered.push(v);return {command:v.name}}},ui:{log:()=>{},ask:async(q:string,opts:string[])=>{asks.push({q,opts});if(!choices.length)throw Error('dismissed');return choices.shift()}}}
 const run=(args:string,origin='composer')=>handlers['command.run']($,{command:'router',args,origin:{kind:origin}},async()=>({text:'other'}))
 return {handlers,store,registered,choices,asks,controls,$,run}
}
test('session start registers /router and loads valid saved defaults',async()=>{
 const h=setup({...initial,classifyTurns:false})
 await h.handlers['session.start'](h.$,{},async()=>({}))
 expect(h.registered[0].name).toBe('router');expect(h.controls.current().classifyTurns).toBe(false)
})
test('invalid saved defaults do not override plugin options',async()=>{
 const h=setup({mode:'apply',mainModel:'yes'})
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
test('bare /router opens a menu and toggles switches without changing effort routing',async()=>{
 const h=setup();h.choices.push('Routing switches','Main model: off','Defaults and logging','Per-turn classification: on','Done')
 const result=await h.run('')
 expect(h.asks.length).toBe(5);expect(h.controls.current().mainModel).toBe(true)
 expect(h.controls.current().classifyTurns).toBe(false);expect(h.controls.current().mainEffort).toBe(false)
 expect(result.text).toContain('Classifier: Jev')
 for(const ask of h.asks)expect(ask.opts.length<=4).toBe(true)
})
test('menu supports mode changes, saving defaults and Back',async()=>{
 const h=setup();h.choices.push('Mode','observe','Routing switches','Back','Defaults and logging','Save defaults','Done')
 await h.run('');expect(h.controls.current().mode).toBe('observe');expect(h.store.size).toBe(1)
})
test('menu dismissal retains prior state and offers direct command fallback',async()=>{
 const h=setup();const result=await h.run('');expect(h.controls.current()).toEqual(initial)
 expect(result.text).toContain('Menu dismissed')
})
test('malformed commands and plugin-origin mutations cannot change state',async()=>{
 const h=setup();await h.run('main-effort yes');await h.run('mode apply extra');await h.run('main-effort on','plugin')
 expect(h.controls.current()).toEqual(initial)
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
 expect(logs.some(l=>l.includes('task observe'))).toBe(true)
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

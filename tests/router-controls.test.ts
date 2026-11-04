import {expect,test} from 'claude-code/testing'
import {registerRouterControls,createRouterControls,parseRouterCommand,routerStatus,ROUTER_TOGGLES,PIN_STORE_KEY,validateChecksJson} from '../hooks/router-controls.ts'
import {readFileSync} from 'node:fs'
import {recordHooks} from '../scripts/test-adapter.mjs'
import {emptyPinState} from '../hooks/v2/pins.ts'
import {V2_MODEL_DEFAULTS} from '../hooks/v2/policy-data.ts'
import type {RouterSettings} from '../hooks/router-controls.ts'
import {register,registerWithAdapters} from '../hooks/jev-model-router.ts'
const initial:RouterSettings={enabled:true,providerPreset:'mixed',mode:'custom',mainModel:false,mainEffort:false,subagents:true,classifyTurns:true}
function setup(saved?:unknown){
 const handlers:any={};const store=new Map<string,unknown>();if(saved!==undefined)store.set('model-router.defaults.v1',saved)
 const registered:any[]=[];const choices:string[]=[];const asks:any[]=[];const timers:any[]=[];const opened:any[]=[];let menu=false
 const controls=createRouterControls(initial);registerRouterControls(recordHooks(handlers) as any,controls)
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
 const chat=await h.handlers['config.describe'](h.$,{key:'jev-model-router.simpleAnswerModel',provider:{plugin:'jev-model-router@inline'}},async(e:any)=>e)
 expect(chat.isHidden).toBe(false);expect(chat.label).toBe('Router · Simple answers & chat model');expect(chat.description).toContain('save defaults, not session-only overrides')
 for(const key of Object.keys(V2_MODEL_DEFAULTS)){
  const pref=await h.handlers['config.describe'](h.$,{key:'jev-model-router.'+key,provider:{plugin:'jev-model-router@inline'}},async(e:any)=>e)
  expect(pref.isHidden).toBe(false)
 }
 const foreign=await h.handlers['config.describe'](h.$,{key:'other.simpleAnswerModel',provider:{plugin:'other'}},async(e:any)=>e)
 expect(foreign.isHidden).toBe(true)
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
 const handlers:any={};const logs:string[]=[];const debug:string[]=[];let calls=0
 register(recordHooks(handlers) as any,{typesafeApiKey:'fake',routeMainModel:false,routeMainEffort:false,classifyTurns:true} as any)
 const $:any={ui:{log:(s:string,options?:any)=>(options?.to==='debug'?debug:logs).push(s),status:()=>{}},clock:{now:async()=>0,sleep:()=>new Promise(()=>{})},http:{fetch:async()=>{calls++;return {ok:true,text:JSON.stringify({answers:{tier:{choice:'deep',confidence:1},effort:{score:3,confidence:1},risky:{noul:0},taskRole:{choice:'implementation',confidence:1},implementationCategory:{choice:'design-led',confidence:1}}})}}}}
 await handlers['prompt.submit']($,{text:'Design an architecture'},async(e:any)=>e)
 let result:any;for await(const _ of handlers['turn.step']($,{model:'sonnet',effort:'medium',index:0,turnId:'a'},async function*(e:any){result=e;yield e})){}
 expect(calls).toBe(1);expect(result.model).toBe('sonnet');expect(result.effort).toBe('medium')
 expect(debug.some(l=>l.includes('task observe recommendation'))).toBe(true)
 expect(logs.length).toBe(1)
 expect(logs[0]).toBe('[router] implementation/design-led · sonnet · effort medium · observe · unchanged')
 expect(debug.some(l=>l.includes('classification (recommendation only)'))).toBe(true)
 await handlers['command.run']($,{command:'router',args:'classify-turns off',origin:{kind:'composer'}},async()=>({}))
 await handlers['prompt.submit']($,{text:'Another task'},async(e:any)=>e)
 expect(calls).toBe(1)
})
test('router commands are never sent to Jev as task prompts',async()=>{
 const handlers:any={};let calls=0
 register(recordHooks(handlers) as any,{typesafeApiKey:'fake',classifyTurns:true} as any)
 const $:any={ui:{log:()=>{}},http:{fetch:async()=>{calls++;throw Error('unexpected')}}}
 await handlers['prompt.submit']($,{text:'/router main-effort on'},async(e:any)=>e)
 expect(calls).toBe(0)
})


test('router menu filtering survives a fresh hook registration',async()=>{
 const h=setup();await h.$.state.set({},true)
 const handlers:any={};registerRouterControls(recordHooks(handlers) as any,createRouterControls(initial))
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

// Phase 4: real control registration over a controlled, non-inferencing host.
const manifest=JSON.parse(readFileSync(new URL('../.claude-plugin/plugin.json',import.meta.url),'utf8'))
function v2Setup(options:any={},store=new Map<string,unknown>(),settings:any={user:{},policy:{}},entry=false){
 const handlers:any={},errors:any={},values:any=Object.fromEntries(Object.entries(manifest.userConfig).map(([key,v]:any)=>[key,v.default]))
 Object.assign(values,options)
 const locked=new Set<string>(),calls={http:0,model:0,spawn:0,files:0,config:0,writes:0}
 const logs:string[]=[];let id='conversation-a';let failRead=false,failWrite=false,failSettings=false
 const state=new Map([['routerMenuOpen',false]])
 const controls=createRouterControls(initial,options)
 const on:any=recordHooks(handlers,errors)
 if(entry)register(on,options);else registerRouterControls(on,controls)
 const coreSet=async(key:string,value:any)=>{
  calls.config++;const field=key.slice(key.lastIndexOf('.')+1)
  if(locked.has(field))return {deny:'managed'}
  values[field]=value
  settings.user.pluginConfigs??={};settings.user.pluginConfigs['jev-model-router']??={options:{}}
  settings.user.pluginConfigs['jev-model-router'].options[field]=value
  return {value}
 }
 const $:any={
  session:{id:async()=>id},
  settings:{read:async({source}:any)=>{if(failSettings)throw Error('missing provenance');return structuredClone(settings[source])}},
  config:{list:async()=>Object.entries(values).map(([key,value])=>({key:'jev-model-router.'+key,value,provider:{plugin:'jev-model-router@inline'},isLocked:locked.has(key)})),set:async(e:any)=>coreSet(e.key,e.value)},
  store:{get:async(k:string)=>{if(failRead)throw Error('read failed');return structuredClone(store.get(k))},set:async(k:string,v:unknown)=>{calls.writes++;if(failWrite)throw Error('write failed');store.set(k,structuredClone(v))},delete:async(k:string)=>{store.delete(k)}},
  state:{get:async(r:any)=>({value:state.get(r.key)}),set:async(r:any,v:any)=>{state.set(r.key,v)}},
  command:{register:async()=>({command:'router'}),run:async()=>({})},clock:{after:()=>{},now:async()=>0,sleep:()=>new Promise(()=>{})},
  ui:{log:(s:string)=>{logs.push(s)},invalidate:()=>{},status:()=>{}},
  http:{fetch:async()=>{calls.http++;throw Error('unexpected classifier')}},model:{classify:async()=>{calls.model++;throw Error('unexpected classifier')}},
  tool:{register:async()=>({tool:'mcp__jev-model-router__candidate_checkpoint'})},agent:{spawn:async()=>{calls.spawn++;throw Error('unexpected reviewer')}},fs:{read:async()=>{calls.files++;throw Error('unexpected file access')}},
 }
 const run=(args:string,origin='composer')=>handlers['command.run']($,{command:'router',args,origin:{kind:origin}},async()=>({}))
 const start=()=>handlers['session.start']($,{cwd:'/repo',surface:'terminal',isInteractive:true},async()=>({cwd:'/repo'}))
 const set=async(key:string,value:any,origin='composer')=>handlers['config.set']($,{key:'jev-model-router.'+key,value,previous:values[key],provider:{plugin:'jev-model-router@inline'},origin:{kind:origin}},async(e:any)=>coreSet(e.key,e.value))
 return {handlers,errors,controls,$,store,settings,values,locked,calls,logs,run,start,set,coreSet,setId:(v:string)=>{id=v},failRead:(v:boolean)=>{failRead=v},failWrite:(v:boolean)=>{failWrite=v},failSettings:(v:boolean)=>{failSettings=v}}
}
const userOptions=(options:any)=>({pluginConfigs:{'jev-model-router':{options}}})
test('phase-4 manifest adds conservative defaults without changing legacy defaults',()=>{
 const cfg=manifest.userConfig
 for(const [key,value] of Object.entries(V2_MODEL_DEFAULTS))expect(cfg[key].default).toBe(value)
 for(const [key,value] of Object.entries({policyEngine:'legacy',routeSubagentEffort:false,reviewMode:'recommend',persistentModelPin:'',persistentEffortPin:'',verificationChecksJson:'{"schemaVersion":1,"checks":[]}'}))expect(cfg[key].default).toBe(value)
 expect(cfg.routeMainModel.default).toBe(false);expect(cfg.routeMainEffort.default).toBe(true);expect(cfg.routeSubagentModel.default).toBe(true);expect(cfg.taskRoutingMode.default).toBe('observe')
})
test('phase-4 syntax is exact, purpose-scoped and rejects malformed scopes/levels',()=>{
 expect(parseRouterCommand('pin model Exact-Model-ID')).toEqual({kind:'pin',field:'model',value:'Exact-Model-ID',scope:'session'})
 expect(parseRouterCommand('pin effort medium --scope next')).toEqual({kind:'pin',field:'effort',value:'medium',scope:'next'})
 expect(parseRouterCommand('unpin effort --scope persistent')).toEqual({kind:'pin',field:'effort',value:null,scope:'persistent'})
 expect(parseRouterCommand('candidate register path with spaces.json')).toEqual({kind:'candidate',manifest:'path with spaces.json'})
 expect(parseRouterCommand('review')).toEqual({kind:'review',candidateId:null})
 expect(parseRouterCommand('accept cand_x')).toEqual({kind:'accept',candidateId:'cand_x'})
 for(const command of ['pin effort 4096','pin model','pin model id --scope assignment','unpin model id','pin effort medium --scope session extra','review a b','accept','constructor on','__proto__ off'])expect(parseRouterCommand(command)).toEqual({kind:'error'})
})
test('session/next commands persist execution intent without consuming it or making calls',async()=>{
 const h=v2Setup();await h.start();await h.run('pin model Exact-ID');await h.run('pin effort medium --scope next')
 const saved:any=h.store.get(PIN_STORE_KEY('conversation-a'))
 expect(saved.schemaVersion).toBe(2);expect(saved.pins.map((p:any)=>[p.field,p.value,p.scope,p.purpose])).toEqual([['model','Exact-ID','session','execution'],['effort','medium','next','execution']])
 const writes=h.calls.writes
 const status=(await h.run('status')).text
 expect(status).toContain('staged, not applied by legacy');expect(status).toContain('not applied by legacy');expect(status).toContain('effort=medium')
 expect(h.calls.writes).toBe(writes);expect(h.calls.http+h.calls.model+h.calls.spawn+h.calls.files).toBe(0)
})
test('v2 status reports forwarded records, never an unapplied proposal or another conversation',async()=>{
 const h=v2Setup();await h.start();h.controls.v2.policyEngine='v2'
 h.controls.runtime={conversationId:'conversation-a',records:[{assignmentId:'forwarded',appliedEngine:'v2',applied:{model:'claude-haiku-5-5',effort:{kind:'level',value:'medium'}},observed:{model:null}},{assignmentId:'proposal',appliedEngine:'v2',applied:null}]} as any
 expect((await h.run('status')).text).toContain('v2 claude-haiku-5-5/medium for forwarded; serving identity unknown')
 h.controls.runtime!.conversationId='conversation-b'
 expect((await h.run('status')).text).toContain('Last router-applied request: unknown')
})
test('unpin removes only the chosen execution field and scope',async()=>{
 const h=v2Setup();await h.run('pin model session');await h.run('pin model next --scope next');await h.run('pin effort medium')
 await h.run('unpin model')
 expect(h.controls.pins.pins!.pins.map(p=>[p.field,p.scope])).toEqual([['model','next'],['effort','session']])
})
test('untrusted origins cannot mint pins, controls or workflow authority',async()=>{
 for(const origin of ['plugin','bridge','sdk','unclassified','task-notification']){
  const h=v2Setup()
  for(const cmd of ['pin model injected','review-mode automatic','subagent-effort on','candidate register input.json','review cand','accept cand'])expect((await h.run(cmd,origin)).text).toContain('unavailable')
  expect(h.calls.writes+h.calls.config+h.calls.spawn+h.calls.http+h.calls.files).toBe(0)
  expect((await h.run('status',origin)).text).toContain('Model router')
 }
})
test('same-conversation reload restores pins; clear/branch never copies them; resume restores only its identity',async()=>{
 const h=v2Setup();await h.start();await h.run('pin model author')
 const reload=v2Setup({},h.store,h.settings);await reload.start();expect(reload.controls.pins.pins!.pins[0]!.value).toBe('author')
 await reload.handlers['session.end'](reload.$,{reason:'clear',sessionId:'conversation-a'},async()=>({sessionId:'conversation-a'}))
 reload.setId('conversation-b');expect((await reload.run('status')).text).toContain('model unset')
 await reload.run('pin effort high');expect(reload.store.has(PIN_STORE_KEY('conversation-b'))).toBe(true)
 reload.setId('conversation-a');await reload.run('status');expect(reload.controls.pins.pins!.pins[0]!.value).toBe('author')
})
test('missing conversation identity or malformed stored intent blocks writes, not legacy reads',async()=>{
 const h=v2Setup();h.setId('');expect((await h.run('pin model author')).text).toContain('unavailable');expect(h.calls.writes).toBe(0)
 h.setId('conversation-a');h.store.set(PIN_STORE_KEY('conversation-a'),{schemaVersion:99})
 expect((await h.run('pin effort medium')).text).toContain('unavailable');expect(h.calls.writes).toBe(0)
 expect((await h.run('status')).text).toContain('Configuration invalid')
 expect(h.store.get(PIN_STORE_KEY('conversation-a'))).toEqual({schemaVersion:99})
})
test('failed persistence leaves acknowledged pin intent unchanged and does not reset the old store',async()=>{
 const h=v2Setup();await h.run('pin model original');const before=structuredClone(h.store.get(PIN_STORE_KEY('conversation-a')))
 h.failWrite(true);expect((await h.run('pin model replacement')).text).toContain('unavailable')
 expect(h.controls.pins.pins!.pins[0]!.value).toBe('original');expect(h.store.get(PIN_STORE_KEY('conversation-a'))).toEqual(before)
 h.failWrite(false);h.failRead(true);expect((await h.run('unpin model')).text).toContain('unavailable');expect(h.store.get(PIN_STORE_KEY('conversation-a'))).toEqual(before)
})
test('serialized commands retain both fields instead of losing one concurrent update',async()=>{
 const h=v2Setup();await h.start()
 let release!:()=>void,entered!:()=>void
 const ready=new Promise<void>(r=>{entered=r}),gate=new Promise<void>(r=>{release=r}),set=h.$.store.set
 let first=true
 h.$.store.set=async(k:string,v:unknown)=>{if(first){first=false;entered();await gate}return set(k,v)}
 const model=h.run('pin model concurrent');await ready;const effort=h.run('pin effort high');release();await Promise.all([model,effort])
 expect((h.store.get(PIN_STORE_KEY('conversation-a')) as any).pins.map((p:any)=>p.field)).toEqual(['model','effort'])
})
test('a conversation change during a pending read cannot write stale intent under the new identity',async()=>{
 const h=v2Setup();await h.start()
 let release!:()=>void,entered!:()=>void
 const ready=new Promise<void>(r=>{entered=r}),gate=new Promise<void>(r=>{release=r}),get=h.$.store.get
 h.$.store.get=async(k:string)=>{if(k===PIN_STORE_KEY('conversation-a')){entered();await gate}return get(k)}
 const work=h.run('pin model stale');await ready;h.setId('conversation-b');release()
 expect((await work).text).toContain('unavailable');expect(h.calls.writes).toBe(0);expect(h.store.has(PIN_STORE_KEY('conversation-b'))).toBe(false)
})
test('persistent pins go through native configuration and survive a fresh control registration',async()=>{
 const h=v2Setup();await h.start();expect((await h.run('pin model persistent --scope persistent')).text).toContain('Persistent setting saved')
 expect(h.calls.config).toBe(1);expect(h.controls.pins.persistent[0]!.value).toBe('persistent')
 const resumed=v2Setup({},h.store,h.settings);await resumed.start();expect(resumed.controls.pins.persistent[0]!.value).toBe('persistent')
 await resumed.run('unpin model --scope persistent');expect(resumed.controls.pins.persistent).toEqual([])
 expect(resumed.settings.user.pluginConfigs['jev-model-router'].options.persistentModelPin).toBe('')
})
test('managed persistent/check definitions take precedence and locked defaults cannot be changed',async()=>{
 const check=JSON.stringify({schemaVersion:1,checks:[{id:'managed',command:'node scripts/smoke.mjs',cwd:'.',timeoutMs:1234}]})
 const h=v2Setup({},new Map(),{user:userOptions({persistentModelPin:'user',verificationChecksJson:'{"schemaVersion":1,"checks":[]}'}),policy:userOptions({persistentModelPin:'managed',verificationChecksJson:check})})
 h.locked.add('persistentModelPin');await h.start()
 expect(h.controls.pins.persistent[0]!.value).toBe('managed');expect(h.controls.pins.persistent[0]!.source).toBe('managed-policy')
 expect(h.controls.pins.checksSource).toBe('policy');expect(h.controls.pins.checksJson).toBe(check)
 expect((await h.run('unpin model --scope persistent')).text).toContain('unavailable');expect(h.calls.config).toBe(0)
})
test('project/local/flag or unobservable values cannot create persistent pin/check authority',async()=>{
 const h=v2Setup({persistentModelPin:'untrusted',verificationChecksJson:'{"schemaVersion":1,"checks":[{"id":"evil"}]}'})
 await h.start();expect(h.controls.pins.persistent).toEqual([]);expect(h.controls.pins.checksSource).toBeNull()
 h.failSettings(true);await h.run('status');expect(h.controls.pins.authorityError!==null).toBe(true)
 expect((await h.run('pin model injected --scope persistent')).text).toContain('unavailable');expect(h.calls.config).toBe(0)
})
test('check definition validation rejects duplicate IDs, traversal, invalid commands and timeouts',()=>{
 const checks=(over:any)=>JSON.stringify({schemaVersion:1,checks:[{id:'offline',command:'node scripts/smoke.mjs',cwd:'.',timeoutMs:120000,...over}]})
 expect(validateChecksJson(checks({cwd:"folder with 'quotes' $ and `ticks`"}))).toBe(true)
 for(const over of [{cwd:'../outside'},{cwd:'/absolute'},{cwd:'C:\\outside'},{command:''},{timeoutMs:0},{timeoutMs:600001}])expect(validateChecksJson(checks(over))).toBe(false)
 expect(validateChecksJson('{"schemaVersion":1,"checks":[{"id":"a","command":"x","cwd":".","timeoutMs":1},{"id":"a","command":"y","cwd":".","timeoutMs":1}]}')).toBe(false)
})
test('native writes require composer provenance and deny invalid/unsupported values before downstream',async()=>{
 const h=v2Setup();await h.start()
 for(const origin of ['plugin','bridge','sdk','unclassified'])expect((await h.set('persistentModelPin','injected',origin)).deny!==undefined).toBe(true)
 expect((await h.set('policyEngine','v2')).deny!==undefined).toBe(true)
 expect((await h.set('verificationChecksJson','invalid')).deny!==undefined).toBe(true)
 expect(h.calls.config).toBe(0)
 await h.set('reviewMode','automatic');expect(h.controls.currentV2().reviewMode).toBe('automatic');expect(h.calls.spawn).toBe(0)
})
test('unsupported engines cannot be selected from commands; staged review/effort controls never launch work',async()=>{
 const h=v2Setup();await h.start();expect((await h.run('engine v2-shadow')).text).toContain('unavailable');expect(h.controls.currentV2().policyEngine).toBe('legacy')
 await h.run('review-mode automatic');await h.run('subagent-effort on')
 expect(h.controls.currentV2()).toEqual({policyEngine:'legacy',reviewMode:'automatic',routeSubagentEffort:true})
 expect(h.calls.model+h.calls.http+h.calls.spawn+h.calls.files).toBe(0)
})
test('candidate/review/accept commands remain unavailable without file access, checks or reviewers',async()=>{
 const h=v2Setup()
 for(const cmd of ['candidate register manifest.json','review','review cand_x','accept cand_x'])expect((await h.run(cmd)).text).toContain('unavailable')
 expect(h.calls.writes+h.calls.files+h.calls.http+h.calls.model+h.calls.spawn).toBe(0)
})
test('invalid engines hold prompt, request and spawn instead of silently applying Basic',async()=>{
 for(const policyEngine of ['invalid']){
  const h=v2Setup({policyEngine},undefined,undefined,true)
  let downstream=0
  expect((await h.handlers['prompt.submit'](h.$,{text:'Implement a feature'},async()=>{downstream++;return {}})).drop!==undefined).toBe(true)
  const stream=h.handlers['turn.step'](h.$,{model:'sonnet',effort:'medium',turnId:'held',index:0},async function*(){downstream++;yield {}})
  let result:any;for(;;){const item=await stream.next();if(item.done){result=item.value;break}}
  expect(result.toolUses).toEqual([])
  expect((await h.handlers['agent.spawn'](h.$,{},async()=>{downstream++;return {}})).deny!==undefined).toBe(true)
  expect(downstream+h.calls.http+h.calls.model+h.calls.spawn).toBe(0)
 }
})
test('guard error handlers fail closed before dispatch for unsupported engines and control writes',async()=>{
 const h=v2Setup({policyEngine:'v2'},undefined,undefined,true)
 let calls=0;const next:any=()=>{calls++;return {}};next.called=false
 expect((await h.errors['prompt.submit'](h.$,{text:'work'},next)).drop!==undefined).toBe(true)
 expect((await h.errors['agent.spawn'](h.$,{},next)).deny!==undefined).toBe(true)
 expect((await h.errors['config.set'](h.$,{},next)).deny!==undefined).toBe(true)
 expect((await h.errors['command.run'](h.$,{command:'router'},next)).text).toContain('unavailable')
 const stream=h.errors['turn.step'](h.$,{turnId:'held',index:0},next)
 let result:any;for(;;){const item=await stream.next();if(item.done){result=item.value;break}}
 expect(result.toolUses).toEqual([]);expect(calls+h.calls.http+h.calls.model+h.calls.spawn).toBe(0)
})
test('post-dispatch error handling uses host replay rather than retroactively denying an applied setting',async()=>{
 const h=v2Setup();const cached={value:'medium'};let replays=0
 const next:any=async()=>{replays++;return cached};next.called=true
 expect(await h.errors['config.set'](h.$,{},next)).toEqual(cached)
 expect(replays).toBe(1);expect(h.calls.config).toBe(0)
})
test('denied or normalized persistent updates are not falsely acknowledged as the requested pin',async()=>{
 const denied=v2Setup();await denied.start();denied.$.config.set=async()=>({deny:'policy'})
 expect((await denied.run('pin model desired --scope persistent')).text).toContain('unavailable')
 expect(denied.controls.pins.persistent).toEqual([])
 const rewritten=v2Setup();await rewritten.start()
 rewritten.$.config.set=async(e:any)=>rewritten.coreSet(e.key,'different-model')
 const result=await rewritten.run('pin model desired --scope persistent')
 expect(result.text).toContain('unavailable');expect(result.text).toContain('setting was written')
 expect(rewritten.controls.pins.persistent[0]!.value).toBe('different-model')
})
test('legacy pin storage migrates on read without writes; unknown native origins remain diagnostic',async()=>{
 const h=v2Setup()
 h.store.set(PIN_STORE_KEY('conversation-a',1),{schemaVersion:1,conversationId:'conversation-a',pins:[
  {field:'model',value:'old-user',scope:'session',source:'router-command'},
  {field:'effort',value:4096,scope:'session',source:'native'},
 ]})
 await h.start();expect(h.controls.pins.pins!.schemaVersion).toBe(2);expect(h.calls.writes).toBe(0)
 const status=(await h.run('status')).text;expect(status).toContain('old-user (session');expect(status).toContain('origin unknown')
 await h.run('pin model updated')
 const saved:any=h.store.get(PIN_STORE_KEY('conversation-a'))
 expect(saved.schemaVersion).toBe(2);expect(saved.pins.find((p:any)=>p.source==='native').purpose).toBeNull()
})
test('status records the last legacy router request but does not claim an observed serving identity',async()=>{
 const h=v2Setup({},undefined,undefined,true);await h.start()
 const stream=h.handlers['turn.step'](h.$,{model:'Exact-Request',effort:'high',index:0,turnId:'legacy-turn'},async function*(e:any){return {turnId:e.turnId,index:e.index,answer:'',toolUses:[],stopReason:'end_turn',usage:null}})
 for await(const _ of stream){}
 const status=(await h.run('status')).text
 expect(status).toContain('legacy Exact-Request/high for legacy-turn');expect(status).toContain('serving identity unknown')
 expect(h.calls.http+h.calls.model).toBe(0)
})
test('explicit launch flags override the legacy save cache but never managed routing permissions',async()=>{
 const h=v2Setup({},undefined,{user:{},policy:{},flag:userOptions({routeMainModel:true})})
 h.store.set('model-router.defaults.v1',{...initial,mainModel:false});await h.start();expect(h.controls.current().mainModel).toBe(true)
 const managed=v2Setup({},undefined,{user:{},policy:userOptions({routeMainModel:false}),flag:userOptions({routeMainModel:true})})
 await managed.start();expect(managed.controls.current().mainModel).toBe(false)
})
test('legacy namespace conflicts cannot invalidate unrelated pin and workflow authority',async()=>{
 const settings={user:{pluginConfigs:{'jev-model-router':{options:{routeMainModel:true}},'jev-model-router@inline':{options:{routeMainModel:false}}}},policy:{}}
 const h=v2Setup({},undefined,settings);await h.start();expect(h.controls.pins.authorityError).toBeNull()
 expect((await h.run('pin model exact')).text).toContain('Execution intent saved')
})
test('repair and scope-confirmed verification require exact composer command syntax',()=>{
 expect(parseRouterCommand('repair cand_x')).toEqual({kind:'repair',candidateId:'cand_x'})
 expect(parseRouterCommand('verify cand_x --confirm-scope')).toEqual({kind:'verify',candidateId:'cand_x',confirmScope:true})
 expect(parseRouterCommand('verify cand_x --unknown')).toEqual({kind:'error'})
 expect(parseRouterCommand('candidate status cand_x')).toEqual({kind:'candidate-status',candidateId:'cand_x'})
})

test('master commands preserve preferences and require composer provenance',async()=>{
 const h=setup()
 expect(parseRouterCommand('off')).toEqual({kind:'change',patch:{enabled:false}})
 expect(parseRouterCommand('on')).toEqual({kind:'change',patch:{enabled:true}})
 expect(parseRouterCommand('off now')).toEqual({kind:'error'})
 await h.run('off','plugin');expect(h.controls.current()).toEqual(initial)
 expect((await h.run('off')).text).toContain('stopped')
 expect(h.controls.current()).toEqual({...initial,enabled:false});expect(h.store.size).toBe(0)
 await h.run('on');expect(h.controls.current()).toEqual(initial)
})
test('saved disabled defaults reload and old saves preserve the master plugin option',async()=>{
 const h=setup();await h.run('off');await h.run('save')
 const restored=setup(h.store.get('model-router.defaults.v1'))
 await restored.handlers['session.start'](restored.$,{},async()=>({}))
 expect(restored.controls.current().enabled).toBe(false)
 await restored.run('reset');expect(restored.controls.current()).toEqual(initial)
 const {enabled,...old}=initial
 const legacy=setup(old);legacy.controls.initial.enabled=false;legacy.controls.state.enabled=false
 await legacy.handlers['session.start'](legacy.$,{},async()=>({}))
 expect(legacy.controls.current().enabled).toBe(false)
 const malformed=setup({...initial,enabled:'false'})
 await malformed.handlers['session.start'](malformed.$,{},async()=>({}))
 expect(malformed.controls.current()).toEqual(initial)
})
test('native master switch is visible, persists, honors denial and rejects plugin writes',async()=>{
 const h=v2Setup()
 expect(manifest.userConfig.enabled.default).toBe(true)
 const row=await h.handlers['config.describe'](h.$,{key:'jev-model-router.enabled',provider:{plugin:'jev-model-router@inline'}},async(e:any)=>e)
 expect(row.label).toBe('Router · Enable model router')
 await h.set('enabled',false,'plugin');expect(h.controls.current().enabled).toBe(true)
 await h.set('enabled','false');expect(h.controls.current().enabled).toBe(true)
 h.locked.add('enabled');await h.set('enabled',false);expect(h.controls.current().enabled).toBe(true)
 h.locked.delete('enabled');await h.set('enabled',false)
 expect(h.controls.current().enabled).toBe(false)
 expect((h.store.get('model-router.defaults.v1') as RouterSettings).enabled).toBe(false)
 const reload=v2Setup({enabled:false},h.store,h.settings);await reload.start()
 expect(reload.controls.current().enabled).toBe(false)
 await reload.set('enabled',true);expect(reload.controls.current().enabled).toBe(true)
})
test('master launch and managed settings override stale saved defaults',async()=>{
 const h=v2Setup({},new Map([['model-router.defaults.v1',{...initial,enabled:false}]]),{user:{},policy:userOptions({enabled:false}),flag:userOptions({enabled:true})})
 await h.start();expect(h.controls.current().enabled).toBe(false)
 const flag=v2Setup({},new Map([['model-router.defaults.v1',initial]]),{user:{},policy:{},flag:userOptions({enabled:false})})
 await flag.start();expect(flag.controls.current().enabled).toBe(false)
})
test('disabled entry points pass host events unchanged without any router I/O in every engine',async()=>{
 for(const policyEngine of ['legacy','v2-shadow','v2','invalid'])for(const provider of ['builtin','typesafe']){
  const handlers:any={},errors:any={}
  register(recordHooks(handlers,errors) as any,{enabled:false,policyEngine,provider,typesafeApiKey:'fake'} as any)
  const $={} // Any attempted classification, metadata read, telemetry or guard would fail.
  for(const name of ['prompt.submit','turn.start','turn.complete','agent.spawn','tool.call']){
   const e={text:'Task',turnId:'t',model:'host-model',tool:'Read'}
   expect(await handlers[name]($,e,async(x:any)=>x)).toBe(e)
  }
  const step={turnId:'t',index:0,model:'host-model',effort:'high'};let forwarded:any
  for await(const _ of handlers['turn.step']($,step,async function*(e:any){forwarded=e;yield e})){}
  expect(forwarded).toBe(step)
  expect((await handlers['tool.call']($,{tool:'mcp__jev-model-router__candidate_checkpoint'},async()=>{throw Error('checkpoint dispatched')})).deny).toContain('stopped')
  for(const name of ['prompt.submit','agent.spawn','tool.call']){
   const next:any=async(e:any)=>e;next.called=false
   expect(await errors[name]($,step,next)).toBe(step)
  }
 }
})
test('disabled session skips harness initialization and workflow commands do no work',async()=>{
 const h=v2Setup({enabled:false,policyEngine:'v2',reviewMode:'automatic'},undefined,undefined,true)
 await h.start()
 expect(h.calls.files).toBe(0);expect(h.calls.writes).toBe(0)
 for(const command of ['candidate register manifest.json','review candidate','repair candidate','verify candidate','accept candidate'])expect((await h.run(command)).text).toContain('stopped')
 expect(h.calls.http+h.calls.model+h.calls.spawn+h.calls.files+h.calls.writes).toBe(0)
})
test('stopping invalidates v2 assignments and aborts controlled workflow work',async()=>{
 const h=v2Setup({policyEngine:'v2'},undefined,undefined,true)
 // Capture the actual entry-point runtime, including its registered controls.
 const handlers:any={};let runtime:any
 registerWithAdapters(recordHooks(handlers) as any,{policyEngine:'v2'} as any,{onRuntimeReady:r=>{runtime=r}})
 const controller=new AbortController()
 runtime.workflow={controllers:new Map([['review',controller]])}
 runtime.assignments.old={complete:false,cancelled:false}
 runtime.pending.push({text:'stale',origin:'composer'})
 await handlers['command.run'](h.$,{command:'router',args:'off',origin:{kind:'composer'}},async()=>({}))
 expect(controller.signal.aborted).toBe(true);expect(runtime.assignments.old.cancelled).toBe(true);expect(runtime.pending.length).toBe(0)
 expect(runtime.controls.current().enabled).toBe(false)
})
function stoppableLegacy(){
 const handlers:any={};let calls=0,resolve:any
 register(recordHooks(handlers) as any,{typesafeApiKey:'fake',routeMainModel:true,routeMainEffort:true} as any)
 const response={ok:true,text:JSON.stringify({answers:{tier:{choice:'fast',confidence:1},effort:{score:0,confidence:1},risky:{noul:0}}})}
 const $:any={ui:{log:()=>{},status:()=>{}},clock:{now:async()=>0,sleep:()=>new Promise(()=>{})},http:{fetch:()=>{calls++;return new Promise(r=>{resolve=()=>r(response)})}}}
 const run=(args:string)=>handlers['command.run']($,{command:'router',args,origin:{kind:'composer'}},async()=>({}))
 const step=async(index=0)=>{const e={turnId:'t',index,model:'sonnet',effort:'high'};let forwarded:any;for await(const _ of handlers['turn.step']($,e,async function*(x:any){forwarded=x;yield x})){}return forwarded}
 return {handlers,$,run,step,get calls(){return calls},finish:()=>resolve()}
}
test('stop ignores an in-flight legacy classification even if enabled again before it finishes',async()=>{
 const h=stoppableLegacy(),prompt=h.handlers['prompt.submit'](h.$,{text:'Task'},async(e:any)=>e)
 for(let i=0;i<30&&!h.calls;i++)await Promise.resolve()
 expect(h.calls).toBe(1)
 await h.run('off');await h.run('on');h.finish();await prompt
 expect((await h.step()).model).toBe('sonnet')
 const fresh=h.handlers['prompt.submit'](h.$,{text:'Fresh task'},async(e:any)=>e)
 for(let i=0;i<30&&h.calls<2;i++)await Promise.resolve()
 expect(h.calls).toBe(2)
 h.finish();await fresh
 expect((await h.step()).model).toBe('claude-haiku-5-5')
})
test('stop drops cached turn overrides and resumes with the existing preferences',async()=>{
 const h=stoppableLegacy(),prompt=h.handlers['prompt.submit'](h.$,{text:'Task'},async(e:any)=>e)
 for(let i=0;i<30&&!h.calls;i++)await Promise.resolve()
 expect(h.calls).toBe(1)
 h.finish();await prompt;expect((await h.step()).model).toBe('claude-haiku-5-5')
 await h.run('off');expect((await h.step(1)).model).toBe('sonnet')
 await h.run('on');expect((await h.step(2)).model).toBe('sonnet')
})

test('provider preset supports session commands and saved native settings', async()=>{
 const h=v2Setup()
 await h.start()
 expect((await h.run('preset gpt')).text).toContain('Provider preset: gpt')
 expect(h.controls.current()).toEqual({...initial,mode:'observe',mainEffort:true,providerPreset:'gpt'})
 await h.run('preset claude','plugin');expect(h.controls.current().providerPreset).toBe('gpt')
 await h.set('providerPreset','unknown');expect(h.controls.current().providerPreset).toBe('gpt')
 await h.set('providerPreset','claude');await h.start()
 expect(h.controls.current().providerPreset).toBe('claude')
 await h.run('preset mixed');expect(h.controls.current().providerPreset).toBe('mixed')
 expect(h.values.providerPreset).toBe('claude')
})

test('legacy routing changes provider for the next turn and keeps the active turn model', async()=>{
 const h=stoppableLegacy()
 const classify=async()=>{
  const calls=h.calls
  const prompt=h.handlers['prompt.submit'](h.$,{text:'Small task'},async(e:any)=>e)
  for(let i=0;i<30&&h.calls===calls;i++)await Promise.resolve()
  expect(h.calls).toBe(calls+1);h.finish();await prompt
 }
 await h.run('preset gpt');await classify()
 expect((await h.step()).model).toBe('gpt-6-luna')
 await h.run('preset claude')
 expect((await h.step(1)).model).toBe('gpt-6-luna')
 await classify();expect((await h.step()).model).toBe('claude-haiku-5-5')
})

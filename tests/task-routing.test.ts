import {expect,test} from 'claude-code/testing'
import {readFileSync} from 'node:fs'
import {parseCatalog} from '../hooks/model-catalog.ts'
import {taskQuestions,readTaskClassification,recommendTask,DEFAULT_PREFERENCES} from '../hooks/task-routing.ts'
import type {TaskClassification} from '../hooks/task-routing.ts'
import {requestBody,readDecision} from '../hooks/policy.ts'
import {register} from '../hooks/jev-model-router.ts'
const catalog=()=>{const c=parseCatalog(JSON.parse(readFileSync(new URL('../catalog/models.json',import.meta.url),'utf8')));for(const m of c.models){m.availability='advertised';m.claudeCodeCompatibility='unverified'}return c}
const task=(role:TaskClassification['role'],implementationCategory:TaskClassification['implementationCategory']='not-applicable'):TaskClassification=>({role,implementationCategory,roleConfidence:.95,categoryConfidence:.95})
const verified=()=>{const c=catalog();for(const m of c.models){m.availability='verified';m.claudeCodeCompatibility='verified';m.capabilities.toolCalling=true;m.capabilities.reasoningEfforts=['medium']}return c}
const answers=(role='implementation',category='specified')=>({tier:{choice:'fast',confidence:.99},effort:{score:0,confidence:.99},risky:{noul:.01},taskRole:{choice:role,confidence:.95},implementationCategory:{choice:category,confidence:.95}})
test('task questions include architecture and contrasting frontend boundary guidance',()=>{
 const q=taskQuestions() as any
 expect(q.taskRole.instructions).toContain('Architecture is design-led')
 expect(q.taskRole.instructions).toContain('exact mockup')
})
test('task classification remains opt-in for legacy request consumers',()=>{
 expect(JSON.parse(requestBody('typesafe',{},'jev')).questions.taskRole).toBeUndefined()
 expect(JSON.parse(requestBody('typesafe',{},'jev',true)).questions.taskRole.type).toBe('choice')
})
test('valid task dimensions are parsed alongside the legacy decision',()=>{
 const decision=readDecision(JSON.stringify({answers:answers()}))
 expect(decision?.task?.implementationCategory).toBe('specified')
 expect(decision?.tier).toBe('fast')
})
test('inconsistent categories and unknown roles are rejected',()=>{
 expect(readTaskClassification({taskRole:{choice:'implementation'},implementationCategory:{choice:'not-applicable'}})).toBeNull()
 expect(readTaskClassification({taskRole:{choice:'file-scout'},implementationCategory:{choice:'mechanical'}})).toBeNull()
 expect(readTaskClassification({taskRole:{choice:'invented'}})).toBeNull()
})
test('each implementation category selects its configured preference',()=>{
 for(const [category,id] of [['design-led',DEFAULT_PREFERENCES.designLed],['specified',DEFAULT_PREFERENCES.specified],['mechanical',DEFAULT_PREFERENCES.mechanical]] as const)
  expect(recommendTask(task('implementation',category),verified()).model).toBe(id)
})
test('orchestration is Opus/medium; visual analysis is Astra; scouting is Haiku',()=>{
 expect(recommendTask(task('orchestration'),verified()).effort).toBe('medium')
 expect(recommendTask(task('orchestration'),verified()).model).toBe(DEFAULT_PREFERENCES.orchestration)
 expect(recommendTask(task('visual-analysis'),verified()).model).toBe('gpt-6-astra')
 expect(recommendTask(task('file-scout'),verified()).model).toBe(DEFAULT_PREFERENCES.fileScout)
})
test('unverified catalog entries yield a visible preference but no applicable change',()=>{
 const r=recommendTask(task('implementation','specified'),catalog())
 expect(r.preferredModel).toBe(DEFAULT_PREFERENCES.specified);expect(r.model).toBeNull()
})
test('missing confidence, low confidence and disabled models block application',()=>{
 expect(recommendTask({...task('file-scout'),roleConfidence:null},verified()).model).toBeNull()
 expect(recommendTask({...task('implementation','specified'),categoryConfidence:.7},verified()).model).toBeNull()
 const c=verified();c.models.find(m=>m.id===DEFAULT_PREFERENCES.specified)!.enabled=false
 expect(recommendTask(task('implementation','specified'),c).model).toBeNull()
})
test('risk escalation and unsupported task roles retain legacy policy',()=>{
 expect(recommendTask(task('implementation','mechanical'),verified(),DEFAULT_PREFERENCES,.8,true).model).toBeNull()
 expect(recommendTask(task('review'),verified()).preferredModel).toBeNull()
})
test('orchestration medium must be supported and preference overrides must exist',()=>{
 const c=verified();c.models.find(m=>m.id===DEFAULT_PREFERENCES.orchestration)!.capabilities.reasoningEfforts=[]
 expect(recommendTask(task('orchestration'),c).model).toBeNull()
 expect(recommendTask(task('file-scout'),verified(),{...DEFAULT_PREFERENCES,fileScout:'missing'}).model).toBeNull()
})
test('nonfinite confidence cannot authorize routing',()=>{
 const a=answers();a.taskRole.confidence=NaN
 expect(readTaskClassification(a)?.roleConfidence).toBeNull()
})
// Exercise actual registered hooks with the Claude runtime mocked, without model calls.
function harness(mode:string){
 const handlers:any={};const logs:string[]=[];let sent:any
 register(((name:string,handler:any)=>{handlers[name]=handler}) as any,{taskRoutingMode:mode} as any)
 const $:any={ui:{log:(x:string)=>logs.push(x),status:()=>{}},clock:{now:async()=>0,sleep:()=>new Promise(()=>{})},http:{fetch:async(_u:any,opts:any)=>{sent=JSON.parse(opts.body);return {ok:true,text:JSON.stringify({answers:answers()})}}}}
 return {handlers,$,logs,get sent(){return sent}}
}
test('observe hooks collect new fields but keep legacy routing',async()=>{
 const h=harness('observe')
 // Configure a key to use the HTTP path instead of the built-in classifier.
 const handlers:any={};register(((n:string,f:any)=>handlers[n]=f) as any,{taskRoutingMode:'observe',typesafeApiKey:'fake',routeMainModel:true} as any)
 await handlers['prompt.submit'](h.$,{text:'Implement the supplied spec'},async(e:any)=>e)
 let result:any
 for await(const _ of handlers['turn.step'](h.$,{model:'sonnet',effort:'medium',index:0,turnId:'a'},async function*(e:any){result=e;yield e})){}
 expect(h.sent.questions.taskRole.type).toBe('choice')
 expect(result.model).toBe('claude-haiku-4-5-20251001')
})
test('apply hooks keep current model when preferred catalog entry is unverified',async()=>{
 const h=harness('apply');const handlers:any={}
 register(((n:string,f:any)=>handlers[n]=f) as any,{taskRoutingMode:'apply',typesafeApiKey:'fake',routeMainModel:true,specifiedModel:'gpt-6.1-terra'} as any)
 await handlers['prompt.submit'](h.$,{text:'Implement supplied spec'},async(e:any)=>e)
 let result:any
 for await(const _ of handlers['turn.step'](h.$,{model:'sonnet',effort:'medium',index:0,turnId:'a'},async function*(e:any){result=e;yield e})){}
 expect(result.model).toBe('sonnet');expect(result.effort).toBe('medium')
})
test('off mode omits task questions and subagent forks remain untouched',async()=>{
 const h=harness('off');const handlers:any={}
 register(((n:string,f:any)=>handlers[n]=f) as any,{taskRoutingMode:'off',typesafeApiKey:'fake'} as any)
 await handlers['prompt.submit'](h.$,{text:'x'},async(e:any)=>e)
 expect(h.sent.questions.taskRole).toBeUndefined()
 const e={fork:true,model:'opus'};expect(await handlers['agent.spawn'](h.$,e,async(x:any)=>x)).toEqual(e)
})

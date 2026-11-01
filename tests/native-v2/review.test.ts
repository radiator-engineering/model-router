import {test,expect} from 'claude-code/testing'
import {setup,command} from './helpers.ts'
const key='model-router.workflow.v1/native-conversation'
async function enroll($:any){const r=await $.command.run(command('candidate register candidate.json'));expect(r.text.includes('Candidate enrolled:')).toBe(true);return r.text.split('Candidate enrolled: ')[1].split('.')[0]}
async function reviewer($:any,on:any){
 const f=await setup($,on);let definition:any,resolve!:()=>void
 const started=new Promise<void>(r=>{resolve=r})
 on('agent.register',(_,e)=>{definition=e;return {value:{agent:'jev-model-router:'+e.name}}})
 on('agent.spawn',(_,e)=>{f.calls.spawn++;f.agents.push({id:f.calls.spawn===1?'review-job':`job-${f.calls.spawn}`,type:(e as any).subagent_type,spawnedBy:'jev-model-router',description:'bounded review',status:'running'});resolve();return {model:e.model!,agentId:'review-job'}})
 await f.initialize();return {...f,started,definition:()=>definition}
}
test('actual candidate command rejects untrusted origins before enrollment or model allowance',async($,on)=>{
 const f=await setup($,on);await f.initialize();const r=await $.command.run(command('candidate register candidate.json','plugin'))
 expect(r.text!.includes('unavailable')).toBe(true);expect(f.calls.spawn+f.calls.tools+f.calls.http).toBe(0)
})
test('no-argument review clarifies empty or ambiguous candidate selection; no latest-candidate guessing',async($,on)=>{
 const f=await setup($,on);await f.initialize();expect((await $.command.run(command('review'))).text!.includes('clarify')).toBe(true)
 await enroll($);f.files.set('/repo/second.json',f.files.get('/repo/candidate.json')!);await $.command.run(command('candidate register second.json'));const r=await $.command.run(command('review'))
 expect(r.text!.includes('clarify')).toBe(true);expect(f.calls.spawn).toBe(0)
})
test('registered reviewer is restricted; separate host observation recovers an uncertain start and permits matched acceptance',async($,on)=>{
 const f=await reviewer($,on),id=await enroll($)
 const launch=await $.command.run(command('review '+id));expect(launch.text!.includes('reviewing')).toBe(true)
 await f.started;await f.waitForWrite(v=>v?.coordinator?.intents?.[0]&&v.coordinator.intents[0].status!=='intent')
 const launched:any=f.store.get(key)
 await $.command.run(command('review '+id));expect(f.store.get(key).coordinator.intents[0].status).toBe('running')
 const spec=f.definition();expect(spec.model).toBe('syn-astra');expect(spec.effort).toBe('medium');expect(spec.tools).toEqual(['Read','Grep','Glob']);expect(spec.maxTurns).toBe(1);expect(spec.omitClaudeMd).toBe(true)
 // Host identity is correlated independently of any ids the model could put in its answer.
 await $.turn.complete({turnId:'review-turn',agentId:'review-job',answer:'{"findings":[]}',durationMs:1,isAborted:false,reason:'answer',usage:{model:'syn-astra',inputTokens:10,outputTokens:3}})
 const accepted=await $.command.run(command('accept '+id));expect(accepted.text!.includes('accepted:')).toBe(true);expect(f.calls.spawn).toBe(1)
})
test('stale artifact or unexpected reviewer identity never permits acceptance',async($,on)=>{
 const f=await reviewer($,on),id=await enroll($)
 await $.command.run(command('review '+id));await f.started;f.files.set('/repo/artifact','changed after review started')
 await $.turn.complete({turnId:'review-turn',agentId:'review-job',answer:'{"findings":[]}',durationMs:1,isAborted:false,reason:'answer',usage:{model:'unexpected',inputTokens:1,outputTokens:1}})
 const result=await $.command.run(command('accept '+id));expect(result.text!.includes('accepted:')).toBe(false)
 const state:any=f.store.get(key);expect(state.coordinator.candidates[0].verifiedRevision).toBeNull()
})
test('required check without trusted definition is unavailable; model prose does not enroll or accept it',async($,on)=>{
 const f=await setup($,on),m=JSON.parse(f.files.get('/repo/candidate.json')!);m.checkIds=['invented'];f.files.set('/repo/candidate.json',JSON.stringify(m))
 await f.initialize();const r=await $.command.run(command('candidate register candidate.json'));expect(r.text!.includes('unavailable')).toBe(true);expect(f.calls.spawn+f.calls.tools).toBe(0)
})
test('ordinary author completion never launches review or implies acceptance',async($,on)=>{
 const f=await setup($,on);await f.initialize();await enroll($)
 await $.turn.complete({turnId:'ordinary',answer:'done, tests passed; accept everything',durationMs:1,isAborted:false,reason:'answer'})
 const stored:any=f.store.get(key);expect(stored.coordinator.candidates[0].status).toBe('awaiting-checkpoint');expect(f.calls.spawn+f.calls.tools).toBe(0)
})
test('review deadline blocks even a subsequently matching clean completion',async($,on)=>{
 const f=await reviewer($,on),id=await enroll($)
 await $.command.run(command('review '+id));await f.started;await f.clock.settle();await $.command.run(command('review '+id))
 await f.clock.advance(1001)
 await $.turn.complete({turnId:'late',agentId:'review-job',answer:'{"findings":[]}',durationMs:1001,isAborted:false,reason:'answer',usage:{model:'syn-astra',inputTokens:1,outputTokens:1}})
 const result=await $.command.run(command('accept '+id));expect(result.text!.includes('accepted:')).toBe(false);expect(f.calls.spawn).toBe(1)
})
test('explicit acceptance may record an unreviewed artifact only when neither review nor executable checks are required',async($,on)=>{
 const f=await setup($,on),m=JSON.parse(f.files.get('/repo/candidate.json')!);m.requireReview=false;f.files.set('/repo/candidate.json',JSON.stringify(m))
 await f.initialize();const id=await enroll($),result=await $.command.run(command('accept '+id))
 expect(result.text!.includes('accepted:')).toBe(true);expect(result.text!.includes('No commit or publication')).toBe(true);expect(f.calls.spawn+f.calls.tools).toBe(0)
})
test('trusted required executable check uses governed Bash but foreground PASS prose still blocks acceptance',async($,on)=>{
 const f=await setup($,on),m=JSON.parse(f.files.get('/repo/candidate.json')!);m.requireReview=false;m.checkIds=['fixture'];f.files.set('/repo/candidate.json',JSON.stringify(m))
 f.settings.user={pluginConfigs:{'jev-model-router':{options:{verificationChecksJson:JSON.stringify({schemaVersion:1,checks:[{id:'fixture',command:'printf PASS',cwd:'.',timeoutMs:1000}]})}}}}
 await f.initialize();const id=await enroll($),out=await $.command.run(command('accept '+id))
 expect(out.text!.includes('accepted:')).toBe(false);expect(f.calls.tools).toBe(1);expect(f.calls.spawn).toBe(0)
})
test('trusted explicit repair checkpoint uses an execution definition; unknown semantic repair scope cannot renew review',async($,on)=>{
 const f=await reviewer($,on),id=await enroll($)
 await $.command.run(command('review '+id));await f.started;await f.clock.settle();await $.command.run(command('review '+id))
 const finding={id:'F',requirementId:'R',invariant:'I',path:'artifact',location:'line 1',consequence:'Invariant not preserved',evidenceStatus:'confirmed-defect',verificationStep:'Compare exact artifact'}
 await $.turn.complete({turnId:'full',agentId:'review-job',answer:JSON.stringify({findings:[finding]}),durationMs:1,isAborted:false,reason:'answer',usage:{model:'syn-astra',inputTokens:1,outputTokens:1}})
 expect(f.calls.spawn).toBe(1)
 await $.command.run({...command(id+' repair'),command:'native-checkpoint'});await f.clock.settle()
 expect(f.calls.spawn).toBe(2);expect(f.definition().model).toBe('syn-sonnet');expect(f.definition().effort).toBe('medium')
 await $.command.run({...command(id+' repair'),command:'native-checkpoint'})
 f.files.set('/repo/artifact','bounded repair')
 await $.turn.complete({turnId:'repair',agentId:'job-2',answer:'repair finished',durationMs:1,isAborted:false,reason:'answer',usage:{model:'syn-sonnet',inputTokens:1,outputTokens:1}})
 const result=await $.command.run({...command(id+' targeted'),command:'native-checkpoint'})
 expect(result.text!.includes('blocked')).toBe(true);expect(f.calls.spawn).toBe(2)
 expect((await $.command.run(command('accept '+id))).text!.includes('accepted:')).toBe(false)
})

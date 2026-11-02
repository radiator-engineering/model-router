/** Assignment kernel and narrowly typed native adapters. Unobserved facts never qualify a path. */
import type {EngineInterface, TurnStartInput, TurnStepInput, TurnStepResult, TurnStepChunk, TurnCompleteInput, AgentSpawnInput, AgentSpawnResult, PromptSubmitInput} from 'claude-code'
import type {CatalogV2} from '../model-catalog.ts'
import type {RouterSettings, V2Settings, RouterPinStatus} from '../router-controls.ts'
import {PIN_STORE_KEY, serializePinOperation, ensureRouterConversation} from '../router-controls.ts'
import type {createRouterControls} from '../router-controls.ts'
import {requestHeaders} from '../policy.ts'
import type {Provider} from '../policy.ts'
import {normalizeV2Response, v2RequestBody} from './classifier.ts'
import {decide} from './policy.ts'
import type {PolicyData} from './policy-data.ts'
import {effortTokenOf, fingerprint, canonicalJson, isObject} from './contract.ts'
import type {ClassifierOutput, EffortToken, PolicyDecision, PolicySnapshot, Purpose} from './contract.ts'
import {bindAssignmentPins, parsePinState, releaseAssignmentPins} from './pins.ts'
import type {PinState} from './pins.ts'
import {appendRecord, decisionRecord, legacyRecord, normalizeUsage, recordConsumption} from './records.ts'
import {sha256} from './artifacts.ts'
import type {DecisionRecord, Engine} from './records.ts'
import type {WorkflowAdapters,WorkflowState} from './review-harness.ts'

export interface RuntimeControls {
  current():RouterSettings; currentV2():V2Settings; pins:RouterPinStatus; engineError:string|null
}
export interface RequestFacts {
  /** These are trusted adapter facts, NOT classifier output or prompt fields. */
  routingAvailable:boolean
  modelOrigin:PolicySnapshot['current']['modelOrigin']
  effortOrigin:PolicySnapshot['current']['effortOrigin']
  requirements:PolicySnapshot['requirements']
  environment:PolicySnapshot['environment']
  resources:PolicySnapshot['resources']
  fallback:PolicySnapshot['fallback']
  shadowClassifierOptIn:boolean
}
export interface ClassificationResult {
  status:'ok'|'invalid'|'timeout'|'unmatched'
  output:ClassifierOutput|null
  elapsedMs:number|null
  usage?:unknown
}
export interface AssignmentInput {
  id:string; text:string; agentId?:string; parentId:string|null; lineageId:string
  purpose:Purpose; stage:'full'|'targeted'|null
  kind:'user'|'delegated'|'review'|'notification'
  matched:boolean
}
export interface AssignmentState {
  id:string; agentId:string|null; engine:Engine; legacyMode:RouterSettings['mode']
  input:Omit<AssignmentInput,'text'>
  classification:ClassificationResult
  legacyStats?:{elapsedMs:number|null;usage:unknown}
  controlSnapshot:PolicySnapshot['controls']
  snapshot:PolicySnapshot|null; decision:PolicyDecision|null; record:DecisionRecord|null
  originalPins:PinState|null; boundPins:PinState|null; pinBindingId:string;stepEffortPermission:boolean
  startedAt:number; generation:number; cancelled:boolean; complete:boolean;prepared:boolean
  applied:{model:string;effort:EffortToken}|null
  dispatched:number[]; allowedToolIds:string[]; toolCalls:number
  reservationAcquired:boolean; substitutionDispatched:boolean
}
export interface HarnessPorts {
  now():Promise<number>
  conversationId():Promise<string>
  sleep(ms:number):Promise<void>
  classify(text:string):Promise<ClassificationResult>
  facts(request:{model:string;effort?:string|number;agentId?:string}):Promise<RequestFacts>
  pinState():Promise<PinState>
  commitPins(expected:PinState,next:PinState):Promise<boolean>
  save():Promise<void>
  reserve(snapshot:PolicySnapshot,decision:PolicyDecision):Promise<boolean>
}
export interface HarnessAdapters {
  catalog?:CatalogV2
  policy?:PolicyData
  workflow?:WorkflowAdapters
  /** Trusted code may retain the owner for explicit workflow checkpoints; never exposed through JSON. */
  onRuntimeReady?(state:HarnessState):void
  /** External-fact boundary used by isolated tests or an explicitly trusted embedding. Not a JSON option. */
  facts?(request:{model:string;effort?:string|number;agentId?:string},native:RequestFacts):Promise<RequestFacts>
}
export interface HarnessConfig {
  catalog:CatalogV2;policy:PolicyData;legacyCatalog?:CatalogV2['legacy']
  classifier:{provider:Provider|null;url:string;model:string;apiKey:string;deadlineMs:number}
  logDecisions?:boolean
  pluginVersion:string|null; sourceRevision:string|null; sourceFingerprint?:string|null; adapters?:HarnessAdapters
}
export interface HarnessState {
  schemaVersion:1;conversationId:string|null;activation:string;generation:number
  controls:RuntimeControls;config:HarnessConfig
  assignments:Record<string,AssignmentState>;records:DecisionRecord[]
  pending:{text:string;origin:string;legacyStats?:{elapsedMs:number|null;usage:unknown}}[]
  currentMain:string|null
  provisional:Record<string,{assignmentId:string;agentId:string|null;uncertain:boolean}>
  lineageSubstitutions:Record<string,number>
  initialized:boolean
  workflow?:WorkflowState
}
export const RUNTIME_KEY=(id:string)=>`model-router.runtime.v1/${encodeURIComponent(id)}`
const ACTIVATION_KEY=(id:string)=>`${RUNTIME_KEY(id)}/activation`
export async function activeConversation($:EngineInterface,state:HarnessState):Promise<string> {
  const id=await $.session.id()
  return id===state.conversationId&&await $.store.get(ACTIVATION_KEY(id))===state.activation?id:''
}
export function createHarness(controls:RuntimeControls,config:HarnessConfig):HarnessState {
  return {schemaVersion:1,conversationId:null,activation:crypto.randomUUID(),generation:0,controls,config,
    assignments:{},records:[],pending:[],currentMain:null,provisional:{},lineageSubstitutions:{},initialized:false}
}
export function boundEngine(state:HarnessState,id?:string):Engine {
  return id&&state.assignments[id]?state.assignments[id]!.engine:state.controls.currentV2().policyEngine
}
export function holdMessage(a:AssignmentState|null):string {
  return a?.decision?`${a.decision.outcome}: ${a.decision.question??a.decision.blocker??a.decision.reasons.join(', ')}; no model request dispatched.`:'unavailable: assignment association or qualified request path is missing.'
}
export function intake(state:HarnessState,e:Pick<PromptSubmitInput,'text'|'origin'>):void {
  if(/^\/router(?:\s|$)/.test(e.text.trim()))return
  state.pending.push({text:e.text,origin:e.origin?.kind??'unclassified'})
  // More than one pending input is ambiguous, not permission to attach one result to another turn.
  if(state.pending.length>8)state.pending=state.pending.slice(-8).map(p=>({...p,origin:'unclassified'}))
}
export function invalidateHarness(state:HarnessState):void {
  for(const controller of state.workflow?.controllers.values()??[])controller.abort()
  state.generation++
  for(const a of Object.values(state.assignments))if(!a.complete)a.cancelled=true
  state.pending=[]
}

/** Classify once, bound to a canonical assignment. The prompt stays only in this stack, never durable state. */
export async function beginAssignment(state:HarnessState,input:AssignmentInput,ports:HarnessPorts):Promise<AssignmentState> {
  const old=state.assignments[input.id]
  if(old){if(old.input.purpose!==input.purpose||old.agentId!==(input.agentId??null))throw Error('assignment identity conflict');return old}
  if(Object.values(state.assignments).filter(a=>!a.complete).length>=64)throw Error('active assignment limit reached')
  const generation=state.generation,v2=state.controls.currentV2(),legacy=state.controls.current(),engine=v2.policyEngine,startedAt=0
  const text=input.text,identity={id:input.id,agentId:input.agentId,parentId:input.parentId,lineageId:input.lineageId,purpose:input.purpose,stage:input.stage,kind:input.kind,matched:input.matched}
  const a:AssignmentState={id:input.id,agentId:input.agentId??null,engine,legacyMode:legacy.mode,input:identity,
    controlSnapshot:{changeModel:input.agentId?legacy.subagents:legacy.mainModel,changeEffort:input.agentId?v2.routeSubagentEffort:legacy.mainEffort,reviewMode:v2.reviewMode},
    classification:{status:input.matched?'invalid':'unmatched',output:null,elapsedMs:null},snapshot:null,decision:null,record:null,
    originalPins:null,boundPins:null,pinBindingId:input.id,stepEffortPermission:!!input.agentId&&v2.routeSubagentEffort,startedAt,generation,cancelled:false,complete:false,prepared:false,applied:null,dispatched:[],allowedToolIds:[],toolCalls:0,
    reservationAcquired:false,substitutionDispatched:false}
  state.assignments[a.id]=a
  if(!legacy.enabled){a.cancelled=true;return a}
  a.startedAt=await ports.now()
  if(!state.controls.current().enabled||generation!==state.generation){a.cancelled=true;return a}
  if(!input.agentId)state.currentMain=a.id
  if(engine==='legacy'){a.prepared=true;await ports.save();return a}
  a.originalPins=await ports.pinState()
  const binding=bindAssignmentPins(a.originalPins,{conversationId:a.originalPins.conversationId,id:a.id,purpose:input.purpose,kind:input.kind},state.controls.pins.persistent)
  a.boundPins=binding.state
  if(generation!==state.generation||state.conversationId!==await ports.conversationId()){a.cancelled=true;return a}
  // Whether a live shadow classifier is authorized is supplied by the trusted facts adapter, not merged options.
  const facts=await ports.facts({model:'',...(input.agentId?{agentId:input.agentId}:{})})
  if(!state.controls.current().enabled||generation!==state.generation){a.cancelled=true;return a}
  const allowed=input.matched&&(engine==='v2'?facts.routingAvailable:facts.shadowClassifierOptIn)
  if(allowed){
    const timeout:ClassificationResult={status:'timeout',output:null,elapsedMs:state.config.classifier.deadlineMs}
    a.classification=await Promise.race([ports.classify(text).catch(()=>({status:'invalid' as const,output:null,elapsedMs:null})),ports.sleep(state.config.classifier.deadlineMs).then(()=>timeout)])
  }
  if(generation!==state.generation||state.conversationId!==await ports.conversationId()){a.cancelled=true;return a}
  a.prepared=true
  await ports.save();return a
}
function blocked(d:PolicyDecision,reason:string):PolicyDecision {
  return {...d,outcome:'unavailable',reasons:[...new Set(['configuration_invalid' as const,...d.reasons])],configuration:null,changes:null,qualification:null,blocker:reason,remedy:'Establish verified facts/association before enabling this path.'}
}
function samePair(a:{model:string;effort:EffortToken},b:{model:string|null;effort:EffortToken}):boolean {
  return a.model===b.model&&fingerprint(a.effort)===fingerprint(b.effort)
}
/** Recheck mandatory facts without reclassifying tool results or changing the stored assignment controls/pins. */
export async function evaluateStep(state:HarnessState,a:AssignmentState,request:{model:string;effort?:string|number;agentId?:string;index?:number},ports:HarnessPorts):Promise<PolicyDecision> {
  const facts=await ports.facts(request), now=await ports.now()
  const initial=a.snapshot
  const binding=a.boundPins?.assignments.find(b=>b.id===a.pinBindingId)
  const s:PolicySnapshot=initial?structuredClone(initial):{
    schemaVersion:1,assignment:{id:a.id,parentId:a.input.parentId,lineageId:a.input.lineageId,
      boundary:a.input.purpose==='review'?'review':a.agentId?'subagent':'main',purpose:a.input.purpose,reviewStage:a.input.stage,requestedRole:null,authorFamily:null},
    current:{model:request.model,effort:request.effort??null,modelOrigin:facts.modelOrigin,effortOrigin:facts.effortOrigin},
    controls:{...a.controlSnapshot},
    pins:binding?.pins??[],classification:{status:a.classification.status,output:a.classification.output},
    requirements:structuredClone(facts.requirements),environment:{...facts.environment},resources:structuredClone(facts.resources),fallback:facts.fallback?structuredClone(facts.fallback):null,now:new Date(now).toISOString(),
  }
  const firstChildStep=!!a.agentId&&a.id!==a.pinBindingId&&request.index===0&&!a.dispatched.includes(0)
  if(firstChildStep&&a.stepEffortPermission){
    s.current={model:a.applied?.model??request.model,effort:request.effort??null,modelOrigin:facts.modelOrigin,effortOrigin:facts.effortOrigin}
    s.controls={...s.controls,changeModel:false,changeEffort:true};s.pins=binding?.pins??s.pins
  }else if(a.id.startsWith('spawn:')&&a.stepEffortPermission)s.pins=s.pins.filter(p=>p.field!=='effort')
  s.now=new Date(now).toISOString();s.environment={...facts.environment};s.resources=structuredClone(facts.resources)
  // Trusted requirements may tighten during a loop, never silently loosen the enrolled assignment.
  for(const f of ['tools','imageInput','streaming','continuation','interruptions','mandatory','requireReview','distinctFamily'] as const)s.requirements[f] ||= facts.requirements[f]
  s.requirements.inputTokens=facts.requirements.inputTokens
  if(binding?.unknownOrigins.includes('model'))s.current.modelOrigin='unknown'
  if(binding?.unknownOrigins.includes('effort'))s.current.effortOrigin='unknown'
  if(s.fallback)s.fallback.used=Math.max(s.fallback.used,state.lineageSubstitutions[s.assignment.lineageId]??0)
  if(!facts.routingAvailable){s.current.modelOrigin='unknown';s.current.effortOrigin='unknown'}
  let d=decide(s,state.config.policy,state.config.catalog)
  if(a.cancelled||a.generation!==state.generation||state.conversationId!==await ports.conversationId())d=blocked(d,'assignment cancelled or conversation changed')
  else if(a.applied){
    if(firstChildStep&&a.stepEffortPermission&&a.applied.effort.kind==='unknown'&&d.configuration?.model===a.applied.model&&d.configuration.effort.kind!=='unknown')a.applied.effort=structuredClone(d.configuration.effort)
    const incoming={model:request.model,effort:effortTokenOf(request.effort??null,s.current.effortOrigin)}
    const original={model:s.current.model??'',effort:effortTokenOf(s.current.effort,s.current.effortOrigin)}
    const expected=a.applied.model===incoming.model&&(a.applied.effort.kind==='unknown'||fingerprint(a.applied.effort)===fingerprint(incoming.effort))
    if((!expected&&!samePair(original,incoming))||!d.configuration||!samePair(a.applied,d.configuration))d=blocked(d,'unexpected target or changed eligibility; an explicit authorized retry boundary is required')
  }
  a.snapshot=s;a.decision=d
  const previous=a.record
  a.record=decisionRecord(s,d,{appliedEngine:previous?.appliedEngine??(a.engine==='v2-shadow'?'legacy':null),proposedEngine:a.engine,legacyMode:a.engine==='v2'?null:a.legacyMode,
    pluginVersion:state.config.pluginVersion,sourceRevision:state.config.sourceRevision,sourceFingerprint:state.config.sourceFingerprint??null,
    classifier:{provider:state.config.classifier.provider,model:state.config.classifier.model||null,deadlineMs:state.config.classifier.deadlineMs,status:a.classification.status,elapsedMs:a.classification.elapsedMs,usage:a.classification.usage}})
  if(previous){a.record.consumption=structuredClone(previous.consumption);a.record.observed={...previous.observed}}
  if(previous?.applied)a.record.applied=structuredClone(previous.applied)
  state.records=appendRecord(state.records,a.record)
  await ports.save();return d
}
/** Commit pin consumption/reservation/substitution intent before calling native `next`. Shadow never enters here. */
export async function prepareDispatch(state:HarnessState,a:AssignmentState,index:number,ports:HarnessPorts):Promise<boolean> {
  const d=a.decision
  try {
  if(a.engine!=='v2'||!a.prepared||!d||!['select','preserve'].includes(d.outcome)||!d.configuration||!d.configuration.model)return false
  if(a.cancelled||a.complete||a.dispatched.includes(index)){a.decision=blocked(d,'ended, cancelled or duplicate request event');return false}
  if(a.generation!==state.generation||state.conversationId!==await ports.conversationId())return false
  const limits=d.candidates.find(c=>c.configurationId===d.configuration!.id)?.limits
  if(limits&&(await ports.now())-a.startedAt>=limits.maxWallTimeMs){a.decision=blocked(d,'assignment wall-time allowance exhausted');return false}
  if(!a.applied){
    if(d.fallback.substitution&&(state.lineageSubstitutions[a.input.lineageId]??0)>=1){a.decision=blocked(d,'fallback substitution allowance exhausted');return false}
    if(d.reservation.required&&!a.reservationAcquired){if(!a.snapshot||!await ports.reserve(a.snapshot,d)){a.decision=blocked(d,'atomic reservation unavailable');return false}a.reservationAcquired=true}
    if(!a.originalPins||!a.boundPins||!await ports.commitPins(a.originalPins,a.boundPins)){a.decision=blocked(d,'pin intent changed before dispatch');return false}
    const identity=await ports.conversationId()
    if(a.cancelled||a.complete||a.generation!==state.generation||identity!==state.conversationId){a.decision=blocked(d,'assignment changed during dispatch preparation');return false}
    if(d.fallback.substitution){
      const used=state.lineageSubstitutions[a.input.lineageId]??0
      if(used>=1){a.decision=blocked(d,'fallback substitution allowance exhausted');return false}
      state.lineageSubstitutions[a.input.lineageId]=used+1;a.substitutionDispatched=true
    }
    a.applied={model:d.configuration.model,effort:structuredClone(d.configuration.effort)}
  }
  a.dispatched.push(index)
  try{await ports.save()}catch(error){a.cancelled=true;throw error}
  return true
  } finally {
    if(a.record&&a.decision&&a.record.outcome!==a.decision.outcome){a.record.outcome=a.decision.outcome;a.record.reasons=[...a.decision.reasons];state.records=appendRecord(state.records,a.record);try{await ports.save()}catch(error){a.cancelled=true;throw error}}
  }
}
export function requestChanges(a:AssignmentState):{model:string;effort?:TurnStepInput['effort']}|null {
  if(!a.applied)return null
  const t=a.applied.effort
  if(t.kind==='unknown')return {model:a.applied.model}
  if(t.kind==='level'&&!['low','medium','high','xhigh','max'].includes(t.value))return null
  return {model:a.applied.model,...(t.kind==='budget'?{effort:t.value}:t.kind==='level'?{effort:t.value as TurnStepInput['effort']}: {})}
}
export function observeResponse(state:HarnessState,a:AssignmentState,response:TurnStepResult):void {
  if(a.record){
    const r=recordConsumption(a.record,a.input.purpose==='review'?(a.input.stage==='targeted'?'targeted':'reviewer'):'author',response.usage)
    r.observed={model:response.usage?.model??null,effort:null};a.record=r;state.records=appendRecord(state.records,r)
    if(a.applied&&response.usage?.model&&response.usage.model!==a.applied.model){a.cancelled=true;if(a.decision)a.decision=blocked(a.decision,'observed unexpected substitution; continuation held')}
  }
}

// Native routing owns permitted rewrites; the execution host owns ordinary caps and server tools.
export async function nativeRequestFacts($:EngineInterface,state:HarnessState,request:{model:string;effort?:string|number;agentId?:string}):Promise<RequestFacts> {
  let version:string|null=null,shadowClassifierOptIn=false
  try{version=(await $.session.version()).version}catch{}
  try{
    const user=await $.settings.read({source:'user'}),policy=await $.settings.read({source:'policy'})
    const read=(v:unknown)=>{
      if(!isObject(v))throw Error('settings provenance unavailable')
      if(v.pluginConfigs===undefined)return undefined
      if(!isObject(v.pluginConfigs))throw Error('invalid settings')
      const entries=Object.entries(v.pluginConfigs).filter(([id])=>id.split('@')[0]==='jev-model-router')
      const values=entries.flatMap(([,entry])=>{
        if(!isObject(entry)||!isObject(entry.options))throw Error('invalid router settings')
        return Object.hasOwn(entry.options,'v2ShadowClassifier')?[entry.options.v2ShadowClassifier]:[]
      })
      if(values.length>1||values.length===1&&typeof values[0]!=='boolean')throw Error('ambiguous or invalid shadow consent')
      return values[0] as boolean|undefined
    }
    shadowClassifierOptIn=read(policy)??read(user)??false
  }catch{}
  const native:RequestFacts={routingAvailable:true,modelOrigin:'inherited',effortOrigin:'inherited',
    requirements:{tools:true,imageInput:false,streaming:true,continuation:false,interruptions:false,inputTokens:null,mandatory:false,unresolved:[],requireReview:false,distinctFamily:false},
    environment:{id:null,harnessVersion:version,proxyVersion:null,requestPath:null},resources:{restrictedProviders:[],exhaustedModels:[],hardBudget:null},fallback:null,shadowClassifierOptIn}
  return state.config.adapters?.facts?state.config.adapters.facts(request,native):native
}
export async function nativeClassify($:EngineInterface,state:HarnessState,text:string):Promise<ClassificationResult> {
  const c=state.config.classifier,started=await $.clock.now()
  if(!c.provider)return {status:'invalid',output:null,elapsedMs:0}
  const response=await $.http.fetch(c.url,{method:'POST',headers:requestHeaders(c.provider,c.apiKey,c.model),body:v2RequestBody(c.provider,{prompt:text},c.model)})
  const out=response.ok?normalizeV2Response(response.text):null
  let usage:unknown=null;try{usage=JSON.parse(response.text).usage}catch{}
  return {status:out?'ok':'invalid',output:out,elapsedMs:(await $.clock.now())-started,usage}
}
export function durableRuntime(state:HarnessState):unknown {
  return {schemaVersion:1,conversationId:state.conversationId,activation:state.activation,
    assignments:Object.fromEntries(Object.entries(state.assignments).filter(([,a])=>!a.complete).map(([id,a])=>[id,{...structuredClone(a),
      classification:{...a.classification,usage:normalizeUsage(a.classification.usage)},
      decision:a.decision?{...a.decision,question:null,blocker:null,remedy:null}:null,
      snapshot:a.snapshot?{...a.snapshot,requirements:{...a.snapshot.requirements,unresolved:a.snapshot.requirements.unresolved.map(()=> 'unresolved trusted requirement')}}:null}])),

    records:structuredClone(state.records),currentMain:state.currentMain,provisional:structuredClone(state.provisional),lineageSubstitutions:{...state.lineageSubstitutions}}
}
export async function saveRuntime($:EngineInterface,state:HarnessState):Promise<void> {
  if(!state.conversationId||await activeConversation($,state)!==state.conversationId)throw Error('runtime identity or activation changed')
  await $.store.set(RUNTIME_KEY(state.conversationId),durableRuntime(state))
}
export async function initializeHarness($:EngineInterface,state:HarnessState):Promise<void> {
  const id=await $.session.id()
  if(state.initialized&&state.conversationId===id)return
  if(state.conversationId!==id){invalidateHarness(state);state.assignments={};state.records=[];state.currentMain=null;state.provisional={};state.lineageSubstitutions={}}
  state.conversationId=id
  await $.store.set(ACTIVATION_KEY(id),state.activation)
  const saved=await $.store.get(RUNTIME_KEY(id))
  if(saved!==undefined){
    if(!isObject(saved)||saved.schemaVersion!==1||saved.conversationId!==id||!isObject(saved.assignments)||!Array.isArray(saved.records)||!isObject(saved.provisional)||!isObject(saved.lineageSubstitutions))throw Error('runtime state invalid')
    // Reload never turns an in-flight classification/dispatch into a fresh eligible action.
    for(const [key,value] of Object.entries(saved.assignments))if(isObject(value)&&value.id===key&&['legacy','v2-shadow','v2'].includes(value.engine as string)){
      const a=structuredClone(value) as unknown as AssignmentState;a.cancelled=true;a.generation=state.generation;state.assignments[key]=a
    }else throw Error('stored assignment invalid')
    state.records=(saved.records as DecisionRecord[]).slice(-128)
    state.lineageSubstitutions=structuredClone(saved.lineageSubstitutions) as Record<string,number>
    for(const [key,v] of Object.entries(saved.provisional))if(isObject(v)&&typeof v.assignmentId==='string')state.provisional[key]={assignmentId:v.assignmentId,agentId:typeof v.agentId==='string'?v.agentId:null,uncertain:true}
  }
  try {
    const metadata=JSON.parse(await $.fs.read(`${$.plugin.root}/.claude-plugin/plugin.json`))
    if(typeof metadata.version==='string')state.config.pluginVersion=metadata.version
    const sources=[]
    for(const path of ['.claude-plugin/plugin.json','hooks/jev-model-router.ts','hooks/router-controls.ts','hooks/policy.ts','hooks/task-routing.ts','hooks/model-catalog.ts','hooks/v2/harness.ts','hooks/v2/records.ts','hooks/v2/pins.ts','hooks/v2/policy.ts','hooks/v2/policy-data.ts','hooks/v2/contract.ts','hooks/v2/classifier.ts','hooks/v2/artifacts.ts','hooks/v2/verification.ts','hooks/v2/review.ts','hooks/v2/review-harness.ts','hooks/v2/native-review.ts','catalog/models.json','catalog/model-data.ts'])sources.push([path,await $.fs.read(`${$.plugin.root}/${path}`)])
    state.config.sourceFingerprint=await sha256(new TextEncoder().encode(JSON.stringify(sources)))
    const revision=await $.process.run(['git','rev-parse','HEAD'],{cwd:$.plugin.root,timeoutMs:10000,env:{GIT_NO_LAZY_FETCH:'1',GIT_OPTIONAL_LOCKS:'0'}})
    if(revision.exitCode===0&&/^[a-f0-9]{40,64}$/.test(revision.stdout.trim()))state.config.sourceRevision=revision.stdout.trim()
  }catch{/* Missing metadata is unknown, not inferred from a release name. */}
  state.initialized=true
}
export function nativePorts($:EngineInterface,state:HarnessState,commit:(expected:PinState,next:PinState)=>Promise<boolean>):HarnessPorts {
  return {now:()=>$.clock.now(),conversationId:()=>activeConversation($,state),sleep:ms=>$.clock.sleep(ms),classify:text=>nativeClassify($,state,text),
    facts:request=>nativeRequestFacts($,state,request),pinState:async()=>{
      if(!state.controls.pins.pins||state.controls.pins.authorityError)throw Error('pin/settings authority unavailable')
      return parsePinState(state.controls.pins.pins,state.conversationId!)
    },commitPins:commit,save:()=>saveRuntime($,state),reserve:async()=>false}
}

export function portsFor($:EngineInterface,state:HarnessState,controls:ReturnType<typeof createRouterControls>):HarnessPorts {
  const generation=state.generation
  const ports=nativePorts($,state,async(expected,next)=>serializePinOperation(controls,async()=>{
    const id=await activeConversation($,state)
    if(!id||id!==expected.conversationId||generation!==state.generation)return false
    const raw=await $.store.get(PIN_STORE_KEY(id))
    const current=parsePinState(raw===undefined?await $.store.get(PIN_STORE_KEY(id,1)):raw,id)
    if(canonicalJson(current)!==canonicalJson(expected)||generation!==state.generation||await activeConversation($,state)!==id)return false
    await $.store.set(PIN_STORE_KEY(id),next)
    if(await activeConversation($,state)!==id)throw Error('pin commit activation changed')
    controls.pins.pins=structuredClone(next)
    return true
  }))
  return {...ports,pinState:async()=>{await ensureRouterConversation($,controls);return ports.pinState()}}
}
export async function nativeIntake($:EngineInterface,state:HarnessState,e:PromptSubmitInput):Promise<string|null> {
  if(/^\/router(?:\s|$)/.test(e.text.trim()))return null
  if(state.controls.engineError)return state.controls.engineError
  try{await initializeHarness($,state)}catch{if(state.controls.currentV2().policyEngine==='v2')return 'unavailable: runtime identity or storage is unknown.'}
  intake(state,e)
  return null
}
export async function nativeTurnStart($:EngineInterface,state:HarnessState,controls:ReturnType<typeof createRouterControls>,e:TurnStartInput):Promise<void> {
  const activation=controls.activation
  await initializeHarness($,state)
  if(!controls.state.enabled||activation!==controls.activation)return
  const ports=portsFor($,state,controls)
  if(e.agentId){
    const matches=Object.values(state.provisional).filter(p=>p.agentId===e.agentId&&!p.uncertain)
    if(matches.length===1){
      const prior=state.assignments[matches[0]!.assignmentId]
      if(prior&&!prior.complete){
        delete state.assignments[prior.id]
        const oldId=prior.id;prior.id=e.turnId;prior.agentId=e.agentId;prior.input={...prior.input,id:e.turnId,agentId:e.agentId}
        if(prior.snapshot)prior.snapshot.assignment.id=e.turnId
        if(prior.record){prior.record.assignmentId=e.turnId;state.records=state.records.filter(r=>r.assignmentId!==oldId)}
        state.assignments[e.turnId]=prior;matches[0]!.assignmentId=e.turnId
        await ports.save();return
      }
    }
    await beginAssignment(state,{id:e.turnId,text:e.text,agentId:e.agentId,parentId:null,lineageId:e.turnId,purpose:'execution',stage:null,kind:'delegated',matched:false},ports)
    return
  }
  const pending=state.pending;state.pending=[]
  const unique=pending.length===1&&pending[0]!.text===e.text
  const source=unique?pending[0]!.origin:'unclassified'
  await beginAssignment(state,{id:e.turnId,text:e.text,parentId:null,lineageId:e.turnId,purpose:'execution',stage:null,
    kind:source==='composer'?'user':'delegated',matched:unique&&['composer','sdk','bridge','coordinator'].includes(source)},ports)
  const a=state.assignments[e.turnId]
  if(a&&unique&&pending[0]!.legacyStats)a.legacyStats=structuredClone(pending[0]!.legacyStats)
}
export function captureLegacyClassifier(state:HarnessState,text:string,elapsedMs:number,usage:unknown):void {
  if(state.pending.length===1&&state.pending[0]!.text===text)state.pending[0]!.legacyStats={elapsedMs,usage:normalizeUsage(usage)}
}
export async function nativeStepPlan($:EngineInterface,state:HarnessState,controls:ReturnType<typeof createRouterControls>,e:TurnStepInput):Promise<{owned:boolean;message:string|null;assignment:AssignmentState|null}> {
  const engine=boundEngine(state,e.turnId)
  if(state.controls.engineError)return {owned:true,message:state.controls.engineError,assignment:null}
  if(engine==='legacy')return {owned:false,message:null,assignment:state.assignments[e.turnId]??null}
  try {
    await initializeHarness($,state)
    const a=state.assignments[e.turnId]
    if(!a||a.agentId!==(e.agentId??null)||a.complete)return {owned:engine==='v2',message:'unavailable: classification_unmatched; missing, ended or ambiguous turn association.',assignment:null}
    if(!a.prepared)return {owned:engine==='v2',message:'unavailable: assignment setup incomplete; inspect the router debug log.',assignment:null}
    const ports=portsFor($,state,controls)
    await evaluateStep(state,a,e,ports)
    if(state.config.logDecisions&&e.index===0)$.ui.log(`[router:v2] ${JSON.stringify({boundary:a.snapshot?.assignment.boundary,controls:a.snapshot?.controls,reasons:a.decision?.reasons,classification:{status:a.classification.status,output:a.classification.output,elapsedMs:a.classification.elapsedMs,usage:normalizeUsage(a.classification.usage)}})}`,{to:'debug'})
    if(engine==='v2-shadow')return {owned:false,message:null,assignment:a}
    if(!await prepareDispatch(state,a,e.index,ports))return {owned:true,message:holdMessage(a),assignment:a}
    return {owned:true,message:null,assignment:a}
  }catch {
    return {owned:engine==='v2',message:engine==='v2'?'unavailable: assignment facts, pin transaction or durable dispatch intent failed.':null,assignment:null}
  }
}
export async function* nativeV2Step($:EngineInterface,state:HarnessState,e:TurnStepInput,a:AssignmentState,next:(e:TurnStepInput)=>AsyncGenerator<TurnStepChunk,TurnStepResult>):AsyncGenerator<TurnStepChunk,TurnStepResult> {
  const changes=requestChanges(a)
  const identity=await activeConversation($,state)
  if(!state.controls.current().enabled)return yield* next(e)
  if(!changes||a.cancelled||a.complete||a.generation!==state.generation||identity!==state.conversationId){
    const text='unavailable: effective model/effort or activation is unknown.'
    yield {kind:'text',index:0,text};yield {kind:'stop',stopReason:'end_turn',usage:null}
    return {turnId:e.turnId,index:e.index,answer:text,toolUses:[],stopReason:'end_turn',usage:null}
  }
  if(a.record){a.record.applied=structuredClone(a.applied);a.record.appliedEngine='v2';state.records=appendRecord(state.records,a.record)}
  if(e.index===0&&state.config.logDecisions){$.ui.status(`Router v2 · ${changes.model} · effort ${changes.effort??e.effort??'host default'}`);$.ui.log(`[router] ${a.classification.output?.role.value??'unclassified'} · ${changes.model} · effort ${changes.effort??e.effort??'host default'} · v2${a.decision?.outcome==='preserve'?` · unchanged (${a.decision.reasons.join(', ')})`:''}`)}
  const stream=next({...e,...changes})
  for(;;){
    const part=await stream.next()
    if(part.done){observeResponse(state,a,part.value);await saveRuntime($,state);return part.value}
    if(part.value.kind==='tool')a.allowedToolIds.push(part.value.id)
    yield part.value
  }
}
export async function recordLegacyRequest($:EngineInterface,state:HarnessState,e:TurnStepInput,model:string,effort:string|number|undefined,mode:RouterSettings['mode']):Promise<void> {
  const a=state.assignments[e.turnId]
  if(!a)return
  const applied={model,effort:effortTokenOf(effort??null,'inherited')}
  if(!a.record)a.record=legacyRecord({assignmentId:a.id,parentId:a.input.parentId,lineageId:a.input.lineageId,mode,
    model,effort:applied.effort,previousModel:e.model,previousEffort:effortTokenOf(e.effort??null,'unknown'),controls:{...a.controlSnapshot},pins:{router:state.controls.pins.pins?.pins??null,nativeOrigin:'unknown'},
    pluginVersion:state.config.pluginVersion,sourceRevision:state.config.sourceRevision,sourceFingerprint:state.config.sourceFingerprint??null,catalogFingerprint:fingerprint(state.config.legacyCatalog??state.config.catalog.legacy),
    provider:state.config.classifier.provider,classifierModel:state.config.classifier.model||null,deadlineMs:state.config.classifier.deadlineMs,elapsedMs:a.legacyStats?.elapsedMs??null,usage:a.legacyStats?.usage})
  a.record.applied=applied;a.record.legacyMode=mode;state.records=appendRecord(state.records,a.record)
  // No v2 reservation, pin consumption or acceptance occurs on this path.
  try{await saveRuntime($,state)}catch{/* Telemetry failure never changes legacy/shadow execution. */}
}
export async function nativePrepareSpawn($:EngineInterface,state:HarnessState,controls:ReturnType<typeof createRouterControls>,e:AgentSpawnInput):Promise<{owned:boolean;deny:string|null;model:string|null;assignmentId:string|null}> {
  const candidates=Object.values(state.assignments).filter(a=>!a.complete&&!a.cancelled&&a.agentId===(e.parentAgentId??null))
  const parent=candidates.length===1?candidates[0]!:null
  // A child is a new assignment: capture current controls, not the parent's earlier engine.
  const engine=state.controls.currentV2().policyEngine
  if(state.controls.engineError)return {owned:true,deny:state.controls.engineError,model:null,assignmentId:null}
  if(engine==='legacy')return {owned:false,deny:null,model:null,assignmentId:null}
  if(!e.tool_use_id||!parent)return {owned:engine==='v2',deny:engine==='v2'?'unavailable: provisional spawn association is unknown.':null,model:null,assignmentId:null}
  try{
    await initializeHarness($,state)
    const key=`spawn:${e.tool_use_id}`
    if(state.provisional[e.tool_use_id])return {owned:engine==='v2',deny:engine==='v2'?'unavailable: duplicate or uncertain spawn; no retry authorized.':null,model:null,assignmentId:key}
    const ports=portsFor($,state,controls)
    const a=await beginAssignment(state,{id:key,text:e.prompt,agentId:key,parentId:parent.id,lineageId:parent.input.lineageId,purpose:'execution',stage:null,kind:'delegated',matched:true},ports)
    a.engine=engine
    a.controlSnapshot.changeModel=state.controls.current().subagents&&!e.fork
    // Spawn has no effort field; do not claim an unenforceable effort mutation.
    a.controlSnapshot.changeEffort=false
    state.provisional[e.tool_use_id]={assignmentId:key,agentId:null,uncertain:true}
    await evaluateStep(state,a,{model:e.model??e.parentModel,agentId:key},ports)
    if(engine==='v2-shadow'){await ports.save();return {owned:false,deny:null,model:null,assignmentId:key}}
    if(!await prepareDispatch(state,a,-1,ports))return {owned:true,deny:holdMessage(a),model:null,assignmentId:key}
    return {owned:true,deny:null,model:a.applied!.model,assignmentId:key}
  }catch{return {owned:engine==='v2',deny:engine==='v2'?'unavailable: qualified provisional model/effort cannot be enforced.':null,model:null,assignmentId:null}}
}
export async function nativeSpawnStarted($:EngineInterface,state:HarnessState,e:AgentSpawnInput,result:AgentSpawnResult):Promise<void> {
  const p=state.provisional[e.tool_use_id]
  if(!p)return
  if(result.deny!==undefined||!result.agentId){p.uncertain=true;await saveRuntime($,state);return}
  p.agentId=result.agentId;p.uncertain=false
  await saveRuntime($,state)
}
export async function nativeTurnComplete($:EngineInterface,state:HarnessState,controls:ReturnType<typeof createRouterControls>,e:TurnCompleteInput):Promise<void> {
  const a=state.assignments[e.turnId]
  if(!a||a.agentId!==(e.agentId??null))return
  a.complete=true;a.cancelled ||= e.isAborted||e.reason!=='answer'
  if(a.record&&e.usage){
    const stage=a.input.purpose==='review'?(a.input.stage==='targeted'?'targeted':'reviewer'):'author'
    a.record.consumption=a.record.consumption.filter(item=>item.stage!==stage)
    a.record=recordConsumption(a.record,stage,e.usage);a.record.observed.model=e.usage.model;state.records=appendRecord(state.records,a.record)
  }
  if(a.engine==='v2'&&state.conversationId){
    const id=state.conversationId,generation=state.generation
    await serializePinOperation(controls,async()=>{
      if(generation!==state.generation||await activeConversation($,state)!==id)throw Error('completion identity changed')
      const raw=await $.store.get(PIN_STORE_KEY(id))
      const current=parsePinState(raw,id),updated=releaseAssignmentPins(current,a.pinBindingId)
      if(generation!==state.generation||await activeConversation($,state)!==id)throw Error('completion identity changed')
      await $.store.set(PIN_STORE_KEY(id),updated)
      if(generation!==state.generation||await activeConversation($,state)!==id)throw Error('completion identity changed')
      controls.pins.pins=updated
    })
  }
  const ended=Object.values(state.assignments).filter(a=>a.complete)
  for(const old of ended.slice(0,Math.max(0,ended.length-128)))delete state.assignments[old.id]
  await saveRuntime($,state)
}
export async function nativeToolGuard($:EngineInterface,state:HarnessState,e:{tool_use_id:string;agentId?:string},origin:string|undefined):Promise<string|null> {
  // Governed plugin checks have separate authorization; do not charge the author's tool allowance.
  if(origin&&origin!=='engine')return null
  const candidates=Object.values(state.assignments).filter(a=>!a.complete&&a.agentId===(e.agentId??null))
  const a=candidates.length===1?candidates[0]!:null
  if(!a)return state.controls.currentV2().policyEngine==='v2'?'unavailable: tool assignment association is unknown.':null
  if(a.engine!=='v2')return null
  if(a.cancelled||!a.allowedToolIds.includes(e.tool_use_id))return 'unavailable: model tool association is unverified.'
  const limits=a.decision?.candidates.find(c=>c.configurationId===a.decision?.configuration?.id)?.limits
  const now=await $.clock.now()
  if(limits&&(a.toolCalls>=limits.maxToolCalls||now-a.startedAt>=limits.maxWallTimeMs))return 'unavailable: assignment tool/time allowance exhausted.'
  a.toolCalls++;await saveRuntime($,state);return null
}

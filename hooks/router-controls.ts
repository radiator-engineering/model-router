import type {EngineInterface, Register} from 'claude-code'
import {isId, isObject} from './v2/contract.ts'
import type {Pin} from './v2/contract.ts'
import {changePin, parsePinState, resolvePinFields} from './v2/pins.ts'
import type {PinField} from './v2/pins.ts'
import type {RouterStoredPins as PinState} from '../types/router-state'
import type {HarnessState} from './v2/harness.ts'
import {initializeHarness,invalidateHarness,saveRuntime} from './v2/harness.ts'
import {workflowCommand,workflowCheckpoint} from './v2/review-harness.ts'
import {DEFAULT_REVIEW_POLICY_JSON,validateReviewPolicyJson} from './v2/native-review.ts'
import {V2_MODEL_DEFAULTS} from './v2/policy-data.ts'

export interface RouterSettings {
  enabled: boolean
  mode: 'basic' | 'custom' | 'observe'
  mainModel: boolean
  mainEffort: boolean
  subagents: boolean
  classifyTurns: boolean
}
export interface V2Settings {
  policyEngine: 'legacy' | 'v2-shadow' | 'v2'
  routeSubagentEffort: boolean
  reviewMode: 'off' | 'recommend' | 'automatic'
}
export interface RouterPinStatus {
  conversationId: string | null
  pins: PinState | null
  pinError: string | null
  persistent: Pin[]
  authorityError: string | null
  checksSource: 'user' | 'policy' | null
  checksJson: string
  reviewPolicyJson?:string
}
const V2_DEFAULTS: V2Settings = {policyEngine: 'legacy', routeSubagentEffort: false, reviewMode: 'recommend'}
const EMPTY_CHECKS = '{"schemaVersion":1,"checks":[]}'
export const PIN_STORE_KEY = (id: string, version = 2) => `model-router.pins.v${version}/${encodeURIComponent(id)}`
const LEVELS = ['low', 'medium', 'high', 'xhigh', 'max']
const ENGINES = ['legacy', 'v2-shadow', 'v2']
const REVIEW_MODES = ['off', 'recommend', 'automatic']
const V2_FIELDS = ['policyEngine', 'routeSubagentEffort', 'reviewMode', 'persistentModelPin', 'persistentEffortPin', 'verificationChecksJson', 'v2ShadowClassifier', 'reviewPolicyJson'] as const
export const ROUTER_TOGGLES = [
  {key:'enabled',label:'Enable model router',description:'Master switch for all routing, classification, logging and candidate workflows. Turn off to use the host directly; routing preferences are retained.'},
  {key:'mainModel',label:'Main model routing',description:'Allow the router to change the model in the main conversation.'},
  {key:'mainEffort',label:'Main effort routing',description:'Allow the router to adjust the main conversation’s reasoning effort.'},
  {key:'subagents',label:'Subagent routing',description:'Choose models for delegated tasks using task type and your preferences.'},
  {key:'classifyTurns',label:'Per-turn logging',description:'Classify each prompt and show recommendations even when main routing is fixed.'},
] as const
export function normalizeRouterMode(value:unknown):RouterSettings['mode'] {
  if(value==='apply'||value==='custom')return 'custom'
  if(value==='off'||value==='basic')return 'basic'
  return 'observe'
}
const STORE_KEY = 'model-router.defaults.v1'
export function validSettings(input: unknown): input is RouterSettings {
  if (!isObject(input)) return false
  return (input.enabled===undefined||typeof input.enabled==='boolean') && ['basic','custom','observe','off','apply'].includes(input.mode as string) && ['mainModel','mainEffort','subagents','classifyTurns'].every(k=>typeof input[k]==='boolean')
}
export function routerStatus(s:RouterSettings):string {
  const yes=(v:boolean)=>v?'on':'off'
  return `Model router: ${yes(s.enabled)}${s.enabled?'':' (stopped; preferences below are inactive)'}\nClassifier: Jev\nMode: ${s.mode}\nMain model routing: ${yes(s.mainModel)}\nMain effort routing: ${yes(s.mainEffort)}\nSubagent routing: ${yes(s.subagents)}\nPer-turn classification/logging: ${yes(s.classifyTurns)}`
}
export const ROUTER_HELP = '/router opens the menu. Commands: on; off (stop all router activity); status; mode [basic|custom|observe]; main-model on|off; main-effort on|off; subagents on|off; classify-turns on|off; save; reset; engine legacy|v2-shadow|v2; review-mode off|recommend|automatic; subagent-effort on|off; pin model <exact-id> | pin effort <level> [--scope next|session|persistent]; unpin model|effort [--scope next|session|persistent]; candidate register <manifest-path>; review [candidate-id]; repair <candidate-id>; verify <candidate-id> [--confirm-scope]; candidate status <candidate-id>; accept <candidate-id>. Legacy changes apply immediately; save/reset manage legacy defaults. V2 routes permitted model/effort fields; context and ordinary execution limits belong to the host; shadow keeps legacy execution active. Candidate review/acceptance require current evidence and separate authorization. Persistent pins use native /config defaults; execution pins never choose a reviewer.'
const KEYS = {'main-model':'mainModel','main-effort':'mainEffort',subagents:'subagents','classify-turns':'classifyTurns'} as const
export type RouterAction = {kind:'status'|'menu'|'mode-menu'|'save'|'reset'|'help'|'error'} |
  {kind:'change'; patch:Partial<RouterSettings>} | {kind:'v2-change'; field:keyof V2Settings; value:string|boolean} |
  {kind:'pin'; field:PinField; value:string|null; scope:'next'|'session'|'persistent'} |
  {kind:'candidate'; manifest:string} | {kind:'review'; candidateId:string|null} | {kind:'accept'; candidateId:string} | {kind:'repair';candidateId:string} | {kind:'verify';candidateId:string;confirmScope:boolean} | {kind:'candidate-status';candidateId:string}
export function parseRouterCommand(args:string): RouterAction {
  const tokens=args.trim().split(/\s+/).filter(Boolean)
  const [name, arg, val] = tokens
  if (!name) return {kind:'menu'}
  if(tokens.length===1&&(name==='on'||name==='off'))return {kind:'change',patch:{enabled:name==='on'}}
  if(tokens.length===1&&name==='mode')return {kind:'mode-menu'}
  if (tokens.length===1 && ['status','save','reset','help'].includes(name)) return {kind:name as 'status'|'save'|'reset'|'help'}
  if(name==='pin'||name==='unpin') {
    if(arg!=='model'&&arg!=='effort')return {kind:'error'}
    const index=name==='pin'?3:2
    if(name==='pin'&&(!isId(val)||val.startsWith('--')||(arg==='effort'&&!LEVELS.includes(val))))return {kind:'error'}
    if(tokens.length!==index&&!(tokens.length===index+2&&tokens[index]==='--scope'&&['next','session','persistent'].includes(tokens[index+1]!)))return {kind:'error'}
    return {kind:'pin',field:arg,value:name==='pin'?val!:null,scope:(tokens[index+1]??'session') as 'next'|'session'|'persistent'}
  }
  if(name==='candidate'&&arg==='register'&&tokens.length>=3) return {kind:'candidate',manifest:args.trim().replace(/^candidate\s+register\s+/, '')}
  if(name==='review'&&tokens.length<=2)return {kind:'review',candidateId:arg??null}
  if(name==='candidate'&&arg==='status'&&tokens.length===3)return {kind:'candidate-status',candidateId:val!}
  if(name==='repair'&&tokens.length===2)return {kind:'repair',candidateId:arg!}
  if(name==='verify'&&(tokens.length===2||tokens.length===3&&val==='--confirm-scope'))return {kind:'verify',candidateId:arg!,confirmScope:val==='--confirm-scope'}
  if(name==='accept'&&tokens.length===2)return {kind:'accept',candidateId:arg!}
  if (tokens.length!==2||arg===undefined) return {kind:'error'}
  if (name==='mode' && ['basic','custom','observe','off','apply'].includes(arg)) return {kind:'change',patch:{mode:normalizeRouterMode(arg)}}
  const key=Object.hasOwn(KEYS,name)?KEYS[name as keyof typeof KEYS]:undefined
  if(key && ['on','off'].includes(arg)) return {kind:'change',patch:{[key]:arg==='on'}}
  if(name==='engine'&&ENGINES.includes(arg))return {kind:'v2-change',field:'policyEngine',value:arg}
  if(name==='review-mode'&&REVIEW_MODES.includes(arg))return {kind:'v2-change',field:'reviewMode',value:arg}
  if(name==='subagent-effort'&&['on','off'].includes(arg))return {kind:'v2-change',field:'routeSubagentEffort',value:arg==='on'}
  return {kind:'error'}
}

/** Validate definitions as data only. Filesystem resolution/execution belong to phase 6. */
export function validateChecksJson(text: unknown): boolean {
  if (typeof text !== 'string') return false
  let v: unknown
  try {v=JSON.parse(text)} catch {return false}
  if (!isObject(v)||v.schemaVersion!==1||!Array.isArray(v.checks)||Object.keys(v).some(k=>!['schemaVersion','checks'].includes(k)))return false
  const ids=new Set<string>()
  return v.checks.every(c=>{
    if(!isObject(c)||!isId(c.id)||ids.has(c.id)||typeof c.command!=='string'||!c.command.trim()||typeof c.cwd!=='string'||!c.cwd||
      /[\x00\r\n]/.test(c.cwd)||/^(?:[/\\]|[A-Za-z]:)/.test(c.cwd)||c.cwd.split(/[/\\]/).includes('..')||
      !Number.isSafeInteger(c.timeoutMs)||Number(c.timeoutMs)<1||Number(c.timeoutMs)>600000||
      Object.keys(c).some(k=>!['id','command','cwd','timeoutMs'].includes(k)))return false
    ids.add(c.id);return true
  })
}
const validV2 = (key: string, v: unknown) => key==='policyEngine'?ENGINES.includes(v as string):key==='reviewMode'?REVIEW_MODES.includes(v as string):
  key==='routeSubagentEffort'||key==='v2ShadowClassifier'?typeof v==='boolean':key==='persistentModelPin'?v===''||isId(v):
  key==='persistentEffortPin'?v===''||LEVELS.includes(v as string):key==='reviewPolicyJson'?validateReviewPolicyJson(v):key==='verificationChecksJson'&&validateChecksJson(v)

/** Only the host's requested source is eligible; merged project/local/flag values cannot mint pins/checks. */
function trustedOptions(settings: unknown, keys:readonly string[]=V2_FIELDS): Record<string, unknown> {
  if(!isObject(settings))throw Error('settings provenance unavailable')
  if(settings.pluginConfigs===undefined)return {}
  if(!isObject(settings.pluginConfigs))throw Error('invalid plugin settings')
  const found:Record<string,unknown>={}
  for(const [id,entry] of Object.entries(settings.pluginConfigs)) {
    if(id.split('@')[0]!=='jev-model-router')continue
    if(!isObject(entry)||!isObject(entry.options))throw Error('invalid router settings')
    for(const key of keys)if(Object.hasOwn(entry.options,key)){
      if(Object.hasOwn(found,key)&&found[key]!==entry.options[key])throw Error('ambiguous router settings')
      found[key]=entry.options[key]
    }
  }
  return found
}

export function createRouterControls(initial:RouterSettings, options:Readonly<Record<string,unknown>>={}) {
  const v2:V2Settings={...V2_DEFAULTS}
  for(const key of ['policyEngine','routeSubagentEffort','reviewMode'] as const)if(validV2(key,options[key]))Object.assign(v2,{[key]:options[key]})
  const controls={
    initial:{...initial},state:{...initial},current:()=>({...controls.state}),v2,generation:0,pinQueue:Promise.resolve() as Promise<unknown>,runtime:undefined as HarnessState|undefined,
    engineError: options.policyEngine!==undefined&&!validV2('policyEngine',options.policyEngine)?'Invalid policy engine; request held.':null as string|null,
    activation:0,
    update:(patch:Partial<RouterSettings>)=>{
      const changed=patch.enabled!==undefined&&patch.enabled!==controls.state.enabled
      controls.state={...controls.state,...patch}
      if(changed){controls.activation++;controls.lastApplied=null;if(controls.runtime)invalidateHarness(controls.runtime)}
    },
    currentV2:()=>({...controls.v2}),
    pins:{conversationId:null,pins:null,pinError:null,persistent:[],authorityError:'Trusted settings have not been read.',checksSource:null,checksJson:EMPTY_CHECKS} as RouterPinStatus,
    lastApplied:null as {engine:'legacy';assignmentId:string;model:string;effort:string|number|null}|null,
  }
  return controls
}
export function unavailableEngine(controls:ReturnType<typeof createRouterControls>):string|null {
  return controls.engineError ?? (controls.v2.policyEngine==='legacy'||controls.runtime?null:`unavailable: ${controls.v2.policyEngine} application/shadow adapter is not implemented; choose legacy.`)
}
function detailedStatus(controls:ReturnType<typeof createRouterControls>):string {
  const s=controls.pins, resolved=resolvePinFields([...s.persistent,...(s.pins?.pins??[]).filter(p=>p.purpose==='execution'&&p.origin!=='unknown'&&p.scope==='session').map(p=>({...p,purpose:'execution' as const,scope:'session' as const}))], 'execution')
  const describe=(f:PinField)=>{const p=resolved.fields[f];return p?`${p.value} (${p.scope}, ${p.source}, execution)`: 'unset'}
  const next=(s.pins?.pins??[]).filter(p=>p.scope==='next').map(p=>`${p.field}=${p.value} (${p.purpose??'purpose unknown'}, ${p.origin})`).join('; ')||'none'
  const request=controls.lastApplied
  const v2=controls.v2.policyEngine==='v2'&&controls.runtime?.conversationId===s.conversationId?controls.runtime?.records.findLast(r=>r.appliedEngine==='v2'&&r.applied!==null):undefined
  const applied=v2?.applied
  const requestText=v2&&applied?`v2 ${applied.model}/${applied.effort.kind==='level'||applied.effort.kind==='budget'?applied.effort.value:'host default'} for ${v2.assignmentId}; serving identity ${v2.observed.model??'unknown'}`:request?`${request.engine} ${request.model}/${request.effort??'default'} for ${request.assignmentId}; serving identity unknown`:'unknown'
  return routerStatus(controls.state)+`\nPolicy engine: ${controls.v2.policyEngine}${!controls.state.enabled?' — inactive':unavailableEngine(controls)?' — unavailable':controls.v2.policyEngine==='v2-shadow'?' — legacy execution; shadow proposals only':controls.v2.policyEngine==='v2'?' — model/effort routing; execution limits managed by host':' (legacy active)'}\nReview mode: ${controls.v2.reviewMode} (checkpoint, scope and finite authorization required)\nSubagent effort routing: ${controls.v2.routeSubagentEffort?'on':'off'} (not applied by legacy)\nConversation: ${s.conversationId??'unknown'}\nExecution pins (staged, not applied by legacy): model ${describe('model')}; effort ${describe('effort')}\nNext execution assignment: ${next}\nUnverified stored intent: ${(s.pins?.pins??[]).filter(p=>p.origin==='unknown').map(p=>`${p.field}=${p.value} (${p.scope}, origin unknown)`).join('; ')||'none'}\nNative pin origin: unknown/unmapped; no reviewer pin is inferred\nFixed fields (routing switches only; native origin constraints unverified): main model ${controls.state.mainModel?'mutable':'fixed'}, main effort ${controls.state.mainEffort?'mutable':'fixed'}, subagent model ${controls.state.subagents?'mutable':'fixed'}, subagent effort ${controls.v2.routeSubagentEffort?'mutable':'fixed'}\nTrusted checks: ${s.authorityError?'unavailable':s.checksSource??'none configured'} (not executed)\nLast router-applied request: ${requestText}${s.pinError?'\nPin state unavailable: '+s.pinError:''}${s.authorityError?'\nSettings authority unavailable: '+s.authorityError:''}${resolved.conflict?'\nclarify: conflicting '+resolved.conflict.field+' pins':''}`
}

// Host calls stay in top-level typed adapters so the Mods loader can inspect them.
async function identity($:EngineInterface) {
  const id=await $.session.id();if(!isId(id))throw Error('conversation identity unavailable');return id
}
async function checkIdentity($:EngineInterface,controls:ReturnType<typeof createRouterControls>,id:string,g:number) {
  if(g!==controls.generation||await identity($)!==id)throw Error('conversation changed; control was not applied to the new identity')
}
async function authority($:EngineInterface,controls:ReturnType<typeof createRouterControls>) {
    try {
      const user=trustedOptions(await $.settings.read({source:'user'})),policy=trustedOptions(await $.settings.read({source:'policy'}))
      const values={...user,...policy}
      for(const key of ['persistentModelPin','persistentEffortPin','verificationChecksJson','reviewPolicyJson'])if(Object.hasOwn(values,key)&&!validV2(key,values[key]))throw Error('invalid trusted pin/check settings')
      controls.pins.persistent=[]
      for(const [key,field] of [['persistentModelPin','model'],['persistentEffortPin','effort']] as const)if(values[key])controls.pins.persistent.push({field,value:values[key] as string,scope:'persistent',purpose:'execution',source:Object.hasOwn(policy,key)?'managed-policy':'user-settings',experimental:false})
      controls.pins.checksSource=Object.hasOwn(policy,'verificationChecksJson')?'policy':Object.hasOwn(user,'verificationChecksJson')?'user':null
      controls.pins.checksJson=values.verificationChecksJson as string??EMPTY_CHECKS
      controls.pins.reviewPolicyJson=values.reviewPolicyJson as string??DEFAULT_REVIEW_POLICY_JSON
      controls.pins.authorityError=null
    } catch {
      controls.pins.persistent=[];controls.pins.checksSource=null;controls.pins.checksJson=EMPTY_CHECKS
      controls.pins.authorityError='Pin/check definitions require valid, observable user or managed-policy settings.'
    }
  }
async function load($:EngineInterface,controls:ReturnType<typeof createRouterControls>,id:string,g:number) {
    let pins:PinState|null=null, pinError:string|null=null
    try {
      const raw=await $.store.get(PIN_STORE_KEY(id))
      pins=parsePinState(raw===undefined?await $.store.get(PIN_STORE_KEY(id,1)):raw,id)
    }catch{pinError='Configuration invalid or store read failed; existing intent was not overwritten.'}
    await checkIdentity($,controls,id,g)
    if(controls.pins.conversationId!==id)controls.lastApplied=null
    controls.pins={...controls.pins,conversationId:id,pins,pinError}
    await authority($,controls)
    await checkIdentity($,controls,id,g)
  }
/** /clear and resume change identity without session.start; restore only that conversation's intent. */
export async function ensureRouterConversation($:EngineInterface,controls:ReturnType<typeof createRouterControls>) {
  const g=controls.generation,id=await identity($)
  if(controls.pins.conversationId!==id)await serializePinOperation(controls,()=>load($,controls,id,g))
}
async function nativeRows($:EngineInterface) {
  const rows=await $.config.list()
  return rows.filter(r=>r.provider?.plugin?.split('@')[0]==='jev-model-router')
}
export function serializePinOperation<T>(controls:{pinQueue:Promise<unknown>},fn:()=>Promise<T>):Promise<T> {
  const work=controls.pinQueue.then(fn,fn)
  controls.pinQueue=work.then(()=>undefined,()=>undefined)
  return work
}
export function registerRouterControls(on:Parameters<Register>[0],controls:ReturnType<typeof createRouterControls>) {
  const menuState={plugin:'jev-model-router',key:'routerMenuOpen'} as const
  const ordered=<T>(fn:()=>Promise<T>):Promise<T>=>serializePinOperation(controls,fn)
  on('session.start',async($,e,next)=>{
    try {
      const saved=await $.store.get(STORE_KEY)
      if(validSettings(saved)) controls.update({enabled:saved.enabled??controls.initial.enabled,mode:normalizeRouterMode(saved.mode),mainModel:saved.mainModel,mainEffort:saved.mainEffort,subagents:saved.subagents,classifyTurns:saved.classifyTurns})
    } catch { $.ui.log('[router] Could not read saved defaults; using plugin options.') }
    try {
      for(const row of await nativeRows($)) {
        const field=routerField(row.key,row.provider?.plugin)
        if(field&&controls.state.enabled&&controls.runtime?.config.logDecisions)$.ui.log(`[router:control] ${field}=${String(row.value)} (initial=${String(controls.initial[field])})`,{to:'debug'})
        if(field==='mode'&&['basic','custom','observe','off','apply'].includes(row.value as string))controls.state.mode=normalizeRouterMode(row.value)
        else if(field&&field!=='mode'&&typeof row.value==='boolean')controls.update({[field]:row.value})
        const key=v2Field(row.key,row.provider?.plugin)
        if(key&&['policyEngine','routeSubagentEffort','reviewMode'].includes(key)&&validV2(key,row.value)){
          Object.assign(controls.v2,{[key]:row.value});if(key==='policyEngine')controls.engineError=null
        }
      }
    } catch { $.ui.log('[router] Could not read native config; using startup defaults.') }
    // Headless hosts may expose no plugin menu rows. Explicit launch values still outrank the old save cache.
    try {
      const flag=trustedOptions((await $.settings.read({source:'flag'}))??{},Object.keys(CONFIG_FIELDS)),policy=trustedOptions(await $.settings.read({source:'policy'}),Object.keys(CONFIG_FIELDS))
      for(const [key,field] of Object.entries(CONFIG_FIELDS)){
        const value=Object.hasOwn(policy,key)?policy[key]:flag[key]
        if(field==='mode'&&['basic','custom','observe','off','apply'].includes(value as string))controls.state.mode=normalizeRouterMode(value)
        else if(field!=='mode'&&typeof value==='boolean')controls.update({[field]:value})
      }
    }catch{/* Do not infer launch authority when the source or managed precedence is unavailable. */}
    if(controls.state.enabled)try {const g=controls.generation,id=await identity($);await ordered(()=>load($,controls,id,g))}catch{controls.pins.pinError='Conversation identity or pin state unavailable.'}
    if(controls.state.enabled&&controls.runtime?.config.logDecisions)$.ui.log(`[router:controls] initial=${JSON.stringify(controls.initial)} effective=${JSON.stringify(controls.state)}`,{to:'debug'})
    await $.command.register({name:'router',description:'Model routing menu, v2 controls and purpose-aware pins',argumentHint:'[on | off | status | pin | unpin | engine | review-mode | subagent-effort | candidate | review | accept | save | reset]'})
    const result=await next(e)
    if(controls.state.enabled&&controls.runtime)try{await initializeHarness($,controls.runtime)}catch{$.ui.log('[router] Runtime metadata unavailable; enforced v2 remains held.',{to:'debug'})}
    if(controls.runtime)try{await $.tool.register({name:'candidate_checkpoint',description:'Request an explicit checkpoint for an already user-enrolled candidate. Runs only with automatic mode AND separate trusted per-candidate/stage authorization; never enrolls scope or grants itself permission.',inputSchema:{type:'object',additionalProperties:false,properties:{candidateId:{type:'string'},stage:{enum:['full','repair','targeted']}},required:['candidateId','stage']}})}catch{$.ui.log('[router] Workflow checkpoint tool unavailable on this surface; model/effort routing remains active.',{to:'debug'})}
    return result
  })
  on('session.end',async($,e,next)=>{
    if(controls.runtime){invalidateHarness(controls.runtime);controls.runtime.initialized=false;if(controls.state.enabled)try{await saveRuntime($,controls.runtime)}catch{}}
    controls.generation++
    controls.pins={conversationId:null,pins:null,pinError:null,persistent:[],authorityError:'Settings not read for the new conversation.',checksSource:null,checksJson:EMPTY_CHECKS}
    controls.lastApplied=null
    return next(e)
  })
  on('command.run',async($,e,next)=>{
    if(e.command!=='router') {
      if(e.origin?.kind!=='plugin') {await $.state.set(menuState,false);$.ui.invalidate('config.describe')}
      return next(e)
    }
    const action=parseRouterCommand(e.args)
    if(action.kind==='help'||action.kind==='error')return {text:ROUTER_HELP}
    if(action.kind==='status') {
      try{const g=controls.generation,id=await identity($);await ordered(()=>load($,controls,id,g))}catch{controls.pins.pinError='Conversation identity or pin state unavailable.'}
      return {text:detailedStatus(controls)}
    }
    if(e.origin?.kind!=='composer')return {text:'unavailable: run /router yourself in the composer to change settings, pins or candidates.'}
    if(action.kind==='candidate'||action.kind==='review'||action.kind==='accept'||action.kind==='repair'||action.kind==='verify'||action.kind==='candidate-status') {
      if(!controls.state.enabled)return {text:'Model router is stopped. Use /router on before running candidate workflows.'}
      if(!controls.runtime)return {text:'unavailable: candidate enrollment, review and acceptance require the phase-6 coordinator; no file, check, reviewer or acceptance action was started.'}
      try {
        const g=controls.generation,id=await identity($)
        await ordered(()=>load($,controls,id,g))
        return {text:await workflowCommand($,controls.runtime,action)}
      } catch {return {text:'unavailable: candidate authority, persistence or current evidence could not be established; no acceptance is inferred.'}}
    }
    try {
      if(action.kind==='pin') {
        const g=controls.generation,id=await identity($)
        return await ordered(async()=>{
          await load($,controls,id,g)
          if(action.scope==='persistent') {
            if(controls.pins.authorityError)return {text:'unavailable: '+controls.pins.authorityError}
            const key=action.field==='model'?'persistentModelPin':'persistentEffortPin'
            const rows=(await nativeRows($)).filter(r=>v2Field(r.key,r.provider.plugin)===key)
            if(rows.length!==1||rows[0]!.isLocked)return {text:'unavailable: persistent pin setting is missing, ambiguous or managed/locked.'}
            await checkIdentity($,controls,id,g)
            const result=await $.config.set({key:rows[0]!.key,value:action.value??''})
            if(result.deny!==undefined)return {text:'unavailable: native configuration denied the persistent pin update.'}
            await checkIdentity($,controls,id,g)
            await authority($,controls)
            const effective=controls.pins.persistent.find(p=>p.field===action.field)?.value??null
            if(controls.pins.authorityError||result.value!==(action.value??'')||effective!==action.value)
              return {text:'unavailable: native setting was written, but the requested persistent intent is not verified as effective. Inspect /config; no pin was applied to a model request.\n'+detailedStatus(controls)}
            return {text:detailedStatus(controls)+'\nPersistent setting saved through native config; intent only, not applied by legacy.'}
          }
          if(!controls.pins.pins)return {text:'unavailable: '+controls.pins.pinError}
          const updated=changePin(controls.pins.pins,{field:action.field,value:action.value,scope:action.scope})
          if(action.value!==null&&updated.pins.length)updated.pins[updated.pins.length-1]!.source=`router-command:${crypto.randomUUID()}`
          await checkIdentity($,controls,id,g)
          await $.store.set(PIN_STORE_KEY(id),updated)
          await checkIdentity($,controls,id,g)
          controls.pins.pins=updated
          return {text:detailedStatus(controls)+'\nExecution intent saved for this conversation. Next intent is consumed only by a qualified v2 assignment adapter, not by legacy turns or this command.'}
        })
      }
      if(action.kind==='v2-change') {
        if(action.field==='policyEngine'&&action.value!=='legacy'&&!controls.runtime)return {text:'unavailable: v2 application/shadow requires phase 5; the selected engine was not changed.'}
        const g=controls.generation,id=await identity($)
        const rows=(await nativeRows($)).filter(r=>v2Field(r.key,r.provider.plugin)===action.field)
        if(rows.length!==1||rows[0]!.isLocked)return {text:'unavailable: this control is missing, ambiguous or managed/locked.'}
        await checkIdentity($,controls,id,g)
        Object.assign(controls.v2,{[action.field]:action.value});if(action.field==='policyEngine')controls.engineError=null
        return {text:detailedStatus(controls)+'\nV2 session control staged for future assignment boundaries; /config manages saved defaults. No automatic review is authorized by this change.'}
      }
      if(action.kind==='change'){controls.update(action.patch);return {text:routerStatus(controls.state)+(action.patch.enabled===undefined?'\nSession updated. Use /router save to persist.':'\nSession updated. Use Enable model router in /router to save the default.')}}
      if(action.kind==='save'){await $.store.set(STORE_KEY,controls.state);return {text:routerStatus(controls.state)+'\nSaved defaults cache; native /config and explicit launch/managed values take precedence. V2 saved defaults are managed in /config.'}}
      if(action.kind==='reset'){await $.store.delete(STORE_KEY);controls.update(controls.initial);return {text:routerStatus(controls.state)+'\nRestored legacy plugin options and removed saved defaults. Pins are unchanged; use unpin at their scope.'}}
      await $.state.set(menuState,true)
      $.clock.after(0,()=>{
        $.ui.invalidate('config.describe')
        void $.command.run({command:'config',args:''}).catch(error=>{$.ui.log('[router] Could not open native config: '+String(error))}).finally(()=>{void $.state.set(menuState,false);$.ui.invalidate('config.describe')})
      })
      return {}
    }catch {
      return {text:'unavailable: router control or persistence did not complete. Inspect /router status and /config before retrying. No v2 model/check/review was dispatched.'}
    }
  }).catch(($,e,next)=>next.called?next(e):{text:'unavailable: router control outcome is unknown; inspect status/config. No workflow was started by this error handler.'})
  on('tool.call',{tool:'mcp__jev-model-router__candidate_checkpoint'},async($,e)=>{
    if(!controls.state.enabled)return {deny:'Model router is stopped. Use /router on before running candidate workflows.'}
    if(!controls.runtime)return {deny:'Workflow coordinator unavailable.'}
    const args=e as unknown as {candidateId:unknown;stage:unknown}
    if(!isId(args.candidateId)||!['full','repair','targeted'].includes(args.stage as string))return {deny:'Invalid candidate checkpoint.'}
    try{const result=await workflowCheckpoint($,controls.runtime,{candidateId:args.candidateId,stage:args.stage as 'full'|'repair'|'targeted',source:'workflow-checkpoint',authorizationRef:`workflow:${crypto.randomUUID()}`});return {result:JSON.stringify(result)}}catch{return {deny:'Scoped workflow checkpoint unavailable.'}}
  }).catch(()=>({deny:'Workflow checkpoint failed; no acceptance inferred.'}))
  on('config.describe',async($,e,next)=>{
    const field=routerField(e.key,e.provider?.plugin), v2=v2Field(e.key,e.provider?.plugin)
    const {value:routerOnly}=await $.state.get(menuState)
    const simpleAnswer=e.key.split('.').at(-1)==='simpleAnswerModel'&&e.provider?.plugin?.split('@')[0]==='jev-model-router'
    const rolePreference=e.provider?.plugin?.split('@')[0]==='jev-model-router'&&Object.hasOwn(V2_MODEL_DEFAULTS,e.key.split('.').at(-1)??'')
    if(routerOnly&&!field&&!v2&&!simpleAnswer&&!rolePreference)return next({...e,isHidden:true})
    if(rolePreference)return next({...e,isHidden:false})
    if(simpleAnswer)return next({...e,label:'Router · Simple answers & chat model',description:'Saved default model for simple answers and standalone greetings/thanks. V2 prefers low effort when configured. Continuations and approvals are not chat; routing switches and pins still apply. Native menu edits save defaults, not session-only overrides.',isHidden:false})
    if(v2)return next({...e,label:`Router · ${v2}`,description:'V2 routes configured model/effort preferences; context and ordinary execution limits are host-managed. Shadow classification is separately opt-in. Acceptance requires current evidence; review mode alone grants no spend. Persistent pins are execution-purpose; checks trust only user/managed-policy sources.',isHidden:false})
    if(!field)return next(e)
    const row=ROUTER_TOGGLES.find(row=>row.key===field)
    return next({...e,label:row?`Router · ${row.label}`:'Router · Mode',description:row?.description??'Basic: fast/balanced/deep routing. Custom: our task preferences with Basic fallback. Observe: Basic still routes; only logs what Custom would pick. All respect routing switches. Customize hooks/task-routing.ts and catalog/models.json; run node scripts/build-catalog.mjs after editing.',isHidden:false})
  })
  on('config.set',async($,e,next)=>{
    const key=v2Field(e.key,e.provider?.plugin)
    if(key) {
      if(e.origin?.kind!=='composer')return {deny:'Only a verified composer action can change router v2 controls, pins or check definitions.'}
      if(!validV2(key,e.value))return {deny:'Invalid router v2 configuration.'}
      if(key==='policyEngine'&&e.value!=='legacy'&&!controls.runtime)return {deny:'V2 application/shadow adapter is not implemented; keep legacy.'}
      const result=await next(e)
      if(result.deny!==undefined)return result
      if(['policyEngine','routeSubagentEffort','reviewMode'].includes(key)&&validV2(key,result.value)){
        Object.assign(controls.v2,{[key]:result.value});if(key==='policyEngine')controls.engineError=null
      }
      await authority($,controls)
      return result
    }
    const field=routerField(e.key,e.provider?.plugin)
    if(!field)return next(e)
    if(field==='enabled'&&(e.origin?.kind!=='composer'||typeof e.value!=='boolean'))return {deny:'Only a verified composer action can change the router master switch to on or off.'}
    const result=await next(e)
    if(result.deny!==undefined)return result
    const value=result.value
    if(field==='mode'?!['basic','custom','observe','off','apply'].includes(value as string):typeof value!=='boolean')return result
    controls.update({[field]:field==='mode'?normalizeRouterMode(value):value})
    try{await $.store.set(STORE_KEY,controls.state)}catch{$.ui.log('[router] Native setting saved; legacy defaults cache could not be updated.')}
    return result
  }).catch(($,e,next)=>next.called?next(e):{deny:'Router configuration unavailable after a control error.'})
}

const CONFIG_FIELDS:Record<string,keyof RouterSettings>={enabled:'enabled',taskRoutingMode:'mode',routeMainModel:'mainModel',routeMainEffort:'mainEffort',routeSubagentModel:'subagents',classifyTurns:'classifyTurns'}
export function routerField(key:string,plugin?:string):keyof RouterSettings|null {
  if(plugin?.split('@')[0]!=='jev-model-router')return null
  const field=key.slice(key.lastIndexOf('.')+1)
  return Object.hasOwn(CONFIG_FIELDS,field)?CONFIG_FIELDS[field]!:null
}
function v2Field(key:string,plugin?:string):typeof V2_FIELDS[number]|null {
  if(plugin?.split('@')[0]!=='jev-model-router')return null
  const field=key.slice(key.lastIndexOf('.')+1)
  return V2_FIELDS.includes(field as typeof V2_FIELDS[number])?field as typeof V2_FIELDS[number]:null
}

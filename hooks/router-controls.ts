import type {Register} from 'claude-code'
export interface RouterSettings {
  mode: 'off' | 'observe' | 'apply'
  mainModel: boolean
  mainEffort: boolean
  subagents: boolean
  classifyTurns: boolean
}
export const ROUTER_TOGGLES = [
  {key:'mainModel',label:'Main model routing',description:'Allow the router to change the model in the main conversation.'},
  {key:'mainEffort',label:'Main effort routing',description:'Allow the router to adjust the main conversation’s reasoning effort.'},
  {key:'subagents',label:'Subagent routing',description:'Choose models for delegated tasks using task type and your preferences.'},
  {key:'classifyTurns',label:'Per-turn logging',description:'Classify each prompt and show recommendations even when main routing is fixed.'},
] as const
const STORE_KEY = 'model-router.defaults.v1'
export function validSettings(input: unknown): input is RouterSettings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false
  const v=input as Record<string,unknown>
  return ['off','observe','apply'].includes(v.mode as string) && ['mainModel','mainEffort','subagents','classifyTurns'].every(k=>typeof v[k]==='boolean')
}
export function routerStatus(s:RouterSettings):string {
  const yes=(v:boolean)=>v?'on':'off'
  return `Model router\nClassifier: Jev\nMode: ${s.mode}\nMain model routing: ${yes(s.mainModel)}\nMain effort routing: ${yes(s.mainEffort)}\nSubagent routing: ${yes(s.subagents)}\nPer-turn classification/logging: ${yes(s.classifyTurns)}`
}
export const ROUTER_HELP = '/router opens the menu. Commands: status; mode [off|observe|apply]; main-model on|off; main-effort on|off; subagents on|off; classify-turns on|off; save; reset. Changes affect this session immediately. Save persists defaults for future sessions; reset removes saved defaults and restores plugin options.'
const KEYS = {'main-model':'mainModel','main-effort':'mainEffort',subagents:'subagents','classify-turns':'classifyTurns'} as const
export function parseRouterCommand(args:string): {kind:'status'|'menu'|'mode-menu'|'save'|'reset'|'help'} | {kind:'change'; patch:Partial<RouterSettings>} | {kind:'error'} {
  const tokens=args.trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return {kind:'menu'}
  if(tokens.length===1&&tokens[0]==='mode')return {kind:'mode-menu'}
  if (tokens.length===1 && ['status','save','reset','help'].includes(tokens[0])) return {kind:tokens[0] as 'status'|'save'|'reset'|'help'}
  if (tokens.length!==2) return {kind:'error'}
  if (tokens[0]==='mode' && ['off','observe','apply'].includes(tokens[1])) return {kind:'change',patch:{mode:tokens[1] as RouterSettings['mode']}}
  const key=KEYS[tokens[0] as keyof typeof KEYS]
  if(key && ['on','off'].includes(tokens[1])) return {kind:'change',patch:{[key]:tokens[1]==='on'}}
  return {kind:'error'}
}
/** Runtime state is session-local. Store is read once at session start; save is explicit. */
export function createRouterControls(initial:RouterSettings) {
  const controls={initial:{...initial},state:{...initial},current:()=>({...controls.state})}
  return controls
}
export function registerRouterControls(on:Parameters<Register>[0],controls:ReturnType<typeof createRouterControls>) {
  const menuState={plugin:"jev-model-router",key:"routerMenuOpen"} as const
  on('session.start',async($,e,next)=>{
    try {
      const saved=await $.store.get(STORE_KEY)
      if(validSettings(saved)) controls.state={mode:saved.mode,mainModel:saved.mainModel,mainEffort:saved.mainEffort,subagents:saved.subagents,classifyTurns:saved.classifyTurns}
    } catch { $.ui.log('[router] Could not read saved defaults; using plugin options.') }
    await $.command.register({name:'router',description:'Model routing menu and session controls',argumentHint:'[status | mode | main-model | main-effort | subagents | classify-turns | save | reset]'})
    return next(e)
  })
  on('command.run',async($,e,next)=>{
    if(e.command!=='router') {
      if(e.origin?.kind!=='plugin') {await $.state.set(menuState,false);$.ui.invalidate('config.describe')}
      return next(e)
    }
    const action=parseRouterCommand(e.args)
    if(action.kind==='help'||action.kind==='error') return {text:ROUTER_HELP}
    if(action.kind==='status') return {text:routerStatus(controls.state)}
    // Settings controls are user actions, never hidden calls from another plugin.
    if(e.origin.kind==='plugin') return {text:'Run /router yourself to change router settings.'}
    try {
      if(action.kind==='change') {controls.state={...controls.state,...action.patch};return {text:routerStatus(controls.state)+'\nSession updated. Use /router save to persist.'}}
      if(action.kind==='save') {await $.store.set(STORE_KEY,controls.state);return {text:routerStatus(controls.state)+'\nSaved defaults for future sessions.'}}
      if(action.kind==='reset') {await $.store.delete(STORE_KEY);controls.state={...controls.initial};return {text:routerStatus(controls.state)+'\nRestored plugin options and removed saved defaults.'}}
      // command.run cannot nest while this command holds the idle turn.
      await $.state.set(menuState,true)
      $.clock.after(0,()=>{
        $.ui.invalidate('config.describe')
        void $.command.run({command:'config',args:''}).catch(error=>{
          $.ui.log('[router] Could not open native config: '+String(error))
        }).finally(()=>{
          void $.state.set(menuState,false)
          $.ui.invalidate('config.describe')
        })
      })
      return {}
    } catch(error) {
      $.ui.log('[router] Native config dispatch: '+String(error),{to:'debug'})
      return {text:routerStatus(controls.state)+'\nCould not open native config. Use /config and search Router, or use /router status.'}
    }
  })
  on('config.describe',async($,e,next)=>{
    const field=routerField(e.key,e.provider?.plugin)
    const {value:routerOnly}=await $.state.get(menuState)
    if(routerOnly && !field)return next({...e,isHidden:true})
    if(!field)return next(e)
    const row=ROUTER_TOGGLES.find(row=>row.key===field)
    return next({...e,label:row ? `Router · ${row.label}` : 'Router · Mode',description:row?.description ?? 'Off uses legacy tiers; Observe logs role preferences; Apply uses verified model preferences.',isHidden:false})
  })
  on('config.set',async($,e,next)=>{
    const field=routerField(e.key,e.provider?.plugin)
    if(!field)return next(e)
    const result=await next(e)
    if(result.deny!==undefined)return result
    const value=result.value
    if(field==='mode' ? !['off','observe','apply'].includes(value as string) : typeof value!=='boolean')return result
    controls.state={...controls.state,[field]:value}
    // Keep compatibility with defaults saved by earlier /router versions.
    try {await $.store.set(STORE_KEY,controls.state)} catch {$.ui.log('[router] Native setting saved; legacy defaults cache could not be updated.')}
    return result
  })
}

const CONFIG_FIELDS:Record<string,keyof RouterSettings>={taskRoutingMode:'mode',routeMainModel:'mainModel',routeMainEffort:'mainEffort',routeSubagentModel:'subagents',classifyTurns:'classifyTurns'}
export function routerField(key:string,plugin?:string):keyof RouterSettings|null {
  if(plugin?.split('@')[0]!=='jev-model-router')return null
  const field=key.slice(key.lastIndexOf('.')+1)
  return CONFIG_FIELDS[field] ?? null
}

import type {Register} from 'claude-code'
export interface RouterSettings {
  mode: 'off' | 'observe' | 'apply'
  mainModel: boolean
  mainEffort: boolean
  subagents: boolean
  classifyTurns: boolean
}
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
export const ROUTER_HELP = '/router opens the menu. Commands: status; mode off|observe|apply; main-model on|off; main-effort on|off; subagents on|off; classify-turns on|off; save; reset. Changes affect this session immediately. Save persists defaults for future sessions; reset removes saved defaults and restores plugin options.'
const KEYS = {'main-model':'mainModel','main-effort':'mainEffort',subagents:'subagents','classify-turns':'classifyTurns'} as const
export function parseRouterCommand(args:string): {kind:'status'|'menu'|'save'|'reset'|'help'} | {kind:'change'; patch:Partial<RouterSettings>} | {kind:'error'} {
  const tokens=args.trim().split(/\s+/).filter(Boolean)
  if (!tokens.length) return {kind:'menu'}
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
  on('session.start',async($,e,next)=>{
    try {
      const saved=await $.store.get(STORE_KEY)
      if(validSettings(saved)) controls.state={mode:saved.mode,mainModel:saved.mainModel,mainEffort:saved.mainEffort,subagents:saved.subagents,classifyTurns:saved.classifyTurns}
    } catch { $.ui.log('[router] Could not read saved defaults; using plugin options.') }
    await $.command.register({name:'router',description:'Model routing menu and session controls',argumentHint:'[status | mode | main-model | main-effort | subagents | classify-turns | save | reset]'})
    return next(e)
  })
  on('command.run',async($,e,next)=>{
    if(e.command!=='router') return next(e)
    const action=parseRouterCommand(e.args)
    if(action.kind==='help'||action.kind==='error') return {text:ROUTER_HELP}
    if(action.kind==='status') return {text:routerStatus(controls.state)}
    // Settings controls are user actions, never hidden calls from another plugin.
    if(e.origin.kind==='plugin') return {text:'Run /router yourself to change router settings.'}
    try {
      if(action.kind==='change') {controls.state={...controls.state,...action.patch};return {text:routerStatus(controls.state)+'\nSession updated. Use /router save to persist.'}}
      if(action.kind==='save') {await $.store.set(STORE_KEY,controls.state);return {text:routerStatus(controls.state)+'\nSaved defaults for future sessions.'}}
      if(action.kind==='reset') {await $.store.delete(STORE_KEY);controls.state={...controls.initial};return {text:routerStatus(controls.state)+'\nRestored plugin options and removed saved defaults.'}}
      let notice=''
      while(true) {
        const selected=await $.ui.ask(`${routerStatus(controls.state)}${notice?'\n'+notice:''}\nWhat would you like to change?`,['Mode','Routing switches','Defaults and logging','Done'])
        notice=''
        if(selected==='Done') return {text:routerStatus(controls.state)}
        if(selected==='Mode') {
          const mode=await $.ui.ask('Which routing mode?',['off','observe','apply','Back'])
          if(['off','observe','apply'].includes(mode)) controls.state={...controls.state,mode:mode as RouterSettings['mode']}
        } else if(selected==='Routing switches') {
          const toggle=await $.ui.ask('Which routing switch should change?',[`Main model: ${controls.state.mainModel?'on':'off'}`,`Main effort: ${controls.state.mainEffort?'on':'off'}`,`Subagents: ${controls.state.subagents?'on':'off'}`,'Back'])
          if(toggle===`Main model: ${controls.state.mainModel?'on':'off'}`) controls.state={...controls.state,mainModel:!controls.state.mainModel}
          else if(toggle===`Main effort: ${controls.state.mainEffort?'on':'off'}`) controls.state={...controls.state,mainEffort:!controls.state.mainEffort}
          else if(toggle===`Subagents: ${controls.state.subagents?'on':'off'}`) controls.state={...controls.state,subagents:!controls.state.subagents}
        } else if(selected==='Defaults and logging') {
          const toggle=await $.ui.ask('Which defaults or logging action?',[`Per-turn classification: ${controls.state.classifyTurns?'on':'off'}`,'Save defaults','Reset defaults','Back'])
          if(toggle===`Per-turn classification: ${controls.state.classifyTurns?'on':'off'}`) controls.state={...controls.state,classifyTurns:!controls.state.classifyTurns}
          else if(toggle==='Save defaults') {await $.store.set(STORE_KEY,controls.state);notice='Defaults saved.'}
          else if(toggle==='Reset defaults') {await $.store.delete(STORE_KEY);controls.state={...controls.initial};notice='Restored plugin options.'}
        } else return {text:routerStatus(controls.state)+'\nNo recognized menu action; settings unchanged.'}
      }
    } catch {
      return {text:routerStatus(controls.state)+'\nMenu dismissed or operation unavailable. Session changes already made are retained; use /router status or direct commands.'}
    }
  })
}

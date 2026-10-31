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
const MODE_DESCRIPTIONS={off:'Use the original tier policy without task-role preferences.',observe:'Log task-role preferences while the original policy controls routing.',apply:'Apply task-role preferences when confidence and catalog checks pass.'}
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
      const draft={...controls.state}
      if(action.kind==='mode-menu') {
        const chosen=await $.ui.ask('Model router mode: choose a mode. Enter saves and exits; Esc cancels.',{header:'Router mode',options:['off','observe','apply']})
        if(!['off','observe','apply'].includes(chosen))return {text:'Cancelled; settings unchanged.'}
        draft.mode=chosen as RouterSettings['mode']
      } else {
        while(true) {
          const labels=ROUTER_TOGGLES.map(row=>`${row.label}: ${draft[row.key]?'On':'Off'}`)
          const chosen=await $.ui.ask(`Model router · mode ${draft.mode} · classifier Jev\nChoose a setting to switch On/Off. Enter selects · Esc cancels and exits.`,{header:'Router',options:labels})
          const index=labels.indexOf(chosen)
          if(index<0)return {text:'Cancelled; settings unchanged.'}
          const row=ROUTER_TOGGLES[index]
          draft[row.key]=!draft[row.key]
          const confirmation=await $.ui.ask(`${routerStatus(draft)}\nSave these settings or keep editing.`,{header:'Router save',options:['Save & Exit','Keep editing','Cancel & Exit']})
          if(confirmation==='Save & Exit')break
          if(confirmation!=='Keep editing')return {text:'Cancelled; staged changes discarded.'}
        }
      }
      await $.store.set(STORE_KEY,draft)
      controls.state=draft
      return {text:routerStatus(controls.state)+'\nSaved defaults and exited.'}
    } catch {
      return {text:routerStatus(controls.state)+'\nCancelled or save unavailable; staged changes were not applied. Use /router status to check current settings.'}
    }
  })
  // Keep the engine's original inline dialog and keyboard handling; only add descriptions.
  on('ui.render',async($,e,next)=>{
    if(e.component!=='AskUserQuestion')return next(e)
    const questions=e.props.questions as any[]
    if(!questions.some(q=>q.header==='Router'||q.header==='Router mode'||q.header==='Router save'))return next(e)
    return next({...e,props:{...e.props,questions:questions.map(q=>{
      if(q.header==='Router')return {...q,options:q.options.map((option:any,i:number)=>({...option,description:ROUTER_TOGGLES[i]?.description ?? option.description}))}
      if(q.header==='Router save')return {...q,options:q.options.map((option:any)=>({...option,description:option.label==='Save & Exit'?'Apply these values and save them as defaults.':option.label==='Keep editing'?'Return to the settings list with these staged values.':'Discard staged changes and exit.'}))}
      if(q.header==='Router mode')return {...q,options:q.options.map((option:any)=>({...option,description:MODE_DESCRIPTIONS[option.label as keyof typeof MODE_DESCRIPTIONS] ?? option.description}))}
      return q
    })}})
  })

}

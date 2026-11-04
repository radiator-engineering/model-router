/** Versioned configured preferences. They declare requests, never workload quality or execution authority. */
import {TASK_ROLES} from './contract.ts'
import type {Dimension, Purpose, TaskRole} from './contract.ts'
import type {CatalogV2} from '../model-catalog.ts'
import {DEFAULT_PREFERENCES} from '../task-routing.ts'
import {presetModel} from '../provider-preset.ts'
import type {ProviderPreset} from '../provider-preset.ts'

export interface WorkloadRule {
  id:string
  /** Higher wins; overlapping rules at the same priority are invalid. */
  priority:number
  purpose:Purpose
  roles:TaskRole[]
  /** Every named observation must meet the confidence threshold. */
  when:Partial<Record<Dimension,string[]>>
  /** Primary membership is not fallback authorization. */
  primary:string[]
  preference:string|null
}
export interface PolicyData {
  policyRevision:string
  contractVersion:3
  admission?:'configured'|'evidence'
  confidenceThreshold:number
  providerPreference:string[]
  clarifyWhen:{specification:string[]}
  reviewTriggers:{id:string;when:Partial<Record<Dimension,string[]>>}[]
  rules:WorkloadRule[]
  /** Historical diagnostics only; context fitting is host-owned. */
  manualLimits:{contextMarginFraction:number|null;outputReserveTokens:number|null}
}
const config=(model:string,level:string)=>`configuration/${encodeURIComponent(model)}/level-${level}/unknown`

/** New v2 preferences do not alter the legacy classifier or its defaults. */
export const V2_MODEL_DEFAULTS={
  explanationModel:'claude-sonnet-5-5',writingModel:'gpt-6.1-terra',structuredTextModel:'gpt-6-luna',
  researchModel:'gpt-6.1-terra',analysisModel:'claude-sonnet-5-5',planningModel:'claude-opus-5-5',
  operationsModel:'gpt-6.1-terra',longHorizonModel:'claude-opus-5-5',
} as const
export const POLICY:PolicyData={
  policyRevision:'v2-configured-2026-11-01.4',contractVersion:3,admission:'configured',confidenceThreshold:.8,
  providerPreference:['anthropic'],clarifyWhen:{specification:['unresolved']},
  reviewTriggers:[{id:'consequential-effect',when:{consequence:['consequential']}}],
  rules:[
    {id:'consequential-work',priority:100,purpose:'execution',roles:[...TASK_ROLES],when:{consequence:['consequential']},primary:[config('claude-opus-5-5','medium')],preference:null},
    {id:'mechanical-exact',priority:40,purpose:'execution',roles:['implementation'],when:{specification:['explicit'],verification:['executable'],executionSpan:['bounded']},primary:[config('claude-haiku-5-5','medium')],preference:null},
    {id:'simple-answer',priority:40,purpose:'execution',roles:['simple-answer'],when:{executionSpan:['bounded']},primary:[config('claude-haiku-5-5','medium')],preference:null},
    {id:'file-scout',priority:40,purpose:'execution',roles:['file-scout'],when:{executionSpan:['bounded','dependent-steps']},primary:[config('claude-haiku-5-5','medium')],preference:null},
    {id:'broad-or-orchestration',priority:35,purpose:'execution',roles:['implementation','investigation','planning','research','writing','data-analysis','mathematics','review','summarization','translation','extraction','operations','explanation'],when:{executionSpan:['extended']},primary:[config('claude-opus-5-5','medium')],preference:null},
    {id:'visual-specialist',priority:30,purpose:'execution',roles:['visual-analysis'],when:{},primary:[config('gpt-6-astra','medium')],preference:null},
    {id:'specified-execution',priority:20,purpose:'execution',roles:['implementation'],when:{specification:['explicit','inferable'],verification:['executable','partial']},primary:[config('claude-sonnet-5-5','medium')],preference:null},
    {id:'orchestration',priority:10,purpose:'execution',roles:['orchestration'],when:{},primary:[config('claude-opus-5-5','medium')],preference:null},
    {id:'implementation-default',priority:10,purpose:'execution',roles:['implementation'],when:{},primary:[config('claude-sonnet-5-5','medium')],preference:null},
    {id:'explanation',priority:10,purpose:'execution',roles:['explanation'],when:{},primary:[config('claude-sonnet-5-5','medium')],preference:null},
    {id:'analysis',priority:10,purpose:'execution',roles:['investigation','data-analysis','mathematics','review'],when:{},primary:[config('claude-sonnet-5-5','medium')],preference:null},
    {id:'planning',priority:10,purpose:'execution',roles:['planning'],when:{},primary:[config('claude-opus-5-5','medium')],preference:null},
    {id:'research',priority:10,purpose:'execution',roles:['research'],when:{},primary:[config('gpt-6.1-terra','medium')],preference:null},
    {id:'writing',priority:10,purpose:'execution',roles:['writing'],when:{},primary:[config('gpt-6.1-terra','medium')],preference:null},
    {id:'structured-text',priority:10,purpose:'execution',roles:['summarization','translation','extraction'],when:{},primary:[config('gpt-6-luna','low')],preference:null},
    {id:'operations',priority:10,purpose:'execution',roles:['operations'],when:{},primary:[config('gpt-6.1-terra','medium')],preference:null},
  ],manualLimits:{contextMarginFraction:null,outputReserveTokens:null},
}

/** Exact known identities; arbitrary IDs retain unknown families. No approvals are synthesized. */
export function runtimeCatalog(catalog:CatalogV2):CatalogV2 {
  const families:Record<string,string>={'claude-opus-5-5':'claude','claude-sonnet-5-5':'claude','claude-haiku-5-5':'claude','claude-fable-5-1':'claude','gpt-6-astra':'gpt','gpt-6.1-sol':'gpt','gpt-6.1-terra':'gpt','gpt-6-luna':'gpt'}
  const configurations=[...catalog.configurations]
  for(const model of catalog.models)for(const level of ['low','medium','high','xhigh','max']){
    const id=config(model.id,level)
    if(!configurations.some(c=>c.id===id))configurations.push({id,modelId:model.id,effort:{kind:'level',value:level},requestPath:null})
  }
  configurations.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)
  return {...catalog,models:catalog.models.map(m=>({...m,family:m.family??families[m.id]??null})),configurations}
}
/** Reuse configured model preferences; a missing pair does not invalidate unrelated roles. */
export function configuredPolicy(options:Readonly<Record<string,unknown>>,catalog:CatalogV2,preset:ProviderPreset='mixed'):PolicyData {
  const p:PolicyData=structuredClone(POLICY)
  if(preset!=='mixed')p.policyRevision+=`/${preset}`
  const defaults:Record<string,string>={...V2_MODEL_DEFAULTS,mechanicalModel:DEFAULT_PREFERENCES.mechanical,simpleAnswerModel:DEFAULT_PREFERENCES.simpleAnswer,fileScoutModel:DEFAULT_PREFERENCES.fileScout,orchestrationModel:DEFAULT_PREFERENCES.orchestration,designLedModel:DEFAULT_PREFERENCES.designLed,visualAnalysisModel:DEFAULT_PREFERENCES.visualAnalysis,specifiedModel:DEFAULT_PREFERENCES.specified}
  const keys:Record<string,string>={'consequential-work':'designLedModel','mechanical-exact':'mechanicalModel','simple-answer':'simpleAnswerModel','file-scout':'fileScoutModel','broad-or-orchestration':'longHorizonModel','visual-specialist':'visualAnalysisModel','specified-execution':'specifiedModel',orchestration:'orchestrationModel','implementation-default':'specifiedModel',explanation:'explanationModel',analysis:'analysisModel',planning:'planningModel',research:'researchModel',writing:'writingModel','structured-text':'structuredTextModel',operations:'operationsModel'}
  p.rules=p.rules.map(r=>{
    const key=keys[r.id]!,defaultModel=defaults[key]!
    const preferred=typeof options[key]==='string'&&options[key]?options[key] as string:defaultModel
    const model=presetModel(preferred,defaultModel,preset,catalog.models)
    const levels=preset==='gpt'&&model==='gpt-6-luna'?['low']:r.id==='simple-answer'?['low','medium']:r.id==='structured-text'?['low']:key==='longHorizonModel'&&model==='claude-fable-5-1'?['high']:['medium']
    const cfg=levels.map(level=>catalog.configurations.find(c=>c.modelId===model&&c.effort.kind==='level'&&c.effort.value===level)).find(Boolean)
    return {...r,primary:cfg?[cfg.id]:[],preference:null}
  }).filter(r=>r.primary.length)
  return p
}

/**
 * Versioned v2 policy data. Configured routing uses declared model preferences
 * and compatibility without claiming benchmark approval. Evidence-only replay
 * additionally requires scoped, fresh workload admission. Context fitting is
 * owned by the harness/provider, never a condition for routing.
 */
import type {Dimension, Purpose, TaskRole} from './contract.ts'
import type {CatalogV2} from '../model-catalog.ts'
import {DEFAULT_PREFERENCES,ROLES} from '../task-routing.ts'

export interface WorkloadRule {
  id: string
  /** Higher wins. Overlapping rules at the same priority make the policy invalid. */
  priority: number
  purpose: Purpose
  roles: TaskRole[]
  /** Required observation values; every named observation must meet the threshold. */
  when: Partial<Record<Dimension, string[]>>
  /** Permitted primary configuration IDs. Membership grants no fallback permission. */
  primary: string[]
  /** Configured workload preference within `primary`, or null. */
  preference: string | null
}
export interface PolicyData {
  policyRevision: string
  contractVersion: 3
  /** Configured preferences are not scientific workload approvals. Omitted keeps evidence-only replay. */
  admission?: 'configured' | 'evidence'
  /** Provisional per-field threshold (decision contract §5); not a calibrated claim. */
  confidenceThreshold: number
  /** Soft provider preference, most preferred first. */
  providerPreference: string[]
  /** Confident observations that mean a material decision is missing. */
  clarifyWhen: {specification: string[]}
  /** Confident observations that recommend (never require) review. */
  reviewTriggers: {id: string; when: Partial<Record<Dimension, string[]>>}[]
  rules: WorkloadRule[]
  /** Historical metadata only; the router does not enforce context margins/reserves. */
  manualLimits: {contextMarginFraction: number | null; outputReserveTokens: number | null}
}

const config = (model: string, level: string) => `configuration/${model}/level-${level}/unknown`

export const POLICY: PolicyData = {
  policyRevision: 'v2-configured-2026-11-01.3',
  contractVersion: 3,
  admission:'configured',
  confidenceThreshold: 0.8,
  providerPreference: ['anthropic'],
  clarifyWhen: {specification: ['unresolved']},
  reviewTriggers: [{id: 'consequential-effect', when: {consequence: ['consequential']}}],
  rules: [
    {id:'consequential-work',priority:100,purpose:'execution',roles:[...ROLES],when:{consequence:['consequential']},primary:[config('claude-opus-5-5','medium')],preference:null},
    {id:'mechanical-exact',priority:40,purpose:'execution',roles:['implementation'],when:{specification:['explicit'],verification:['executable'],executionSpan:['bounded']},primary:[config('claude-haiku-5-5','medium')],preference:null},
    {id:'simple-answer',priority:40,purpose:'execution',roles:['simple-answer'],when:{executionSpan:['bounded']},primary:[config('claude-haiku-5-5','medium')],preference:null},
    {id:'file-scout',priority:40,purpose:'execution',roles:['file-scout'],when:{executionSpan:['bounded','dependent-steps']},primary:[config('claude-haiku-5-5','medium')],preference:null},
    {id:'broad-or-orchestration',priority:30,purpose:'execution',roles:['orchestration','investigation','implementation'],when:{executionSpan:['extended']},primary:[config('claude-opus-5-5','medium')],preference:null},
    {id:'visual-specialist',priority:30,purpose:'execution',roles:['visual-analysis'],when:{},primary:[config('gpt-6-astra','medium')],preference:null},
    {id:'specified-execution',priority:20,purpose:'execution',roles:['implementation'],when:{specification:['explicit','inferable'],verification:['executable','partial']},primary:[config('claude-sonnet-5-5','medium')],preference:null},
    {id:'orchestration',priority:10,purpose:'execution',roles:['orchestration'],when:{},primary:[config('claude-opus-5-5','medium')],preference:null},
  ],
  // Retained as historical metadata; context management is delegated to the host.
  manualLimits: {contextMarginFraction: null, outputReserveTokens: null},
}

/** Exact builtin identities only; arbitrary advertised IDs retain unknown families. */
export function runtimeCatalog(catalog:CatalogV2):CatalogV2 {
  const families:Record<string,string>={'claude-opus-5-5':'claude','claude-sonnet-5-5':'claude','claude-haiku-5-5':'claude','gpt-6-astra':'gpt','gpt-6.1-sol':'gpt'}
  const configurations=[...catalog.configurations]
  for(const model of catalog.models)for(const level of ['low','medium','high','xhigh','max']){
    const id=`configuration/${encodeURIComponent(model.id)}/level-${level}/unknown`
    if(!configurations.some(c=>c.id===id))configurations.push({id,modelId:model.id,effort:{kind:'level',value:level},requestPath:null})
  }
  configurations.sort((a,b)=>a.id<b.id?-1:a.id>b.id?1:0)
  return {...catalog,models:catalog.models.map(m=>({...m,family:m.family??families[m.id]??null})),configurations}
}
/** Reuse existing preference options; a missing preferred profile cannot break unrelated work. */
export function configuredPolicy(options:Readonly<Record<string,unknown>>,catalog:CatalogV2):PolicyData {
  const p:PolicyData=structuredClone(POLICY)
  const defaults:Record<string,string>={mechanicalModel:DEFAULT_PREFERENCES.mechanical,simpleAnswerModel:DEFAULT_PREFERENCES.simpleAnswer,fileScoutModel:DEFAULT_PREFERENCES.fileScout,orchestrationModel:DEFAULT_PREFERENCES.orchestration,designLedModel:DEFAULT_PREFERENCES.designLed,visualAnalysisModel:DEFAULT_PREFERENCES.visualAnalysis,specifiedModel:DEFAULT_PREFERENCES.specified}
  const primary=(key:string,lightweight:boolean)=>{
    const model=typeof options[key]==='string'&&options[key]?options[key] as string:defaults[key]!
    const cfg=(lightweight?['low','medium']:['medium']).map(level=>catalog.configurations.find(c=>c.modelId===model&&c.effort.kind==='level'&&c.effort.value===level)).find(Boolean)
    return cfg?[cfg.id]:[]
  }
  const keys:Record<string,string>={'consequential-work':'designLedModel','mechanical-exact':'mechanicalModel','simple-answer':'simpleAnswerModel','file-scout':'fileScoutModel','broad-or-orchestration':'designLedModel','visual-specialist':'visualAnalysisModel','specified-execution':'specifiedModel',orchestration:'orchestrationModel'}
  p.rules=p.rules.map(r=>({...r,primary:primary(keys[r.id]!,r.id==='simple-answer'),preference:null})).filter(r=>r.primary.length)
  return p
}

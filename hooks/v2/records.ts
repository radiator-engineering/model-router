/** Bounded, allow-listed decision telemetry. Never serialize prompts, headers or a runtime config object. */
import {CONTRACT_VERSION, fingerprint, isObject} from './contract.ts'
import type {EffortToken, PolicyDecision, PolicySnapshot} from './contract.ts'

export type Engine = 'legacy' | 'v2-shadow' | 'v2'
export type ConsumptionStage = 'classifier' | 'author' | 'reviewer' | 'repair' | 'targeted'
export interface UsageRecord {
  inputTokens: number | null; outputTokens: number | null
  cacheReadTokens: number | null; cacheWriteTokens: number | null
}
export interface DecisionRecord {
  schemaVersion: 1
  assignmentId: string; parentId: string | null; lineageId: string
  candidateId: string | null; revision: string | null
  purpose: 'execution' | 'review'; reviewStage: 'full' | 'targeted' | null
  appliedEngine: Engine | null; proposedEngine: Engine; legacyMode: string | null
  pluginVersion: string | null; sourceRevision: string | null; sourceFingerprint: string | null
  contractVersion: number; policyRevision: string; catalogFingerprint: string | null; snapshotFingerprint: string | null
  controls: PolicySnapshot['controls']; pinIntentFingerprint: string
  pinPurpose: 'execution' | 'review'; overrideSources: PolicyDecision['overrideSources']
  outcome: PolicyDecision['outcome']; reasons: PolicyDecision['reasons']; ruleId: string | null
  proposed: PolicyDecision['configuration']; applied: {model: string; effort: EffortToken} | null
  observed: {model: string | null; effort: EffortToken | null}
  environment: PolicySnapshot['environment']
  review: PolicyDecision['review']
  candidates: {configurationId: string | null; failed: {check: string; reason: string}[]}[]
  classifier: {provider: string | null; model: string | null; deadlineMs: number; status: string; elapsedMs: number | null; usage: UsageRecord | null}
  consumption: {stage: ConsumptionStage; usage: UsageRecord | null}[]
  remainingProviderQuota: null
}
const token = (v: unknown): number | null => typeof v==='number' && Number.isSafeInteger(v) && v>=0 ? v : null
export function normalizeUsage(value: unknown): UsageRecord | null {
  if(!isObject(value))return null
  return {inputTokens:token(value.input_tokens??value.inputTokens),outputTokens:token(value.output_tokens??value.outputTokens),
    cacheReadTokens:token(value.cache_read_input_tokens??value.cacheReadTokens),cacheWriteTokens:token(value.cache_creation_input_tokens??value.cacheWriteTokens)}
}
export function decisionRecord(s:PolicySnapshot,d:PolicyDecision,meta:{
  appliedEngine:Engine|null;proposedEngine:Engine;legacyMode:string|null
  pluginVersion?:string|null;sourceRevision?:string|null;sourceFingerprint?:string|null
  candidateId?:string|null;revision?:string|null
  classifier:{provider:string|null;model:string|null;deadlineMs:number;status:string;elapsedMs:number|null;usage?:unknown}
}):DecisionRecord {
  return {
    schemaVersion:1,assignmentId:s.assignment.id,parentId:s.assignment.parentId,lineageId:s.assignment.lineageId,
    candidateId:meta.candidateId??null,revision:meta.revision??null,purpose:s.assignment.purpose,reviewStage:s.assignment.reviewStage,
    appliedEngine:meta.appliedEngine,proposedEngine:meta.proposedEngine,legacyMode:meta.legacyMode,
    pluginVersion:meta.pluginVersion??null,sourceRevision:meta.sourceRevision??null,sourceFingerprint:meta.sourceFingerprint??null,
    contractVersion:CONTRACT_VERSION,policyRevision:d.policyRevision,catalogFingerprint:d.catalogRevision,snapshotFingerprint:d.snapshotFingerprint,
    controls:{...s.controls},pinIntentFingerprint:fingerprint(s.pins),pinPurpose:s.assignment.purpose,overrideSources:{...d.overrideSources},
    outcome:d.outcome,reasons:[...d.reasons],ruleId:d.ruleId,proposed:d.configuration?structuredClone(d.configuration):null,
    applied:null,observed:{model:null,effort:null},environment:{...s.environment},review:{...d.review},
    candidates:d.candidates.map(c=>({configurationId:c.configurationId,failed:c.failed.map(f=>({check:f.check,reason:f.reason}))})),
    classifier:{provider:meta.classifier.provider,model:meta.classifier.model,deadlineMs:meta.classifier.deadlineMs,
      status:meta.classifier.status,elapsedMs:meta.classifier.elapsedMs,usage:normalizeUsage(meta.classifier.usage)},
    consumption:[{stage:'classifier',usage:normalizeUsage(meta.classifier.usage)}],remainingProviderQuota:null,
  }
}
export function legacyRecord(input:{assignmentId:string;parentId:string|null;lineageId:string;mode:string;model:string;effort:EffortToken;
  previousModel:string;previousEffort:EffortToken;controls:PolicySnapshot['controls'];pins:unknown;pluginVersion:string|null;sourceRevision:string|null;sourceFingerprint:string|null;
  catalogFingerprint:string;provider:string|null;classifierModel:string|null;deadlineMs:number;elapsedMs:number|null;usage:unknown}):DecisionRecord {
  const changed=input.model!==input.previousModel||fingerprint(input.effort)!==fingerprint(input.previousEffort)
  return {schemaVersion:1,assignmentId:input.assignmentId,parentId:input.parentId,lineageId:input.lineageId,candidateId:null,revision:null,
    purpose:'execution',reviewStage:null,appliedEngine:'legacy',proposedEngine:'legacy',legacyMode:input.mode,
    pluginVersion:input.pluginVersion,sourceRevision:input.sourceRevision,sourceFingerprint:input.sourceFingerprint,
    contractVersion:CONTRACT_VERSION,policyRevision:`legacy/${input.mode}`,catalogFingerprint:input.catalogFingerprint,snapshotFingerprint:fingerprint({assignmentId:input.assignmentId,model:input.previousModel,effort:input.previousEffort,controls:input.controls}),
    controls:{...input.controls},pinIntentFingerprint:fingerprint(input.pins),pinPurpose:'execution',overrideSources:{model:'native-origin-unknown',effort:'native-origin-unknown'},
    outcome:changed?'select':'preserve',reasons:[changed?'rule_selected':'already_selected'],ruleId:null,
    proposed:null,applied:{model:input.model,effort:structuredClone(input.effort)},observed:{model:null,effort:null},
    environment:{id:null,harnessVersion:null,proxyVersion:null,requestPath:null},review:{disposition:'not-requested',trigger:null,distinctFamily:false},candidates:[],
    classifier:{provider:input.provider,model:input.classifierModel,deadlineMs:input.deadlineMs,status:'legacy',elapsedMs:input.elapsedMs,usage:normalizeUsage(input.usage)},
    consumption:[{stage:'classifier',usage:normalizeUsage(input.usage)}],remainingProviderQuota:null}
}
export function appendRecord(records:readonly DecisionRecord[],record:DecisionRecord,limit=128):DecisionRecord[] {
  if(!Number.isSafeInteger(limit)||limit<1||limit>1024)throw Error('invalid record retention limit')
  return [...records.filter(r=>r.assignmentId!==record.assignmentId),structuredClone(record)].slice(-limit)
}
export function recordConsumption(record:DecisionRecord,stage:ConsumptionStage,usage:unknown):DecisionRecord {
  const copy=structuredClone(record)
  copy.consumption=[...copy.consumption,{stage,usage:normalizeUsage(usage)}].slice(-128)
  return copy
}

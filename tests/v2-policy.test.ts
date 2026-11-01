import {expect,test} from 'claude-code/testing'
import {readFileSync} from 'node:fs'
import {loadReplay,mismatches,runCase} from '../scripts/v2-replay-lib.mjs'
import {decide,validatePolicy} from '../hooks/v2/policy.ts'
import {POLICY,configuredPolicy,runtimeCatalog} from '../hooks/v2/policy-data.ts'
import {effortTokenOf,fingerprint} from '../hooks/v2/contract.ts'
import {parseCatalogV2} from '../hooks/model-catalog.ts'
const {fixture,sources}=await loadReplay()
const synthetic=sources.synthetic, production=sources.production
const base=()=>structuredClone(fixture.cases.find((c:any)=>c.id==='specified-downgrade').snapshot)
const prodBase=()=>structuredClone(fixture.cases.find((c:any)=>c.id==='production-timeout-preserves').snapshot)
const o=(value:string,confidence:number|null=.95)=>({value,confidence})

for(const c of fixture.cases)test(`replay ${c.catalog}: ${c.id}`,()=>{expect(runCase(c,sources).problems).toEqual([])})

test('replay covers every outcome and both catalogs',()=>{
 const outcomes=new Set(fixture.cases.map((c:any)=>c.expected.outcome))
 for(const x of ['select','preserve','clarify','unavailable'])expect(outcomes.has(x)).toBe(true)
 expect(fixture.cases.filter((c:any)=>c.catalog==='production').length>0).toBe(true)
})
test('the comparator rejects a wrong expectation (guards against vacuous passes)',()=>{
 const d=decide(base(),synthetic.policy,synthetic.catalog)
 expect(mismatches(d,{outcome:'clarify'}).length).toBe(1)
 expect(mismatches(d,{reasonsInclude:['budget_denied']}).length).toBe(1)
 expect(mismatches(d,{configurationId:'nope'}).length).toBe(1)
 expect(mismatches(d,{outcome:d.outcome,reasons:d.reasons})).toEqual([])
})
test('production policy is valid against the migrated catalog',()=>{expect(validatePolicy(POLICY,production.catalog)).toEqual([])})
test('configured production rules use declared preferences without inventing workload approvals',()=>{
 const values:Record<string,string>={specification:'explicit',verification:'executable',executionSpan:'bounded',consequence:'reversible'}
 for(const rule of POLICY.rules){
  const s=prodBase();const w=rule.when as Record<string,string[]>
  s.classification={status:'ok',output:{role:o(rule.roles[0]),...Object.fromEntries(Object.keys(values).map(k=>[k,o(w[k]?.[0]??values[k])]))}}
  const d=decide(s,POLICY,production.catalog)
  expect(['select','preserve'].includes(d.outcome)).toBe(true);expect(d.qualification).toBe('configured')
  expect(d.candidates.every(c=>c.approvalId===null&&c.limits===null)).toBe(true)
  const evidenceOnly=decide(s,{...POLICY,admission:'evidence'},production.catalog)
  expect(evidenceOnly.outcome).toBe('unavailable');expect(evidenceOnly.reasons.includes('workload_unapproved')).toBe(true)
 }
 expect(production.catalog.approvals).toEqual([]);expect(production.catalog.environments).toEqual([])
})
test('simple answers use confident role/span without requiring implementation specification confidence',()=>{
 const s=prodBase();s.current={model:'gpt-6.1-sol',effort:'high',modelOrigin:'inherited',effortOrigin:'inherited'};s.controls.changeModel=true;s.controls.changeEffort=true
 s.classification={status:'ok',output:{role:o('simple-answer',1),specification:o('explicit',.68),verification:o('executable',.88),executionSpan:o('bounded',.97),consequence:o('reversible',.7)}}
 const d=decide(s,POLICY,production.catalog)
 expect(d.outcome).toBe('select');expect(d.configuration?.model).toBe('claude-haiku-5-5');expect(d.configuration?.effort).toEqual({kind:'level',value:'medium'})
 for(const field of ['role','executionSpan']){const weak=structuredClone(s);weak.classification.output[field].confidence=.79;expect(decide(weak,POLICY,production.catalog).outcome).toBe('preserve')}
 const risky=structuredClone(s);risky.classification.output.consequence=o('consequential',1)
 expect(decide(risky,POLICY,production.catalog).ruleId).toBe('consequential-work')
})
test('configured simple answers and chat prefer low effort, reuse the model preference and respect fixed effort/pins',()=>{
 const catalog=runtimeCatalog(production.catalog),policy=configuredPolicy({},catalog),s=prodBase()
 s.current={model:'gpt-6.1-sol',effort:'high',modelOrigin:'inherited',effortOrigin:'inherited'};s.controls.changeModel=true;s.controls.changeEffort=true
 s.classification={status:'ok',output:{role:o('simple-answer'),specification:o('unknown',null),verification:o('judgment'),executionSpan:o('bounded'),consequence:o('unknown',null)}}
 const d=decide(s,policy,catalog);expect(d.configuration?.model).toBe('claude-haiku-5-5');expect(d.configuration?.effort).toEqual({kind:'level',value:'low'})
 const custom=decide(s,configuredPolicy({simpleAnswerModel:'claude-sonnet-5-5'},catalog),catalog)
 expect(custom.configuration?.model).toBe('claude-sonnet-5-5');expect(custom.configuration?.effort).toEqual({kind:'level',value:'low'})
 const fixed=structuredClone(s);fixed.controls.changeEffort=false
 expect(decide(fixed,policy,catalog).configuration?.effort).toEqual({kind:'level',value:'high'})
 const pinned=structuredClone(s);pinned.pins=[{field:'effort',value:'high',scope:'session',purpose:'execution',source:'router-command',experimental:false}]
 expect(decide(pinned,policy,catalog).configuration?.effort).toEqual({kind:'level',value:'high'})
 const mediumOnly=configuredPolicy({},production.catalog).rules.find(r=>r.id==='simple-answer')!
 expect(mediumOnly.primary).toEqual(POLICY.rules.find(r=>r.id==='simple-answer')!.primary)
})
test('unknown and low-confidence roles never become a lightweight default',()=>{
 const catalog=runtimeCatalog(production.catalog),policy=configuredPolicy({},catalog),s=prodBase()
 s.classification={status:'ok',output:{role:o('unknown',null),specification:o('unknown',null),verification:o('unknown',null),executionSpan:o('bounded'),consequence:o('unknown',null)}}
 expect(decide(s,policy,catalog).outcome).toBe('preserve')
 s.classification.output.role=o('simple-answer',.79)
 expect(decide(s,policy,catalog).outcome).toBe('preserve')
})
test('explanation without a configured rule preserves rather than inventing a lower tier',()=>{
 const s=prodBase();s.classification={status:'ok',output:{role:o('explanation'),specification:o('inferable'),verification:o('judgment'),executionSpan:o('bounded'),consequence:o('reversible')}}
 const d=decide(s,POLICY,production.catalog);expect(d.outcome).toBe('preserve');expect(d.reasons).toEqual(['no_matching_rule'])
})
test('same-priority overlapping rules make the policy invalid and block dispatch',()=>{
 const policy=structuredClone(synthetic.policy);policy.rules[2].priority=policy.rules[3].priority;policy.rules[2].roles=['implementation']
 expect(validatePolicy(policy,synthetic.catalog).some((e:string)=>e.includes('conflict at priority'))).toBe(true)
 const d=decide(base(),policy,synthetic.catalog)
 expect(d.outcome).toBe('unavailable');expect(d.reasons).toEqual(['configuration_invalid'])
})
test('policy references must resolve: primaries, preferences and approval rule IDs',()=>{
 const p=structuredClone(synthetic.policy);p.rules[0].primary=['missing'];p.rules[1].preference='elsewhere'
 const errors=validatePolicy(p,synthetic.catalog).join('\n')
 expect(errors).toContain('is not in the catalog');expect(errors).toContain('preference must be one of')
 const c=structuredClone(synthetic.catalog);c.approvals[0].policyRuleIds=['retired-rule']
 expect(validatePolicy(synthetic.policy,c).join('\n')).toContain('names unknown rule retired-rule')
})
test('invalid snapshots and non-v2 catalogs return configuration_invalid without inference',()=>{
 const s=base();(s as any).controls.changeModel='yes'
 expect(decide(s,synthetic.policy,synthetic.catalog).reasons).toEqual(['configuration_invalid'])
 const bad=base();bad.classification={status:'ok',output:null}
 expect(decide(bad,synthetic.policy,synthetic.catalog).outcome).toBe('unavailable')
 const v1=JSON.parse(readFileSync(new URL('./fixtures/catalog-v1-migration.json',import.meta.url),'utf8'))
 expect(decide(base(),synthetic.policy,v1 as any).reasons).toEqual(['configuration_invalid'])
})
test('selection never mutates its inputs',()=>{
 const s=base(),c=structuredClone(synthetic.catalog),p=structuredClone(synthetic.policy)
 const before=JSON.stringify([s,c,p]);decide(s,p,c)
 expect(JSON.stringify([s,c,p])).toBe(before)
})
test('fingerprints ignore key order but change with content',()=>{
 expect(fingerprint({a:1,b:[1,{c:2,d:3}]})).toBe(fingerprint({b:[1,{d:3,c:2}],a:1}))
 const a=decide(base(),synthetic.policy,synthetic.catalog),s=base();s.now='2026-10-31T12:00:01Z'
 expect(decide(s,synthetic.policy,synthetic.catalog).snapshotFingerprint===a.snapshotFingerprint).toBe(false)
})
test('numeric effort stays a literal budget, never a named level',()=>{
 expect(effortTokenOf(4096,'inherited')).toEqual({kind:'budget',value:4096})
 expect(effortTokenOf(null,'harness-default')).toEqual({kind:'default'})
 expect(effortTokenOf(null,'inherited')).toEqual({kind:'unknown'})
 expect(effortTokenOf(-1,'inherited')).toEqual({kind:'unknown'})
})
test('expired approvals and restricted approvals do not qualify',()=>{
 const expired=base();expired.now='2027-01-15T00:00:00Z'
 const d=decide(expired,synthetic.policy,synthetic.catalog)
 expect(d.outcome).toBe('unavailable');expect(d.reasons.includes('workload_unapproved')).toBe(true);expect(d.reasons.includes('availability_unknown')).toBe(true)
 const c=structuredClone(synthetic.catalog);for(const a of c.approvals)if(a.id.includes('syn-sonnet/medium/implementation'))a.state='restricted'
 const r=decide(base(),synthetic.policy,parseCatalogV2(c))
 expect(r.outcome).toBe('unavailable');expect(r.reasons.includes('model_disabled')).toBe(true)
})
test('environment version mismatch removes compatibility evidence',()=>{
 const s=base();s.environment.harnessVersion='2.1.999'
 const d=decide(s,synthetic.policy,synthetic.catalog)
 expect(d.outcome).toBe('unavailable');expect(d.reasons.includes('compatibility_unknown')).toBe(true)
})
test('a later contradicting availability observation blocks selection',()=>{
 const c=structuredClone(synthetic.catalog)
 c.availability.push({id:'synthetic/availability/syn-sonnet/z-later',modelId:'syn-sonnet',status:'unavailable',observedAt:'2026-10-31T06:00:00Z',validUntil:null,evidenceId:'synthetic/evidence/eval'})
 c.availability.sort((a:any,b:any)=>a.id<b.id?-1:1)
 const d=decide(base(),synthetic.policy,parseCatalogV2(c))
 expect(d.outcome).toBe('unavailable');expect(d.reasons).toEqual(['model_unavailable'])
})
test('context estimates, windows, margins and reserves do not control routing',()=>{
 const reference=decide(base(),synthetic.policy,synthetic.catalog)
 for(const inputTokens of [null,170000,250000,1_000_000]){
  const s=base();s.requirements.inputTokens=inputTokens
  const catalog=structuredClone(synthetic.catalog)
  for(const c of catalog.compatibility)c.contextWindowTokens=null
  const d=decide(s,synthetic.policy,catalog)
  expect(d.outcome).toBe(reference.outcome);expect(d.configuration).toEqual(reference.configuration)
  expect(d.candidates.every(c=>!c.passed.includes('context')&&!c.failed.some(f=>f.check==='context'))).toBe(true)
 }
})
test('a failed preferred primary is not silently replaced by another primary',()=>{
 const p=structuredClone(synthetic.policy),s=base()
 const rule=p.rules.find((r:any)=>r.id==='syn-specified')!
 const opus=synthetic.catalog.configurations.find((c:any)=>c.modelId==='syn-opus'&&c.effort.value==='medium')!
 rule.primary.push(opus.id)
 rule.preference=rule.primary[0]
 s.resources.exhaustedModels=['syn-sonnet']
 const d=decide(s,p,synthetic.catalog)
 expect(d.outcome).toBe('unavailable');expect(d.reasons).toContain('model_unavailable')
 expect(d.candidates.length).toBe(1)
})
test('malformed policies return configuration_invalid instead of throwing',()=>{
 for(const p of [null,{}, {...synthetic.policy,rules:null}, {...synthetic.policy,rules:[null]}, {...synthetic.policy,reviewTriggers:'not-an-array'}]){
  const d=decide(base(),p as any,synthetic.catalog)
  expect(d.outcome).toBe('unavailable');expect(d.reasons).toEqual(['configuration_invalid'])
 }
})
test('host-managed context does not block preservation; required reviewer independence still does',()=>{
 const s=base();s.controls={...s.controls,changeModel:false,changeEffort:false};s.requirements.inputTokens=190000
 expect(decide(s,synthetic.policy,synthetic.catalog).outcome).toBe('preserve')
 const r=structuredClone(fixture.cases.find((c:any)=>c.id==='reviewer-cross-family').snapshot)
 r.current={model:'syn-opus',modelOrigin:'inherited',effort:'medium',effortOrigin:'inherited'}
 r.controls.changeModel=false;r.controls.changeEffort=false
 const d=decide(r,synthetic.policy,synthetic.catalog)
 expect(d.outcome).toBe('unavailable');expect(d.reasons).toContain('independence_unverified')
 for(const model of [null,'unknown-reviewer']){
  r.current.model=model
  const unknown=decide(r,synthetic.policy,synthetic.catalog)
  expect(unknown.outcome).toBe('unavailable');expect(unknown.reasons).toContain('independence_unverified')
 }
})
test('same-scope numeric and string effort pins conflict rather than merge',()=>{
 const s=base()
 s.pins=[4096,'4096'].map(value=>({field:'effort',value,scope:'session',purpose:'execution',source:'router-command',experimental:false}))
 const d=decide(s,synthetic.policy,synthetic.catalog)
 expect(d.outcome).toBe('clarify');expect(d.reasons).toEqual(['override_conflict'])
})
test('missing identity cannot bypass mandatory requirements or a hard budget',()=>{
 const s=base();s.current.model=null;s.classification={status:'timeout',output:null}
 s.requirements.mandatory=true
 expect(decide(s,synthetic.policy,synthetic.catalog).outcome).toBe('unavailable')
 s.requirements.mandatory=false;s.resources.hardBudget={accounting:'unavailable',permits:true}
 expect(decide(s,synthetic.policy,synthetic.catalog).outcome).toBe('unavailable')
})
const caseSnapshot=(id:string)=>structuredClone(fixture.cases.find((c:any)=>c.id===id)!.snapshot)
const cfg=(model:string,effort='medium')=>synthetic.catalog.configurations.find((c:any)=>c.modelId===model&&c.effort.value===effort)!

test('fallback authority is bound to lineage, revision, purpose, role and exact original pair',()=>{
 for(const change of [{lineageId:'another-lineage'},{policyRevision:'old-policy'},{purpose:'review'},{roles:['review']},{from:{modelId:'syn-haiku',effort:{kind:'level',value:'medium'}}}]){
  const s=caseSnapshot('authorized-opus-fallback');Object.assign(s.fallback,change)
  const d=decide(s,synthetic.policy,synthetic.catalog)
  expect(d.outcome).toBe('unavailable');expect(d.candidates.length).toBe(1);expect(d.fallback.authorized).toBe(false)
 }
 const s=caseSnapshot('authorized-opus-fallback');s.fallback.maxSubstitutions=2
 expect(decide(s,synthetic.policy,synthetic.catalog).reasons).toEqual(['configuration_invalid'])
})
test('checking a rejected alternative does not spend the one substitution allowance',()=>{
 const s=caseSnapshot('authorized-opus-fallback')
 s.fallback.alternatives.unshift(cfg('syn-haiku').id)
 const d=decide(s,synthetic.policy,synthetic.catalog)
 expect(d.outcome).toBe('select');expect(d.configuration?.model).toBe('syn-opus');expect(d.candidates.length).toBe(3)
 expect(d.candidates[1]!.failed.some(f=>f.reason==='workload_unapproved')).toBe(true)
 expect(s.fallback.used).toBe(0)
})
test('provider and family changes require separate fallback permissions',()=>{
 const s=caseSnapshot('authorized-opus-fallback');s.fallback.alternatives=[cfg('syn-astra').id]
 expect(decide(s,synthetic.policy,synthetic.catalog).outcome).toBe('unavailable')
 s.fallback.allowProviderChange=true
 expect(decide(s,synthetic.policy,synthetic.catalog).outcome).toBe('unavailable')
 s.fallback.allowFamilyChange=true
 const d=decide(s,synthetic.policy,synthetic.catalog)
 expect(d.outcome).toBe('select');expect(d.configuration?.model).toBe('syn-astra')
})
test('a failed explicit pin needs pin-specific authorization before fallback',()=>{
 const s=caseSnapshot('authorized-opus-fallback')
 s.pins=[{field:'model',value:'syn-sonnet',scope:'session',purpose:'execution',source:'router-command',experimental:false}]
 expect(decide(s,synthetic.policy,synthetic.catalog).outcome).toBe('unavailable')
 s.fallback.coversPins=true
 const d=decide(s,synthetic.policy,synthetic.catalog)
 expect(d.outcome).toBe('select');expect(d.configuration?.model).toBe('syn-opus');expect(d.fallback.substitution).toBe(true)
})
test('continuation and interruption requirements need demonstrated path support',()=>{
 for(const feature of ['continuation','interruptions']){
  const s=base();s.requirements[feature]=true
  expect(decide(s,synthetic.policy,synthetic.catalog).reasons).toContain('compatibility_unknown')
  const c=structuredClone(synthetic.catalog)
  for(const o of c.compatibility)if(o.configurationId===cfg('syn-sonnet').id)o[feature]=true
  expect(decide(s,synthetic.policy,c).outcome).toBe('select')
 }
})
test('conflicting compatibility records cannot be hidden by array ordering',()=>{
 const c=structuredClone(synthetic.catalog)
 const good=c.compatibility.find((o:any)=>o.configurationId===cfg('syn-sonnet').id)!
 c.compatibility.push({...good,id:'zz-conflicting',toolCalling:false})
 const d=decide(base(),synthetic.policy,c)
 expect(d.outcome).toBe('unavailable');expect(d.reasons).toContain('capability_missing')
})
test('unscoped or future evidence cannot establish compatibility or admission',()=>{
 for(const change of [{environmentId:null},{observedAt:'2026-11-30T00:00:00Z'},{source:'legacy-import'}]){
  const c=structuredClone(synthetic.catalog)
  Object.assign(c.evidence.find((e:any)=>e.id==='synthetic/evidence/eval'),change)
  const d=decide(base(),synthetic.policy,c)
  expect(d.outcome).toBe('unavailable');expect(d.reasons).toContain('compatibility_unknown');expect(d.reasons).toContain('workload_unapproved')
 }
})
test('trusted requested role lets a complete pin qualify when classification is unavailable',()=>{
 const s=base();s.assignment.requestedRole='implementation';s.classification={status:'timeout',output:null}
 s.pins=[{field:'model',value:'syn-sonnet',scope:'session',purpose:'execution',source:'router-command',experimental:false}]
 const d=decide(s,synthetic.policy,synthetic.catalog)
 expect(d.outcome).toBe('select');expect(d.configuration?.model).toBe('syn-sonnet');expect(d.reasons).toContain('pin_selected')
})
test('both fixed request pins remain unchanged even without separately scoped pin records',()=>{
 const s=base();s.current.modelOrigin='pin';s.current.effortOrigin='pin'
 const d=decide(s,synthetic.policy,synthetic.catalog)
 expect(d.outcome).toBe('preserve');expect(d.configuration?.model).toBe('syn-opus')
})
test('disjoint same-priority workload conditions do not conflict',()=>{
 const p=structuredClone(synthetic.policy)
 const broad=p.rules.find((r:any)=>r.id==='syn-broad')!,specified=p.rules.find((r:any)=>r.id==='syn-specified')!
 broad.priority=specified.priority;specified.when.executionSpan=['bounded','dependent-steps']
 expect(validatePolicy(p,synthetic.catalog)).toEqual([])
})
test('decisions retain controls, lineage, approvals and finite operating limits without aliasing inputs',()=>{
 const s=base(),c=structuredClone(synthetic.catalog),before=JSON.stringify([s,c])
 const d=decide(s,synthetic.policy,c)
 expect(d.controls).toEqual(s.controls);expect(d.lineageId).toBe(s.assignment.lineageId)
 expect(d.candidates[0]!.approvalId!==null).toBe(true)
 expect(d.candidates[0]!.limits!.maxGeneratedTokens).toBe(32000)
 if(d.configuration!.effort.kind==='level')d.configuration!.effort.value='changed'
 d.candidates[0]!.limits!.maxGeneratedTokens=1
 expect(JSON.stringify([s,c])).toBe(before)
})
test('preserving a request still requires atomic reservation for a hard budget',()=>{
 const s=caseSnapshot('classifier-timeout');s.resources.hardBudget={accounting:'reliable',permits:true}
 const d=decide(s,synthetic.policy,synthetic.catalog)
 expect(d.outcome).toBe('preserve');expect(d.reservation.required).toBe(true)
})
test('invalid snapshot roots return a diagnostic without attempting a fingerprint',()=>{
 for(const s of [undefined,null,[],42]){
  const d=decide(s as any,synthetic.policy,synthetic.catalog)
  expect(d.outcome).toBe('unavailable');expect(d.snapshotFingerprint).toBeNull()
 }
})
test('provider preference and stable configuration ID break primary ties deterministically',()=>{
 const p=structuredClone(synthetic.policy),s=base();s.current.model='syn-haiku'
 const rule=p.rules.find((r:any)=>r.id==='syn-specified')!
 rule.primary=[cfg('syn-astra').id,cfg('syn-sonnet').id,cfg('syn-opus').id];rule.preference=null
 const first=decide(s,p,synthetic.catalog)
 expect(first.configuration?.model).toBe('syn-opus')
 rule.primary.reverse()
 expect(decide(s,p,synthetic.catalog).configuration).toEqual(first.configuration)
 rule.preference=cfg('syn-astra').id
 expect(decide(s,p,synthetic.catalog).configuration?.model).toBe('syn-astra')
})
test('host-managed context remains outside routing even without workload approval',()=>{
 const s=base();s.current.model='syn-sonnet';s.current.effort='high';s.requirements.inputTokens=250000
 s.controls.changeModel=false;s.controls.changeEffort=false
 const d=decide(s,synthetic.policy,synthetic.catalog)
 expect(d.outcome).toBe('preserve');expect(d.reasons.includes('context_fit_unknown')).toBe(false)
})
test('pure v2 modules import no Node APIs and call no harness operations',()=>{
 for(const f of ['contract','classifier','policy','policy-data','pins']){
  const src=readFileSync(new URL(`../hooks/v2/${f}.ts`,import.meta.url),'utf8')
  expect(/from ['"]node:|require\(|\$\.|fetch\(|Date\.now|new Date\(\)/.test(src)).toBe(false)
 }
})
test('configured routing treats unknown inherited capabilities as unverified, not as known failures',()=>{
 const s=prodBase();s.current.model='gpt-6.1-sol';s.current.effort='high'
 const d=decide(s,POLICY,production.catalog)
 expect(d.outcome).toBe('preserve');expect(d.qualification).toBe('unverified')
 expect(d.reasons.includes('capability_missing')).toBe(false)
})

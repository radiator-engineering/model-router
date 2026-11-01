import {expect, test} from 'claude-code/testing'
import {rejects, throws} from 'node:assert/strict'
import {createCoordinator, restoreCoordinator, ReviewError} from '../hooks/v2/review.ts'
import type {AuthorizationRequest, CandidateSnapshot, CheckEvidence, Finding, LaunchIntent, ReviewAuthorization, ReviewCompletion, ReviewCoordinator, ReviewCoordinatorState, ReviewPorts, ReviewStage} from '../hooks/v2/review.ts'

const clone = <T>(value: T): T => structuredClone(value)
const tick = () => new Promise<void>(resolve => setImmediate(resolve))
const selection = (candidateId = 'cand_one') => ({candidateId,source:'user-command' as const,authorizationRef:'composer-action'})
const checkpoint = (stage: ReviewStage = 'full', candidateId = 'cand_one') => ({...selection(candidateId),stage})
const snapshot = (revision = 'r1', id = 'cand_one'): CandidateSnapshot => ({id,revision,baseRevision:'base',files:[{path:'a.ts',hash:revision},{path:'b.ts',hash:'unchanged'}],contextFiles:[{path:'rules.md',hash:'context'}],requirementIds:['R1'],checkIds:['offline'],contextDigest:'context-digest',checkConfigurationDigest:'check-config',policyDigest:'policy',reviewerConfigurationId:'review-config',requireReview:true})
const defect = (evidenceStatus: Finding['evidenceStatus'] = 'confirmed-defect'): Finding => ({id:'F1',requirementId:'R1',invariant:'I1',path:'a.ts',location:'line 3',consequence:'Duplicate dispatch can spend allowance twice',evidenceStatus,verificationStep:'Exercise overlapping checkpoints'})
function fixture(mode: 'off' | 'recommend' | 'automatic' = 'recommend') {
  let current = snapshot(), durable: unknown, coordinator: ReviewCoordinator
  const calls: LaunchIntent[] = [], writes: ReviewCoordinatorState[] = [], cancellations: unknown[] = [], authorizations: AuthorizationRequest[] = []
  const fake = {
    authorized:true, standing:true, checkStatus:'passed' as CheckEvidence['status'],
    current: () => current,
    edit: (s: CandidateSnapshot) => { current = clone(s) },
    saved: () => clone(durable),
    seed: (s: unknown) => { durable = clone(s) },
    authorization: (r: AuthorizationRequest): ReviewAuthorization => ({...r,origin:r.source === 'user-command' ? 'composer' : 'trusted-coordinator',standing:fake.standing,allowedTools:['Read','Bash'],modelAllowance:{maxCalls:4,maxTokens:1000,timeoutMs:10000}}),
  }
  const ports: ReviewPorts = {
    read:async () => clone(durable),
    persist:async s => { durable = clone(s); writes.push(clone(s)) },
    capture:async id => current.id === id ? clone(current) : null,
    authorize:async r => { authorizations.push(clone(r)); return fake.authorized ? fake.authorization(r) : null },
    runChecks:async s => s.checkIds.map(id => ({id,candidateId:s.id,revision:s.revision,configurationDigest:s.checkConfigurationDigest,status:fake.checkStatus,evidenceRef:'host-check-evidence'})),
    selectReviewer:async () => ({id:'registered-reviewer',configurationId:'review-config',qualified:true,independent:true,fresh:true,fork:false}),
    spawn:async i => { calls.push(clone(i)); return {jobId:`job-${calls.length}`} },
    cancel:async i => { cancellations.push(clone(i)) },
    assessRepair:async ({original,repaired,findings}) => ({originalRevision:original.revision,repairedRevision:repaired.revision,withinScope:true,findingIds:findings.filter(f => f.evidenceStatus !== 'preference').map(f => f.id),invariantIds:[...new Set(findings.filter(f => f.evidenceStatus !== 'preference').map(f => f.invariant))]}),
    observe:async () => ({status:'unknown'}),
  }
  coordinator = createCoordinator('conversation',ports,mode)
  const enroll = () => coordinator.enroll(selection())
  const launch = async (stage: ReviewStage = 'full') => { await coordinator.checkpoint(checkpoint(stage)); await tick(); return calls.at(-1)! }
  const event = (i = calls.at(-1)!, fs: Finding[] = []): ReviewCompletion => ({intentId:i.id,jobId:`job-${calls.indexOf(i)+1}`,revision:i.revision,status:'completed',findings:fs})
  const complete = async (fs: Finding[] = []) => { await coordinator.complete(event(calls.at(-1)!,fs)); await tick() }
  const reviewed = async () => { await enroll(); await launch(); await complete([defect()]) }
  const repaired = async () => { await reviewed(); await launch('repair'); fake.edit(snapshot('r2')); await complete() }
  return {fake,ports,coordinator,calls,writes,cancellations,authorizations,enroll,launch,event,complete,reviewed,repaired}
}
const candidate = (c: ReviewCoordinator) => c.state().candidates[0]

test('review requires explicit enrolled candidate and trusted enrollment; repeated registration preserves counters', async () => {
  const f = fixture()
  await rejects(f.coordinator.checkpoint(checkpoint()), /not enrolled/)
  await rejects(f.coordinator.enroll(selection('')), ReviewError)
  f.fake.authorized = false
  await rejects(f.enroll(), /Authorization unavailable/)
  f.fake.authorized = true
  await f.enroll(); await f.launch(); await f.complete()
  const before = candidate(f.coordinator)
  await f.enroll()
  expect(candidate(f.coordinator)).toEqual(before)
  expect(f.calls.length).toBe(1)
})

test('missing scope, missing requirements, noncanonical paths and absent capture fail without partial enrollment', async () => {
  for (const invalid of [{...snapshot(),files:[]},{...snapshot(),requirementIds:[]},{...snapshot(),files:[{path:'../escape',hash:'x'}]},{...snapshot(),files:[{path:'b.ts',hash:'b'},{path:'a.ts',hash:'a'}]}]) {
    const f = fixture(); f.fake.edit(invalid)
    await rejects(f.enroll(), ReviewError)
    expect(f.coordinator.state().candidates.length).toBe(0)
    expect(f.calls.length).toBe(0)
  }
  const f = fixture(); f.ports.capture = async () => null
  await rejects(f.enroll(), /enrollment unavailable/)
})

test('many author revisions and refreshes never launch; required acceptance waits for a checkpoint', async () => {
  const f = fixture('automatic'); await f.enroll()
  for (let n = 0; n < 12; n++) { f.fake.edit(snapshot(`r${n}`)); await f.coordinator.refresh('cand_one') }
  const result = await f.coordinator.accept(selection())
  expect(result.status).toBe('blocked')
  expect(result.attempts).toEqual({full:0,repair:0,targeted:0})
  expect(f.calls).toEqual([])
})

test('off and recommend never auto-launch; automatic additionally needs standing authorization and workflow checkpoint', async () => {
  for (const mode of ['off','recommend','automatic'] as const) {
    const f = fixture(mode); await f.enroll(); f.fake.standing = false
    await f.coordinator.checkpoint({...checkpoint(),source:'workflow-checkpoint'})
    expect(f.calls.length).toBe(0)
    if (mode !== 'automatic') {
      f.fake.standing = true
      await f.coordinator.checkpoint({...checkpoint(),source:'workflow-checkpoint'})
      expect(f.calls.length).toBe(0)
    }
  }
  const f = fixture('automatic'); await f.enroll()
  await f.coordinator.checkpoint({...checkpoint(),source:'workflow-checkpoint'}); await tick()
  expect(f.calls.length).toBe(1)
  const off = fixture('off'); await off.enroll(); await off.launch()
  expect(off.calls.length).toBe(1)
})

test('trusted authorization binds origin, candidate, stage, tools and finite model allowance', async () => {
  for (const change of [
    {candidateId:'other'},{stage:'repair'},{authorizationRef:'other'},{origin:'trusted-coordinator'},
    {allowedTools:['Read','Read']},{modelAllowance:{maxCalls:0,maxTokens:1,timeoutMs:1}},
    {modelAllowance:{maxCalls:1,maxTokens:Infinity,timeoutMs:1}},{modelAllowance:{maxCalls:1,maxTokens:1,timeoutMs:0}},
  ]) {
    const f = fixture(); await f.enroll()
    const original = f.fake.authorization
    f.fake.authorization = r => ({...original(r),...change}) as ReviewAuthorization
    await f.launch()
    expect(f.calls.length).toBe(0)
    expect(candidate(f.coordinator).status).toBe('blocked')
  }
})

test('required checks need complete exact trusted success; failures consume no model or repair allowance', async () => {
  for (const status of ['failed','denied','error','cancelled','timeout','unknown'] as const) {
    const f = fixture(); await f.enroll(); f.fake.checkStatus = status
    await f.launch()
    expect(f.calls.length).toBe(0)
    expect(candidate(f.coordinator).attempts).toEqual({full:0,repair:0,targeted:0})
  }
  for (const mutation of ['missing','duplicate','revision','configuration'] as const) {
    const f = fixture(); await f.enroll(); const normal = f.ports.runChecks
    f.ports.runChecks = async s => {
      const checks = await normal(s)
      if (mutation === 'missing') return []
      if (mutation === 'duplicate') return [...checks,...checks]
      return checks.map(c => ({...c,...(mutation === 'revision' ? {revision:'wrong'} : {configurationDigest:'wrong'})}))
    }
    await f.launch(); expect(f.calls.length).toBe(0)
  }
})

test('reviewer selection is its own qualified independent fresh nonfork review-purpose assignment', async () => {
  for (const change of [{qualified:false},{independent:false},{fresh:false},{fork:true},{configurationId:'execution-pin'}]) {
    const f = fixture(); await f.enroll(); const select = f.ports.selectReviewer
    f.ports.selectReviewer = async input => ({...(await select(input))!,...change})
    await f.launch(); expect(f.calls.length).toBe(0)
  }
  const f = fixture(); await f.enroll(); let purpose = ''
  const select = f.ports.selectReviewer
  f.ports.selectReviewer = async input => { purpose = `${input.purpose}/${input.reviewStage}`; return select(input) }
  await f.launch()
  expect(purpose).toBe('review/full')
  expect(f.calls[0].purpose).toBe('review')
  expect(f.calls[0].reviewStage).toBe('full')
})

test('serialized duplicate checkpoints persist one intent and counter before the only spawn', async () => {
  const f = fixture(); await f.enroll(); const spawn = f.ports.spawn
  f.ports.spawn = async i => {
    const persisted = f.fake.saved() as ReviewCoordinatorState
    expect(persisted.intents[0].id).toBe(i.id)
    expect(persisted.intents[0].status).toBe('intent')
    expect(persisted.candidates[0].attempts.full).toBe(1)
    return spawn(i)
  }
  await Promise.all(Array.from({length:10},() => f.coordinator.checkpoint(checkpoint())))
  await tick()
  expect(f.calls.length).toBe(1)
  expect(f.coordinator.state().intents.length).toBe(1)
  expect(candidate(f.coordinator).attempts.full).toBe(1)
})

test('early completion returns immediately, stays incomplete until spawn acknowledgement, then reconciles once', async () => {
  const f = fixture(); await f.enroll()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  f.ports.spawn = async i => {
    f.calls.push(clone(i))
    await f.coordinator.complete({intentId:i.id,jobId:'job-1',revision:i.revision,status:'completed',findings:[]})
    await gate
    return {jobId:'job-1'}
  }
  await f.coordinator.checkpoint(checkpoint()); await tick()
  expect(candidate(f.coordinator).status).toBe('reviewing')
  expect(f.coordinator.state().intents[0].pendingCompletion?.jobId).toBe('job-1')
  expect((await f.coordinator.accept(selection())).status).toBe('blocked')
  release(); await tick()
  expect(candidate(f.coordinator).status).toBe('ready')
  await f.coordinator.complete(f.event())
  expect(candidate(f.coordinator).attempts.full).toBe(1)
})

test('early job mismatch and unknown or wrong-revision completions cannot create accepted evidence', async () => {
  const f = fixture(); await f.enroll()
  f.ports.spawn = async i => {
    f.calls.push(clone(i))
    await f.coordinator.complete({intentId:i.id,jobId:'early-job',revision:i.revision,status:'completed',findings:[]})
    return {jobId:'different-job'}
  }
  await f.launch()
  expect(candidate(f.coordinator).status).toBe('blocked')
  expect(f.coordinator.state().intents[0].status).toBe('failed')
  const g = fixture(); await g.enroll(); await g.launch()
  for (const change of [{intentId:'unknown'},{revision:'wrong'},{jobId:'wrong'}]) await g.coordinator.complete({...g.event(),...change})
  expect(candidate(g.coordinator).status).toBe('reviewing')
})

test('zero findings is valid, acceptance is explicit, and duplicate terminal callbacks cannot change the result', async () => {
  const f = fixture(); await f.enroll(); await f.launch(); await f.complete()
  expect(candidate(f.coordinator).status).toBe('ready')
  await f.coordinator.complete({...f.event(),status:'error'})
  expect(candidate(f.coordinator).status).toBe('ready')
  const result = await f.coordinator.accept(selection())
  expect(result.status).toBe('accepted')
  expect(result.verifiedRevision).toBe('r1')
  expect(f.calls.length).toBe(1)
})

test('preferences are not material; confirmed defects, risks and ambiguity block; malformed findings never complete', async () => {
  for (const evidence of ['preference','confirmed-defect','plausible-risk','requirement-ambiguity'] as const) {
    const f = fixture(); await f.enroll(); await f.launch(); await f.complete([defect(evidence)])
    expect(candidate(f.coordinator).status).toBe(evidence === 'preference' ? 'ready' : 'blocked')
  }
  const f = fixture(); await f.enroll(); await f.launch()
  const invalid = defect(); delete (invalid as Partial<Finding>).verificationStep
  await f.complete([invalid])
  expect(candidate(f.coordinator).status).toBe('blocked')
  expect(candidate(f.coordinator).verifiedRevision).toBeNull()
})

test('missing reviewer, denied/error/cancelled/timeout lifecycle and spawn rejection never complete or auto-retry', async () => {
  for (const status of ['denied','error','cancelled','timeout'] as const) {
    const f = fixture(); await f.enroll(); await f.launch()
    await f.coordinator.complete({...f.event(),status})
    await f.launch()
    expect(f.calls.length).toBe(1)
    expect(candidate(f.coordinator).verifiedRevision).toBeNull()
    expect((await f.coordinator.accept(selection())).status).toBe('blocked')
  }
  const f = fixture(); await f.enroll(); f.ports.selectReviewer = async () => null
  await f.launch(); expect(f.calls.length).toBe(0)
  const g = fixture(); await g.enroll(); g.ports.spawn = async () => { throw Error('host unavailable') }
  await g.launch()
  expect(g.coordinator.state().intents[0].status).toBe('uncertain')
  expect(candidate(g.coordinator).attempts.full).toBe(1)
})

test('edits during review cancel and stale late completion; new revisions do not reset broad-review allowance', async () => {
  const f = fixture(); await f.enroll(); await f.launch()
  f.fake.edit(snapshot('r2')); await f.coordinator.refresh('cand_one')
  await f.complete()
  expect(candidate(f.coordinator).status).toBe('stale')
  expect(candidate(f.coordinator).verifiedRevision).toBeNull()
  expect(f.cancellations.length).toBe(1)
  await f.launch()
  expect(f.calls.length).toBe(1)
  expect(candidate(f.coordinator).attempts.full).toBe(1)
})

test('changes during executed checks or reviewer qualification invalidate the frozen revision without dispatch', async () => {
  for (const phase of ['checks','selection'] as const) {
    const f = fixture(); await f.enroll()
    if (phase === 'checks') {
      const run = f.ports.runChecks
      f.ports.runChecks = async s => { const evidence = await run(s); f.fake.edit(snapshot('r2')); return evidence }
    } else {
      const select = f.ports.selectReviewer
      f.ports.selectReviewer = async input => { f.fake.edit(snapshot('r2')); return select(input) }
    }
    await f.launch()
    expect(f.calls.length).toBe(0)
    expect(candidate(f.coordinator).status).toBe('stale')
    expect(candidate(f.coordinator).checks).toEqual([])
  }
})

test('reload leaves uncertain launch incomplete; ordinary late callbacks cannot resolve it; observable recovery can', async () => {
  const f = fixture(); await f.enroll(); await f.launch()
  const reloaded = await restoreCoordinator('conversation',f.ports,'automatic')
  expect(reloaded.state().mode).toBe('automatic')
  expect(reloaded.state().intents[0].status).toBe('uncertain')
  await reloaded.complete(f.event())
  await reloaded.checkpoint(checkpoint())
  await reloaded.reconcile(f.calls[0].id)
  expect(candidate(reloaded).verifiedRevision).toBeNull()
  expect(f.calls.length).toBe(1)
  f.ports.observe = async () => ({status:'running',jobId:'job-1'})
  await reloaded.reconcile(f.calls[0].id)
  await reloaded.complete(f.event())
  expect(candidate(reloaded).status).toBe('ready')
  expect(candidate(reloaded).attempts.full).toBe(1)
})

test('durable pre-spawn intent survives reload and terminal reconciliation never spawns a replacement', async () => {
  const f = fixture(); await f.enroll(); await f.launch()
  const saved = f.fake.saved() as ReviewCoordinatorState
  saved.intents[0].status = 'intent'; saved.intents[0].jobId = null
  saved.intents[0].pendingCompletion = f.event()
  f.fake.seed(saved)
  const reloaded = await restoreCoordinator('conversation',f.ports)
  f.ports.observe = async () => ({status:'terminal',completion:{...f.event(),jobId:'wrong-recovery-job'}})
  await reloaded.reconcile(saved.intents[0].id)
  expect(candidate(reloaded).verifiedRevision).toBeNull()
  f.ports.observe = async () => ({status:'terminal',completion:f.event()})
  await reloaded.reconcile(saved.intents[0].id)
  expect(candidate(reloaded).status).toBe('ready')
  await reloaded.checkpoint(checkpoint())
  expect(f.calls.length).toBe(1)
})

test('repair and targeted verification need separate explicit authorization; checks alone cannot renew repaired review', async () => {
  const f = fixture(); await f.reviewed()
  f.fake.authorized = false
  await f.launch('repair')
  expect(f.calls.length).toBe(1)
  f.fake.authorized = true
  await f.launch('repair'); f.fake.edit(snapshot('r2')); await f.complete()
  expect(candidate(f.coordinator).verifiedRevision).toBeNull()
  expect((await f.coordinator.accept(selection())).status).toBe('blocked')
  f.fake.authorized = false
  await f.launch('targeted')
  expect(f.calls.length).toBe(2)
  expect(candidate(f.coordinator).attempts).toEqual({full:1,repair:1,targeted:0})
})

test('bounded authorized repair plus independent targeted closure renews only the exact repaired revision', async () => {
  const f = fixture(); await f.repaired()
  await f.launch('targeted')
  const target = f.calls[2]
  expect(target.purpose).toBe('review')
  expect(target.reviewStage).toBe('targeted')
  expect(target.originalSnapshot).toEqual(snapshot())
  expect(target.snapshot).toEqual(snapshot('r2'))
  expect(target.findings).toEqual([defect()])
  expect(target.checks[0].revision).toBe('r2')
  await f.coordinator.complete({...f.event(target),closure:{closedFindingIds:['F1'],noNewMaterialIssues:true,scopeConfirmed:true,outcome:'closed'}})
  expect(candidate(f.coordinator).status).toBe('ready')
  expect(candidate(f.coordinator).reviewedRevision).toBe('r1')
  expect(candidate(f.coordinator).verifiedRevision).toBe('r2')
  expect((await f.coordinator.accept(selection())).status).toBe('accepted')
  for (const stage of ['full','repair','targeted'] as const) await f.launch(stage)
  expect(f.calls.length).toBe(3)
  const reloaded = await restoreCoordinator('conversation',f.ports)
  expect(candidate(reloaded).attempts).toEqual({full:1,repair:1,targeted:1})
})

test('broader repairs, unrelated context/configuration changes and untrusted invariant scope block targeted dispatch', async () => {
  for (const change of ['artifact','context','policy','checks','reviewer','scope','invariant','finding'] as const) {
    const f = fixture(); await f.reviewed(); await f.launch('repair')
    const next = snapshot('r2')
    if (change === 'artifact') next.files[1].hash = 'broader-edit'
    if (change === 'context') next.contextFiles[0].hash = 'new-context'
    if (change === 'policy') next.policyDigest = 'new-policy'
    if (change === 'checks') next.checkConfigurationDigest = 'new-checks'
    if (change === 'reviewer') next.reviewerConfigurationId = 'new-reviewer-config'
    f.fake.edit(next); await f.complete()
    const assess = f.ports.assessRepair
    if (['scope','invariant','finding'].includes(change)) f.ports.assessRepair = async input => ({...(await assess(input)),...(change === 'scope' ? {withinScope:false} : change === 'invariant' ? {invariantIds:['other']} : {findingIds:[]})})
    await f.launch('targeted')
    expect(f.calls.length).toBe(2)
    expect(candidate(f.coordinator).status).toBe('blocked')
  }
})

test('targeted closure must close all original material findings without unknown verification or new material issues', async () => {
  for (const change of ['open','new','unknown','scope','findings'] as const) {
    const f = fixture(); await f.repaired(); await f.launch('targeted')
    const closure: NonNullable<ReviewCompletion['closure']> = {closedFindingIds:['F1'],noNewMaterialIssues:true,scopeConfirmed:true,outcome:'closed'}
    if (change === 'open') closure.closedFindingIds = []
    if (change === 'new') closure.noNewMaterialIssues = false
    if (change === 'unknown') closure.outcome = 'inconclusive'
    if (change === 'scope') closure.scopeConfirmed = false
    await f.coordinator.complete({...f.event(),findings:change === 'findings' ? [{...defect(),id:'F2'}] : [],closure})
    expect(candidate(f.coordinator).verifiedRevision).toBeNull()
    expect((await f.coordinator.accept(selection())).status).toBe('blocked')
    await f.launch('targeted')
    expect(f.calls.length).toBe(3)
  }
})

test('acceptance recomputes current artifact/configuration and fresh required checks instead of trusting old ready state', async () => {
  for (const change of ['artifact','configuration','check-failure'] as const) {
    const f = fixture(); await f.enroll(); await f.launch(); await f.complete()
    if (change === 'artifact') f.fake.edit(snapshot('r2'))
    if (change === 'configuration') f.fake.edit({...snapshot(),revision:'new-config-digest',policyDigest:'new-policy'})
    if (change === 'check-failure') f.fake.checkStatus = 'denied'
    const accepted = await f.coordinator.accept(selection())
    expect(accepted.status === 'accepted').toBe(false)
    expect(f.calls.length).toBe(1)
  }
  const f = fixture(); f.fake.edit({...snapshot(),checkIds:[],requireReview:false}); await f.enroll()
  const accepted = await f.coordinator.accept(selection())
  expect(accepted.status).toBe('accepted')
  expect(accepted.reason).toContain('no-executable-checks-required')
})

test('durability failure prevents spawn and further launches; malformed reload never silently resets candidate counters', async () => {
  const f = fixture(); await f.enroll()
  f.ports.persist = async () => { throw Error('disk unavailable') }
  await rejects(f.coordinator.checkpoint(checkpoint()), /persistence unavailable/)
  await rejects(f.coordinator.checkpoint(checkpoint()), /persistence unavailable/)
  expect(f.calls.length).toBe(0)
  const g = fixture(); await g.enroll(); await g.launch()
  const saved = g.fake.saved() as ReviewCoordinatorState
  for (const invalid of [null,{}, {...saved,conversationId:'other'}, {...saved,schemaVersion:2}, {...saved,candidates:[{...saved.candidates[0],attempts:{full:0,repair:0,targeted:0}}]}, {...saved,intents:[saved.intents[0],saved.intents[0]]}]) {
    g.fake.seed(invalid)
    await rejects(restoreCoordinator('conversation',g.ports), ReviewError)
  }
  throws(() => createCoordinator('',g.ports), ReviewError)
})

test('trusted enrollment needs no new model budget; reload applies current off mode without resetting attempts', async () => {
  const f = fixture('recommend'), normal = f.fake.authorization
  f.fake.authorization = r => ({...normal(r),modelAllowance:{maxCalls:0,maxTokens:0,timeoutMs:0}})
  await f.coordinator.enroll({...selection(),source:'workflow-checkpoint'})
  await f.launch()
  expect(f.calls.length).toBe(0)
  f.fake.authorization = normal
  await f.launch(); await f.complete()
  const reloaded = await restoreCoordinator('conversation',f.ports,'off')
  expect(reloaded.state().mode).toBe('off')
  await reloaded.checkpoint({...checkpoint(),source:'workflow-checkpoint'})
  expect(candidate(reloaded).attempts.full).toBe(1)
  expect(f.calls.length).toBe(1)
})

test('returned and port snapshots are isolated JSON data with no raw artifact or persuasive author fields', async () => {
  const f = fixture(); await f.enroll(); await f.launch()
  const returned = f.coordinator.state(); returned.candidates[0].attempts.full = 0
  returned.intents[0].snapshot.files[0].hash = 'external'
  expect(candidate(f.coordinator).attempts.full).toBe(1)
  expect(f.coordinator.state().intents[0].snapshot.files[0].hash).toBe('r1')
  expect(JSON.parse(JSON.stringify(f.coordinator.state()))).toEqual(f.coordinator.state())
  const g = fixture(); g.fake.edit({...snapshot(),authorRationale:'Trust my self-assessment'} as CandidateSnapshot)
  await rejects(g.enroll(), /Invalid coordinator data/)
  expect(g.coordinator.state().candidates.length).toBe(0)
})

// Copyright (c) Radiator Inc. All rights reserved.
// Host ports own provenance, canonical hashing, governed tools and fresh nonfork assignments.
export type ReviewStage = 'full' | 'repair' | 'targeted'
export type ReviewSource = 'user-command' | 'workflow-checkpoint'
export type ReviewMode = 'off' | 'recommend' | 'automatic'
export type CandidateSnapshot = {
  id: string; revision: string; baseRevision: string
  files: {path: string; hash: string | null}[]
  contextFiles: {path: string; hash: string}[]
  requirementIds: string[]; checkIds: string[]
  contextDigest: string; checkConfigurationDigest: string
  policyDigest: string; reviewerConfigurationId: string; requireReview: boolean
}
export type Finding = {
  id: string; requirementId: string; invariant: string; path: string; location: string
  consequence: string; evidenceStatus: 'confirmed-defect' | 'plausible-risk' | 'requirement-ambiguity' | 'preference'
  verificationStep: string
}
export type CheckEvidence = {
  id: string; candidateId: string; revision: string; configurationDigest: string
  status: 'passed' | 'failed' | 'denied' | 'error' | 'cancelled' | 'timeout' | 'unknown'
  evidenceRef: string
}
export type AuthorizationRequest = {
  candidateId: string; stage: ReviewStage | 'enroll' | 'accept'
  source: ReviewSource; authorizationRef: string
}
export type ReviewAuthorization = AuthorizationRequest & {
  origin: 'composer' | 'trusted-coordinator'; standing: boolean; allowedTools: string[]
  modelAllowance: {maxCalls: number; maxTokens: number; timeoutMs: number}
}
export type Reviewer = {
  id: string; configurationId: string; qualified: boolean; independent: boolean; fresh: boolean; fork: boolean
}
export type ReviewCheckpoint = AuthorizationRequest & {stage: ReviewStage}
export type RepairScope = {
  originalRevision: string; repairedRevision: string; withinScope: boolean
  findingIds: string[]; invariantIds: string[]
}
export type ReviewCompletion = {
  intentId: string; jobId: string; revision: string
  status: 'completed' | 'denied' | 'error' | 'cancelled' | 'timeout'
  findings?: Finding[]
  closure?: {closedFindingIds: string[]; noNewMaterialIssues: boolean; scopeConfirmed: boolean; outcome: 'closed' | 'inconclusive'}
}
export type LaunchIntent = {
  id: string; candidateId: string; revision: string; stage: ReviewStage
  purpose: 'execution' | 'review'; reviewStage: 'full' | 'targeted' | null
  status: 'intent' | 'running' | 'uncertain' | 'completed' | 'failed' | 'stale'
  jobId: string | null; pendingCompletion: ReviewCompletion | null
  snapshot: CandidateSnapshot; originalSnapshot: CandidateSnapshot | null
  authorization: ReviewAuthorization; reviewer: Reviewer | null
  checks: CheckEvidence[]; findings: Finding[]; repairScope: RepairScope | null
}
export type CandidateReviewState = {
  enrollment: CandidateSnapshot; current: CandidateSnapshot
  status: 'awaiting-checkpoint' | 'reviewing' | 'repairing' | 'blocked' | 'stale' | 'ready' | 'accepted'
  reason: string; attempts: Record<ReviewStage, number>; checks: CheckEvidence[]
  findings: Finding[]; reviewedRevision: string | null; verifiedRevision: string | null
  repairedRevision: string | null
}
export type ReviewCoordinatorState = {
  schemaVersion: 1; conversationId: string; mode: ReviewMode
  candidates: CandidateReviewState[]; intents: LaunchIntent[]
}
export type ReviewPorts = {
  read(): Promise<unknown>
  /** Atomic durable write; reject if durability cannot be established. */
  persist(state: ReviewCoordinatorState): Promise<void>
  /** Validated enrolled scope, canonical SHA-256 including all current configuration. No artifact bytes. */
  capture(candidateId: string): Promise<CandidateSnapshot | null>
  /** Verify actual origin and resolve authority, never trust caller-provided reference strings alone. */
  authorize(request: AuthorizationRequest): Promise<ReviewAuthorization | null>
  runChecks(snapshot: CandidateSnapshot): Promise<CheckEvidence[]>
  /** Use the same pure selection policy with review purpose; execution pins never participate. */
  selectReviewer(input: {purpose: 'review'; reviewStage: 'full' | 'targeted'; snapshot: CandidateSnapshot; authorization: ReviewAuthorization}): Promise<Reviewer | null>
  /** Host must enforce tools, allowance, timeout and candidate/intent correlation. Never await terminal callbacks here. */
  spawn(intent: LaunchIntent): Promise<{jobId: string}>
  cancel(input: {intentId: string; jobId: string | null}): Promise<void>
  /** Trusted diff/invariant assessment; model assertions are not scope authority. */
  assessRepair(input: {original: CandidateSnapshot; repaired: CandidateSnapshot; findings: Finding[]}): Promise<RepairScope>
  /** Observable host reconciliation, not a new launch. Unknown remains incomplete. */
  observe(intent: LaunchIntent): Promise<{status: 'unknown'} | {status: 'running'; jobId: string} | {status: 'terminal'; completion: ReviewCompletion}>
}

export class ReviewError extends Error {
  code: 'clarify' | 'unavailable'
  constructor(code: 'clarify' | 'unavailable', message: string) { super(message); this.code = code }
}
const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T
const equal = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)
const text = (v: unknown): v is string => typeof v === 'string' && v.trim().length > 0
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(text) && new Set(v).size === v.length
const positive = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) > 0
function fail(message: string): never { throw new ReviewError('unavailable', message) }
function object(v: unknown, keys: string[]): asserts v is Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k))) fail('Invalid coordinator data')
}
function snapshot(v: unknown): asserts v is CandidateSnapshot {
  object(v, ['id','revision','baseRevision','files','contextFiles','requirementIds','checkIds','contextDigest','checkConfigurationDigest','policyDigest','reviewerConfigurationId','requireReview'])
  if (v.requirementIds === undefined || (Array.isArray(v.requirementIds) && !v.requirementIds.length) || v.files === undefined || (Array.isArray(v.files) && !v.files.length)) throw new ReviewError('clarify','Explicit candidate scope and requirements required')
  if (!['id','revision','baseRevision','contextDigest','checkConfigurationDigest','policyDigest','reviewerConfigurationId'].every(k => text(v[k])) || typeof v.requireReview !== 'boolean' || !strings(v.requirementIds) || !v.requirementIds.length || !strings(v.checkIds)) fail('Invalid candidate requirements or configuration')
  for (const key of ['files','contextFiles']) {
    const files = v[key]
    if (!Array.isArray(files) || (key === 'files' && !files.length)) fail('Invalid candidate scope')
    const paths: string[] = []
    for (const file of files) {
      object(file, ['path','hash'])
      if (!text(file.path) || file.path.startsWith('/') || file.path.includes('\\') || file.path.split('/').some(p => !p || p === '.' || p === '..') || !(text(file.hash) || (key === 'files' && file.hash === null))) fail('Invalid candidate path or hash')
      paths.push(file.path)
    }
    if (new Set(paths).size !== paths.length || !equal(paths, [...paths].sort())) fail('Candidate paths must be canonical')
  }
}
function findings(v: unknown, s: CandidateSnapshot): asserts v is Finding[] {
  if (!Array.isArray(v)) fail('Missing structured findings')
  const ids: string[] = []
  for (const f of v) {
    object(f, ['id','requirementId','invariant','path','location','consequence','evidenceStatus','verificationStep'])
    if (!['id','requirementId','invariant','path','location','consequence','verificationStep'].every(k => text(f[k])) || !['confirmed-defect','plausible-risk','requirement-ambiguity','preference'].includes(f.evidenceStatus as string) || !s.requirementIds.includes(f.requirementId as string) || !s.files.some(file => file.path === f.path)) fail('Invalid structured finding')
    ids.push(f.id as string)
  }
  if (new Set(ids).size !== ids.length) fail('Duplicate finding IDs')
}
const material = (fs: Finding[]) => fs.filter(f => f.evidenceStatus !== 'preference')
function authorization(a: unknown, request: AuthorizationRequest): asserts a is ReviewAuthorization {
  object(a, ['candidateId','stage','source','authorizationRef','origin','standing','allowedTools','modelAllowance'])
  for (const k of ['candidateId','stage','source','authorizationRef'] as const) if (a[k] !== request[k]) fail('Authorization scope mismatch')
  if (!text(request.candidateId) || !text(request.authorizationRef) || !['enroll','accept','full','repair','targeted'].includes(request.stage) || !['user-command','workflow-checkpoint'].includes(request.source) || !strings(a.allowedTools) || typeof a.standing !== 'boolean' || a.origin !== (request.source === 'user-command' ? 'composer' : 'trusted-coordinator')) fail('Untrusted authorization')
  object(a.modelAllowance, ['maxCalls','maxTokens','timeoutMs'])
  const allowance = [a.modelAllowance.maxCalls,a.modelAllowance.maxTokens,a.modelAllowance.timeoutMs]
  const modelStage = request.stage !== 'enroll' && request.stage !== 'accept'
  if (!allowance.every(v => modelStage ? positive(v) : Number.isSafeInteger(v) && (v as number) >= 0)) fail('Finite model allowance required')
}
function checkEvidence(v: unknown): asserts v is CheckEvidence[] {
  if (!Array.isArray(v)) fail('Invalid check evidence')
  for (const c of v) {
    object(c, ['id','candidateId','revision','configurationDigest','status','evidenceRef'])
    if (!['id','candidateId','revision','configurationDigest','evidenceRef'].every(k => text(c[k])) || !['passed','failed','denied','error','cancelled','timeout','unknown'].includes(c.status as string)) fail('Invalid check evidence')
  }
}
const passed = (s: CandidateSnapshot, checks: CheckEvidence[]): boolean => s.checkIds.every(id => {
  const matches = checks.filter(c => c.id === id)
  return matches.length === 1 && matches[0]!.status === 'passed' && matches[0]!.candidateId === s.id && matches[0]!.revision === s.revision && matches[0]!.configurationDigest === s.checkConfigurationDigest
})
const sameEnrollment = (a: CandidateSnapshot, b: CandidateSnapshot): boolean => a.id === b.id && a.baseRevision === b.baseRevision && equal(a.files.map(f => f.path), b.files.map(f => f.path)) && equal(a.contextFiles.map(f => f.path), b.contextFiles.map(f => f.path)) && equal(a.requirementIds, b.requirementIds) && (!a.requireReview || b.requireReview)
const sameContext = (a: CandidateSnapshot, b: CandidateSnapshot): boolean => sameEnrollment(a, b) && equal(a.contextFiles,b.contextFiles) && a.contextDigest === b.contextDigest && a.checkConfigurationDigest === b.checkConfigurationDigest && a.policyDigest === b.policyDigest && a.reviewerConfigurationId === b.reviewerConfigurationId && equal(a.checkIds,b.checkIds)
function qualified(v: unknown): asserts v is Reviewer {
  object(v, ['id','configurationId','qualified','independent','fresh','fork'])
  if (!text(v.id) || !text(v.configurationId) || v.qualified !== true || v.independent !== true || v.fresh !== true || v.fork !== false) fail('Qualified independent fresh nonfork reviewer unavailable')
}
function repairScope(v: unknown): asserts v is RepairScope {
  object(v, ['originalRevision','repairedRevision','withinScope','findingIds','invariantIds'])
  if (!text(v.originalRevision) || !text(v.repairedRevision) || typeof v.withinScope !== 'boolean' || !strings(v.findingIds) || !strings(v.invariantIds)) fail('Invalid repair scope evidence')
}
function completion(v: unknown): asserts v is ReviewCompletion {
  object(v, ['intentId','jobId','revision','status','findings','closure'])
  if (![v.intentId,v.jobId,v.revision].every(text) || !['completed','denied','error','cancelled','timeout'].includes(v.status as string)) fail('Invalid lifecycle event')
  if (v.closure !== undefined) {
    object(v.closure, ['closedFindingIds','noNewMaterialIssues','scopeConfirmed','outcome'])
    if (!strings(v.closure.closedFindingIds) || typeof v.closure.noNewMaterialIssues !== 'boolean' || typeof v.closure.scopeConfirmed !== 'boolean' || !['closed','inconclusive'].includes(v.closure.outcome as string)) fail('Invalid targeted closure')
  }
}
function validateState(v: unknown, conversationId: string): asserts v is ReviewCoordinatorState {
  object(v, ['schemaVersion','conversationId','mode','candidates','intents'])
  if (v.schemaVersion !== 1 || v.conversationId !== conversationId || !['off','recommend','automatic'].includes(v.mode as string) || !Array.isArray(v.candidates) || !Array.isArray(v.intents)) fail('Invalid coordinator state or conversation identity')
  const ids: string[] = []
  for (const c of v.candidates) {
    object(c, ['enrollment','current','status','reason','attempts','checks','findings','reviewedRevision','verifiedRevision','repairedRevision'])
    snapshot(c.enrollment); snapshot(c.current)
    if (!sameEnrollment(c.enrollment,c.current) || !['awaiting-checkpoint','reviewing','repairing','blocked','stale','ready','accepted'].includes(c.status as string) || !text(c.reason)) fail('Invalid candidate state')
    const attempts = c.attempts
    object(attempts, ['full','repair','targeted'])
    if (!['full','repair','targeted'].every(k => attempts[k] === 0 || attempts[k] === 1)) fail('Invalid attempt counters')
    if (![c.reviewedRevision,c.verifiedRevision,c.repairedRevision].every(r => r === null || text(r))) fail('Invalid revision evidence')
    findings(c.findings,c.enrollment); checkEvidence(c.checks); ids.push(c.enrollment.id)
  }
  if (new Set(ids).size !== ids.length) fail('Duplicate candidates')
  const keys: string[] = []
  for (const i of v.intents) {
    object(i, ['id','candidateId','revision','stage','purpose','reviewStage','status','jobId','pendingCompletion','snapshot','originalSnapshot','authorization','reviewer','checks','findings','repairScope'])
    if (!text(i.id) || !ids.includes(i.candidateId as string) || !['full','repair','targeted'].includes(i.stage as string) || !['intent','running','uncertain','completed','failed','stale'].includes(i.status as string) || !(i.jobId === null || text(i.jobId))) fail('Invalid launch intent')
    snapshot(i.snapshot)
    if (i.candidateId !== i.snapshot.id || i.revision !== i.snapshot.revision || i.purpose !== (i.stage === 'repair' ? 'execution' : 'review') || i.reviewStage !== (i.stage === 'repair' ? null : i.stage)) fail('Invalid assignment purpose or revision')
    const a = i.authorization as ReviewAuthorization
    authorization(a, {candidateId:i.candidateId as string,stage:i.stage as ReviewStage,source:a?.source,authorizationRef:a?.authorizationRef})
    if (i.originalSnapshot !== null) snapshot(i.originalSnapshot)
    if (i.stage !== 'repair') qualified(i.reviewer)
    else if (i.reviewer !== null) fail('Invalid repair reviewer')
    checkEvidence(i.checks); findings(i.findings,i.originalSnapshot ?? i.snapshot)
    if (i.pendingCompletion !== null) {
      completion(i.pendingCompletion)
      if (i.pendingCompletion.intentId !== i.id || i.pendingCompletion.revision !== i.revision) fail('Invalid buffered completion correlation')
      if (i.pendingCompletion.findings !== undefined) findings(i.pendingCompletion.findings,i.snapshot)
    }
    if (i.repairScope !== null) repairScope(i.repairScope)
    keys.push(i.id)
  }
  if (new Set(keys).size !== keys.length) fail('Duplicate launch intents')
  for (const c of v.candidates as CandidateReviewState[]) for (const stage of ['full','repair','targeted'] as const) {
    const intents = (v.intents as LaunchIntent[]).filter(i => i.candidateId === c.enrollment.id && i.stage === stage)
    if (intents.length !== c.attempts[stage]) fail('Attempt counters do not match durable intents')
  }
}

function coordinator(conversationId: string, ports: ReviewPorts, mode: ReviewMode, restored?: ReviewCoordinatorState) {
  if (!text(conversationId) || !['off','recommend','automatic'].includes(mode)) fail('Invalid conversation or review mode')
  if (restored) validateState(restored,conversationId)
  const state: ReviewCoordinatorState = copy(restored ?? {schemaVersion:1,conversationId,mode,candidates:[],intents:[]})
  state.mode = mode
  // ponytail: one in-memory queue per conversation; host must keep a single coordinator owner.
  let tail: Promise<unknown> = Promise.resolve(), storageFailed = false
  const serial = <T>(action: () => Promise<T>): Promise<T> => {
    const result = tail.then(() => { if (storageFailed) fail('Coordinator persistence unavailable'); return action() })
    tail = result.catch(() => {})
    return result
  }
  const save = async () => {
    try { await ports.persist(copy(state)) } catch { storageFailed = true; fail('Coordinator persistence unavailable') }
  }
  const candidate = (id: string): CandidateReviewState => {
    if (!text(id)) throw new ReviewError('clarify','Explicit candidate ID required')
    const c = state.candidates.find(c => c.enrollment.id === id)
    if (!c) throw new ReviewError('clarify','Candidate is not enrolled')
    return c
  }
  const block = (c: CandidateReviewState, reason: string) => { c.status = 'blocked'; c.reason = reason }
  const active = (i: LaunchIntent) => ['intent','running','uncertain'].includes(i.status)
  const capture = async (c: CandidateReviewState) => {
    const s = await ports.capture(c.enrollment.id)
    if (!s) throw new ReviewError('clarify','Candidate enrollment unavailable')
    snapshot(s)
    if (!sameEnrollment(c.enrollment,s)) fail('Candidate scope or requirements changed; explicit enrollment required')
    return copy(s)
  }
  const authorize = async (request: AuthorizationRequest) => {
    const a = await ports.authorize(copy(request))
    if (!a) fail('Authorization unavailable')
    authorization(a,request)
    if (request.source === 'workflow-checkpoint' && request.stage !== 'enroll' && request.stage !== 'accept' && (state.mode !== 'automatic' || !a.standing)) fail('Automatic checkpoint requires automatic mode and standing authorization')
    return copy(a)
  }
  const invalidate = async (c: CandidateReviewState, s: CandidateSnapshot) => {
    c.current = s; c.checks = []; c.verifiedRevision = null; c.status = 'stale'; c.reason = 'revision-changed'
    for (const i of state.intents.filter(i => i.candidateId === s.id && active(i))) {
      i.status = 'stale'
      await save()
      try { await ports.cancel({intentId:i.id,jobId:i.jobId}) } catch { /* Stale evidence remains unusable even if cancellation fails. */ }
    }
  }
  const current = async (c: CandidateReviewState, expected: CandidateSnapshot) => {
    const s = await capture(c)
    if (equal(s,expected)) return true
    await invalidate(c,s); return false
  }
  const checks = async (c: CandidateReviewState, s: CandidateSnapshot) => {
    let evidence: CheckEvidence[]
    try { evidence = await ports.runChecks(copy(s)); checkEvidence(evidence) }
    catch { block(c,'checks-unavailable'); c.checks = []; return false }
    if (!await current(c,s)) return false
    c.checks = copy(evidence)
    if (!passed(s,evidence)) { block(c,'checks-incomplete'); return false }
    return true
  }
  const original = (c: CandidateReviewState) => state.intents.find(i => i.candidateId === c.enrollment.id && i.stage === 'full' && i.status === 'completed')
  const ready = (c: CandidateReviewState) => {
    const needsReview = c.enrollment.requireReview || c.current.requireReview || c.attempts.full > 0
    if (passed(c.current,c.checks) && (!needsReview || c.verifiedRevision === c.current.revision)) {
      c.status = 'ready'; c.reason = c.current.checkIds.length ? 'current-evidence-complete' : 'no-executable-checks-required'
      return true
    }
    block(c,'required-evidence-incomplete'); return false
  }
  const finish = async (event: ReviewCompletion, reconciled = false) => {
    completion(event)
    const i = state.intents.find(i => i.id === event.intentId)
    if (!i || !active(i) || (i.status === 'uncertain' && !reconciled) || (i.jobId !== null && i.jobId !== event.jobId) || (i.pendingCompletion !== null && i.pendingCompletion.jobId !== event.jobId) || event.revision !== i.revision) return
    if (reconciled && i.pendingCompletion !== null) event = copy(i.pendingCompletion)
    const c = candidate(i.candidateId)
    if (i.status === 'intent' && i.jobId === null && !reconciled) {
      if (event.findings !== undefined) findings(event.findings,i.snapshot)
      if (i.pendingCompletion === null) { i.pendingCompletion = copy(event); await save() }
      return
    }
    i.pendingCompletion = null
    i.jobId = event.jobId
    if (event.status !== 'completed') {
      i.status = 'failed'; block(c,`assignment-${event.status}`); await save(); return
    }
    try {
      if (i.stage === 'repair') {
        const s = await capture(c)
        i.status = 'completed'; c.current = s; c.checks = []; c.verifiedRevision = null
        c.repairedRevision = s.revision; block(c,'targeted-verification-required')
      } else {
        if (!await current(c,i.snapshot)) { i.status = 'stale'; await save(); return }
        findings(event.findings,i.snapshot)
        if (i.stage === 'full') {
          c.findings = copy(event.findings); c.reviewedRevision = i.revision
          c.verifiedRevision = material(c.findings).length ? null : i.revision
          i.status = 'completed'
          if (material(c.findings).length) block(c,'material-findings')
          else ready(c)
        } else {
          const closure = event.closure, wanted = material(c.findings).map(f => f.id).sort()
          i.status = 'completed'
          if (!closure || closure.outcome !== 'closed' || !closure.noNewMaterialIssues || !closure.scopeConfirmed || !equal([...closure.closedFindingIds].sort(),wanted) || material(event.findings).length || !i.repairScope?.withinScope) block(c,'targeted-closure-incomplete')
          else { c.verifiedRevision = i.revision; ready(c) }
        }
      }
    } catch {
      i.status = 'failed'; block(c,'completion-unavailable')
    }
    await save()
  }
  const dispatch = (intent: LaunchIntent) => {
    // Do not hold the queue or await the job: completion may arrive before spawn resolves.
    void Promise.resolve().then(() => ports.spawn(copy(intent))).then(result => serial(async () => {
      const i = state.intents.find(i => i.id === intent.id)!
      if (!text(result.jobId)) fail('Invalid host job identity')
      if ((i.jobId !== null && i.jobId !== result.jobId) || (i.pendingCompletion !== null && i.pendingCompletion.jobId !== result.jobId)) {
        i.status = 'failed'; block(candidate(i.candidateId),'job-correlation-mismatch')
        candidate(i.candidateId).verifiedRevision = null
      } else {
        i.jobId = result.jobId
        if (i.status === 'intent') i.status = 'running'
        if (i.status === 'stale') try { await ports.cancel({intentId:i.id,jobId:i.jobId}) } catch { /* Remains stale. */ }
      }
      await save()
      if (i.pendingCompletion !== null && i.status === 'running') await finish(copy(i.pendingCompletion))
    })).catch(() => serial(async () => {
      const i = state.intents.find(i => i.id === intent.id)!
      if (i.status === 'intent' || i.status === 'running') {
        i.status = 'uncertain'; block(candidate(i.candidateId),'launch-uncertain'); await save()
      }
    }).catch(() => {}))
  }
  return {
    state: (): ReviewCoordinatorState => copy(state),
    enroll: (request: Omit<AuthorizationRequest,'stage'>) => serial(async () => {
      if (!text(request.candidateId)) throw new ReviewError('clarify','Explicit candidate ID required')
      const a = await authorize({...request,stage:'enroll'})
      const s = await ports.capture(a.candidateId)
      if (!s) throw new ReviewError('clarify','Candidate enrollment unavailable')
      snapshot(s)
      if (s.id !== a.candidateId) fail('Candidate identity mismatch')
      const existing = state.candidates.find(c => c.enrollment.id === s.id)
      if (existing) return copy(existing)
      const c: CandidateReviewState = {enrollment:copy(s),current:copy(s),status:'awaiting-checkpoint',reason:'explicit-checkpoint-required',attempts:{full:0,repair:0,targeted:0},checks:[],findings:[],reviewedRevision:null,verifiedRevision:null,repairedRevision:null}
      state.candidates.push(c); await save(); return copy(c)
    }),
    checkpoint: (request: ReviewCheckpoint) => serial(async () => {
      const c = candidate(request.candidateId)
      try {
        const a = await authorize(request), s = await capture(c)
        if (!equal(c.current,s)) await invalidate(c,s)
        const duplicate = state.intents.find(i => i.candidateId === s.id && i.revision === s.revision && i.stage === request.stage)
        if (duplicate) return copy(c)
        if (state.intents.some(i => i.candidateId === s.id && active(i))) fail('Candidate assignment incomplete')
        if (c.attempts[request.stage] !== 0) fail('Candidate stage allowance exhausted')
        const full = original(c), fs = material(c.findings)
        let scope: RepairScope | null = null
        if (request.stage !== 'full') {
          if (!full || !fs.length || c.reviewedRevision !== full.revision) fail('Original material review findings required')
          if (request.stage === 'repair' && !equal(s,full.snapshot)) fail('Repair must start from reviewed revision')
          if (request.stage === 'targeted') {
            if (c.attempts.repair !== 1 || c.repairedRevision !== s.revision || !sameContext(full.snapshot,s)) fail('Exact bounded repair and unchanged context required')
            const changed = s.files.filter((f,n) => !equal(f,full.snapshot.files[n]))
            if (changed.some(f => !fs.some(finding => finding.path === f.path))) fail('Repair changed unrelated artifact scope')
            scope = await ports.assessRepair({original:copy(full.snapshot),repaired:copy(s),findings:copy(c.findings)})
            repairScope(scope)
            if (!scope.withinScope || scope.originalRevision !== full.revision || scope.repairedRevision !== s.revision || !equal([...scope.findingIds].sort(),fs.map(f => f.id).sort()) || !equal([...scope.invariantIds].sort(),[...new Set(fs.map(f => f.invariant))].sort())) fail('Repair invariant scope unavailable')
          }
        }
        // Failed checks never consume a repair/model attempt or authorize another assignment.
        if (request.stage !== 'repair' && !await checks(c,s)) { await save(); return copy(c) }
        let reviewer: Reviewer | null = null
        if (request.stage !== 'repair') {
          reviewer = await ports.selectReviewer({purpose:'review',reviewStage:request.stage,snapshot:copy(s),authorization:copy(a)})
          qualified(reviewer)
          if (reviewer.configurationId !== s.reviewerConfigurationId) fail('Reviewer configuration mismatch')
        }
        if (!await current(c,s)) { await save(); return copy(c) }
        const i: LaunchIntent = {id:JSON.stringify([state.conversationId,s.id,s.revision,request.stage]),candidateId:s.id,revision:s.revision,stage:request.stage,purpose:request.stage === 'repair' ? 'execution' : 'review',reviewStage:request.stage === 'repair' ? null : request.stage,status:'intent',jobId:null,pendingCompletion:null,snapshot:copy(s),originalSnapshot:full ? copy(full.snapshot) : null,authorization:a,reviewer:copy(reviewer),checks:copy(c.checks),findings:request.stage === 'full' ? [] : copy(c.findings),repairScope:copy(scope)}
        c.attempts[request.stage]++; c.status = request.stage === 'repair' ? 'repairing' : 'reviewing'; c.reason = 'assignment-incomplete'
        state.intents.push(i)
        await save() // Intent and candidate counters are durable BEFORE any spawn.
        dispatch(copy(i))
      } catch (error) {
        block(c,error instanceof ReviewError ? error.message : 'checkpoint-unavailable')
        await save()
      }
      return copy(c)
    }),
    complete: (event: ReviewCompletion) => serial(() => finish(copy(event))),
    refresh: (id: string) => serial(async () => {
      const c = candidate(id), s = await capture(c)
      if (!equal(c.current,s)) await invalidate(c,s)
      await save(); return copy(c)
    }),
    reconcile: (intentId: string) => serial(async () => {
      const i = state.intents.find(i => i.id === intentId)
      if (!i || !active(i)) return
      const observed = await ports.observe(copy(i))
      if (observed.status === 'terminal') {
        if (observed.completion.intentId !== i.id) fail('Recovery correlation mismatch')
        await finish(observed.completion,true)
      } else if (observed.status === 'running') {
        if (!text(observed.jobId) || (i.jobId !== null && i.jobId !== observed.jobId) || (i.pendingCompletion !== null && i.pendingCompletion.jobId !== observed.jobId)) fail('Recovery job mismatch')
        i.jobId = observed.jobId; i.status = 'running'; await save()
        if (i.pendingCompletion !== null) await finish(copy(i.pendingCompletion))
      }
    }),
    accept: (request: Omit<AuthorizationRequest,'stage'>) => serial(async () => {
      const c = candidate(request.candidateId)
      try {
        await authorize({...request,stage:'accept'})
        if (!await current(c,c.current)) { await save(); return copy(c) }
        if (state.intents.some(i => i.candidateId === c.enrollment.id && active(i))) fail('Candidate assignment incomplete')
        if (await checks(c,c.current) && ready(c)) { c.status = 'accepted'; c.reason = c.current.checkIds.length ? 'explicit-acceptance' : 'explicit-acceptance-no-executable-checks-required' }
      } catch (error) { block(c,error instanceof ReviewError ? error.message : 'acceptance-unavailable') }
      await save(); return copy(c)
    }),
  }
}
export function createCoordinator(conversationId: string, ports: ReviewPorts, mode: ReviewMode = 'recommend') {
  return coordinator(conversationId,ports,mode)
}
export type ReviewCoordinator = ReturnType<typeof createCoordinator>
export async function restoreCoordinator(conversationId: string, ports: ReviewPorts, mode: ReviewMode = 'recommend'): Promise<ReviewCoordinator> {
  if (!text(conversationId) || !['off','recommend','automatic'].includes(mode)) fail('Invalid conversation or review mode')
  const raw = await ports.read()
  if (raw === undefined) return createCoordinator(conversationId,ports,mode)
  validateState(raw,conversationId)
  const state = copy(raw)
  state.mode = mode
  for (const i of state.intents) if (i.status === 'intent' || i.status === 'running') {
    i.status = 'uncertain'
    const c = state.candidates.find(c => c.enrollment.id === i.candidateId)!
    c.status = 'blocked'; c.reason = 'recovery-required'
  }
  await ports.persist(copy(state))
  return coordinator(conversationId,ports,mode,state)
}

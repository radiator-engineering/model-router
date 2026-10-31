import generated from '../catalog/model-data.ts'
import {expect, test} from 'claude-code/testing'
import {parseCatalog, validateCatalog, reconcileAvailability, parseCatalogV2, parseCatalogDocument, projectLegacyCatalog, migrateCatalogV1} from '../hooks/model-catalog.ts'
import {readFileSync} from 'node:fs'
import {renderCatalog} from '../scripts/build-catalog.mjs'
const read = (path: string) => JSON.parse(readFileSync(new URL(path, import.meta.url), 'utf8'))
const seed = () => read('../catalog/models.json')
/** The legacy v1 snapshot inside the v2 catalog. */
const v1 = () => seed().legacy
test('the seed catalog is valid and contains unique Claude and GPT IDs', () => {
  const catalog = parseCatalog(seed())
  expect(catalog.models.length).toBe(6)
  expect(new Set(catalog.models.map(m=>m.id)).size).toBe(6)
  expect(validateCatalog(catalog)).toEqual([])
})
test('discovery does not imply quality, price or harness compatibility', () => {
  for (const model of parseCatalog(seed()).models) {
    expect(model.capabilities.qualityByUseCase.review).toBeNull()
    expect(model.cost.allowanceWeight).toBeNull()
  }
})
test('rejects duplicate IDs, invalid ratings, negative prices and impossible dates', () => {
  const c = v1(); c.models[1].id=c.models[0].id
  c.models[0].capabilities.qualityByUseCase.review=6
  c.models[0].cost.inputUsdPerMillion=-1
  c.models[0].evidence.checkedAt='2026-02-30'
  const errors=validateCatalog(c).join('\n')
  for (const field of ['unique','review','inputUsdPerMillion','checkedAt']) expect(errors).toContain(field)
})
test('rejects nonfinite costs, missing fields and malformed catalog roots', () => {
  const c=v1(); c.models[0].cost.allowanceWeight=NaN
  delete c.models[0].capabilities.qualityByUseCase.planning
  expect(validateCatalog(c).length > 0).toBe(true)
  for (const bad of [null, [], {}, {schemaVersion:2, models:[null]}]) expect(validateCatalog(bad).length>0).toBe(true)
})
test('parseCatalog rejects invalid input and isolates returned objects', () => {
  let threw=false; try {parseCatalog({})} catch {threw=true}
  expect(threw).toBe(true)
  const original=seed(); const parsed=parseCatalog(original)
  parsed.models[0].enabled=false
  expect(original.legacy.models[0].enabled).toBe(true)
})
test('reconciliation marks absent models unknown without enabling disabled models', () => {
  const original=parseCatalog(seed()); for(const m of original.models)m.availability='advertised'; original.models[0].enabled=false
  const updated=reconcileAvailability(original,[original.models[0].id])
  expect(updated.models[0].availability).toBe('advertised')
  expect(updated.models[0].enabled).toBe(false)
  expect(updated.models[1].availability).toBe('unknown')
  expect(original.models[1].availability).toBe('advertised')
})
test('reconciliation preserves verified status only for currently advertised IDs', () => {
  const c=parseCatalog(seed()); c.models[0].availability='verified'
  expect(reconcileAvailability(c,[c.models[0].id]).models[0].availability).toBe('verified')
  expect(reconcileAvailability(c,[]).models[0].availability).toBe('unknown')
})

test('generated hook catalog matches the editable JSON source',()=>{expect(generated).toEqual(seed())})

// Schema v2 ----------------------------------------------------------------
const fixtureV1 = () => read('./fixtures/catalog-v1-migration.json')
const fixtureV2 = () => read('./fixtures/catalog-v2-migrated.json')
const errorsOf = (doc: unknown) => validateCatalog(doc).join('\n')
const env = {id:'synthetic/env', harnessVersion:'2.1.316', proxyVersion:'synthetic-proxy 0.0.0', requestPath:'synthetic-path', evidenceIds:['legacy/synthetic-advertised']}
const approval = (over: Record<string, unknown> = {}) => ({id:'synthetic/approval', configurationId:'configuration/synthetic-unsupported/level-high/unknown', environmentId:'synthetic/env', role:'implementation', policyRuleIds:['synthetic-rule'], state:'approved', evidenceIds:['legacy/synthetic-advertised'], checkedAt:'2026-10-01T00:00:00Z', validUntil:'2026-12-01T00:00:00Z', limits:{maxInputTokens:1000, maxGeneratedTokens:100, maxToolCalls:5, maxWallTimeMs:1000, outputReserveTokens:100, contextMarginFraction:0.1}, ...over})
const withApproval = (over: Record<string, unknown> = {}) => ({...fixtureV2(), environments:[env], approvals:[approval(over)]})

test('v1 migration is deterministic and matches the expected fixture exactly', () => {
  expect(migrateCatalogV1(fixtureV1())).toEqual(fixtureV2())
  expect(JSON.stringify(migrateCatalogV1(fixtureV1()))).toBe(JSON.stringify(migrateCatalogV1(fixtureV1())))
})
test('migration keeps a lossless legacy snapshot and projection', () => {
  const v2 = migrateCatalogV1(fixtureV1())
  expect(v2.legacy).toEqual(fixtureV1())
  expect(projectLegacyCatalog(v2)).toEqual(fixtureV1())
  expect(parseCatalog(v2)).toEqual(parseCatalog(fixtureV1()))
})
test('migration infers no approvals, environments, times, paths or families', () => {
  const v2 = migrateCatalogV1(fixtureV1())
  expect(v2.approvals).toEqual([]); expect(v2.environments).toEqual([])
  for (const a of v2.availability) { expect(a.observedAt).toBeNull(); expect(a.validUntil).toBeNull() }
  for (const c of v2.configurations) expect(c.requestPath).toBeNull()
  for (const c of v2.compatibility) { expect(c.environmentId).toBeNull(); expect(c.imageInput).toBeNull(); expect(c.effectiveEffortVerified).toBeNull() }
  for (const m of v2.models) expect(m.family).toBeNull()
})
test('a date-only check stays a date; observation time remains unknown', () => {
  const e = migrateCatalogV1(fixtureV1()).evidence.find(x => x.id === 'legacy/synthetic-verified%2Fdate%20only')!
  expect(e.checkedDate).toBe('2026-10-30'); expect(e.observedAt).toBeNull(); expect(e.source).toBe('legacy-import')
  expect((e.payload as any).evidence.source).toBe('evaluation')
  expect((e.payload as any).capabilities.qualityByUseCase.review).toBe(3)
  expect((e.payload as any).cost.allowanceWeight).toBe(1.5)
})
test('advertised models without efforts get one unknown-effort configuration; explicit lack of support survives', () => {
  const v2 = migrateCatalogV1(fixtureV1())
  const advertised = v2.configurations.filter(c => c.modelId === 'synthetic-advertised')
  expect(advertised.map(c => c.effort)).toEqual([{kind:'unknown'}])
  const unsupported = v2.compatibility.find(c => c.configurationId === 'configuration/synthetic-unsupported/level-high/unknown')!
  expect(unsupported.status).toBe('incompatible'); expect(unsupported.toolCalling).toBe(false)
  expect(v2.compatibility.find(c => c.configurationId === advertised[0]!.id)!.supportedEfforts).toEqual([])
})
test('invalid v1 input fails before migration output', () => {
  const bad = fixtureV1(); bad.models[0].availability = 'certain'
  let threw = false; try { migrateCatalogV1(bad) } catch { threw = true }
  expect(threw).toBe(true)
  threw = false; try { migrateCatalogV1(fixtureV2()) } catch { threw = true }
  expect(threw).toBe(true)
})
test('migration preserves padded legacy effort declarations without trimming or merging', () => {
  const source = fixtureV1(); source.models[0].capabilities.reasoningEfforts = [' medium ', 'medium']
  expect(validateCatalog(source)).toEqual([])
  const migrated = migrateCatalogV1(source)
  expect(migrated.legacy).toEqual(source)
  expect(migrated.configurations.filter(c => c.modelId === source.models[0].id).map(c => c.effort))
    .toEqual([{kind:'level', value:' medium '}, {kind:'level', value:'medium'}])
})
test('catalog payloads reject non-JSON objects and cycles but allow shared JSON subtrees', () => {
  const cycle: any = {}; cycle.self = cycle
  for (const payload of [new Map([['claim', true]]), new Date(), cycle, {value:undefined}, [undefined]]) {
    const c = fixtureV2(); c.evidence[0].payload = payload
    expect(errorsOf(c)).toContain('payload must be JSON data')
  }
  const shared = {claim:true}; const c = fixtureV2(); c.evidence[0].payload = {left:shared, right:shared}
  expect(errorsOf(c)).toBe('')
})
test('generated modules preserve own __proto__ keys and literal code-like strings as data', async () => {
  const c = fixtureV2()
  c.evidence[0].payload = JSON.parse('{"__proto__":{"claim":true},"text":"` ${notCode} \\u2028"}')
  const source = parseCatalogDocument(c)
  const module = await import(`data:text/javascript,${encodeURIComponent(renderCatalog(source))}`)
  expect(module.default).toEqual(source)
  expect(Object.hasOwn(module.default.evidence[0].payload, '__proto__')).toBe(true)
  expect(module.default.evidence[0].payload.claim).toBeUndefined()
})
test('v2 validation rejects dangling references, duplicate IDs and unsorted collections', () => {
  const dangling = fixtureV2(); dangling.availability[0].modelId = 'missing'
  dangling.compatibility[0].configurationId = 'missing'; dangling.compatibility[1].evidenceIds = ['missing']
  const text = errorsOf(dangling)
  for (const f of ['availability[0].modelId', 'compatibility[0].configurationId', 'compatibility[1].evidenceIds']) expect(text).toContain(f)
  const dup = fixtureV2(); dup.models[1].id = dup.models[0].id
  expect(errorsOf(dup)).toContain('models[1].id must be unique')
  const unsorted = fixtureV2(); unsorted.models.reverse()
  expect(errorsOf(unsorted)).toContain('models must be sorted by id')
  const extra = {...fixtureV2(), surprise:true}
  expect(errorsOf(extra)).toContain('unknown top-level field surprise')
})
test('v2 validation checks the legacy snapshot and effort tokens', () => {
  const c = fixtureV2(); c.legacy.models[0].provider = 'acme'; c.configurations[0].effort = {kind:'level', value:''}
  const text = errorsOf(c)
  expect(text).toContain('legacy: models[0].provider'); expect(text).toContain('configurations[0].effort')
  const budget = fixtureV2(); budget.configurations[0].effort = {kind:'budget', value:4096}
  expect(errorsOf(budget)).toBe('')
})
test('approvals require resolvable environment, evidence and evidence-bearing limits', () => {
  expect(errorsOf(withApproval())).toBe('')
  expect(errorsOf(withApproval({environmentId:'missing'}))).toContain('approvals[0].environmentId')
  expect(errorsOf(withApproval({role:'wizard'}))).toContain('approvals[0].role')
  expect(errorsOf(withApproval({policyRuleIds:[]}))).toContain('approvals[0].policyRuleIds')
  expect(errorsOf(withApproval({validUntil:'2026-09-01T00:00:00Z'}))).toContain('approvals[0].checkedAt/validUntil')
  for (const limits of [{outputReserveTokens:99}, {contextMarginFraction:1}, {maxToolCalls:0}])
    expect(errorsOf(withApproval({limits:{...approval().limits, ...limits}}))).toContain('approvals[0].limits')
  expect(errorsOf({...withApproval(), environments:[{...env, evidenceIds:[]}]})).toContain('environments[0].evidenceIds')
})
test('readers: v2-only, full-document and legacy projection behave as specified', () => {
  let threw = false; try { parseCatalogV2(fixtureV1()) } catch { threw = true }
  expect(threw).toBe(true)
  expect(parseCatalogDocument(fixtureV1()).schemaVersion).toBe(1)
  expect(parseCatalogDocument(fixtureV2())).toEqual(fixtureV2())
  const original = fixtureV2(); const parsed = parseCatalogV2(original)
  parsed.models[0].enabled = false
  expect(original.models[0].enabled).toBe(true)
})
test('editing v2 observations never rewrites the legacy projection', () => {
  const c = fixtureV2(); c.availability[0].status = 'unavailable'; c.models[0].enabled = false
  expect(parseCatalog(c)).toEqual(fixtureV1())
})
test('the committed catalog is schema v2 and its legacy-import records equal the migration', () => {
  const doc = parseCatalogV2(seed())
  const migrated = migrateCatalogV1(doc.legacy) as any
  for (const name of ['models', 'availability', 'configurations', 'compatibility', 'evidence'] as const)
    for (const record of migrated[name]) expect((doc as any)[name].find((r: any) => r.id === record.id)).toEqual(record)
})

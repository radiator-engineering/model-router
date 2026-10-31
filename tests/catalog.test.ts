import {expect, test} from 'claude-code/testing'
import {parseCatalog, validateCatalog, reconcileAvailability} from '../hooks/model-catalog.ts'
import {readFileSync} from 'node:fs'
const seed = () => JSON.parse(readFileSync(new URL('../catalog/models.json', import.meta.url), 'utf8'))
test('the seed catalog is valid and contains unique Claude and GPT IDs', () => {
  const catalog = parseCatalog(seed())
  expect(catalog.models.length).toBe(6)
  expect(new Set(catalog.models.map(m=>m.id)).size).toBe(6)
  expect(validateCatalog(catalog)).toEqual([])
})
test('discovery does not imply quality, price or harness compatibility', () => {
  for (const model of parseCatalog(seed()).models) {
    expect(model.claudeCodeCompatibility).toBe('unverified')
    expect(model.capabilities.qualityByUseCase.review).toBeNull()
    expect(model.cost.allowanceWeight).toBeNull()
  }
})
test('rejects duplicate IDs, invalid ratings, negative prices and impossible dates', () => {
  const c = seed(); c.models[1].id=c.models[0].id
  c.models[0].capabilities.qualityByUseCase.review=6
  c.models[0].cost.inputUsdPerMillion=-1
  c.models[0].evidence.checkedAt='2026-02-30'
  const errors=validateCatalog(c).join('\n')
  for (const field of ['unique','review','inputUsdPerMillion','checkedAt']) expect(errors).toContain(field)
})
test('rejects nonfinite costs, missing fields and malformed catalog roots', () => {
  const c=seed(); c.models[0].cost.allowanceWeight=NaN
  delete c.models[0].capabilities.qualityByUseCase.planning
  expect(validateCatalog(c).length > 0).toBe(true)
  for (const bad of [null, [], {}, {schemaVersion:2, models:[null]}]) expect(validateCatalog(bad).length>0).toBe(true)
})
test('parseCatalog rejects invalid input and isolates returned objects', () => {
  let threw=false; try {parseCatalog({})} catch {threw=true}
  expect(threw).toBe(true)
  const original=seed(); const parsed=parseCatalog(original)
  parsed.models[0].enabled=false
  expect(original.models[0].enabled).toBe(true)
})
test('reconciliation marks absent models unknown without enabling disabled models', () => {
  const original=parseCatalog(seed()); original.models[0].enabled=false
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

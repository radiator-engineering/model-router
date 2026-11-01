import {expect, test} from 'claude-code/testing'
import {ok} from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {captureCandidate, enrollCandidate} from '../hooks/v2/artifacts.ts'
import type {ArtifactConfiguration, ArtifactHost, EnrolledCandidate, EnrollmentAuthorization} from '../hooks/v2/artifacts.ts'

const COMMIT = 'a'.repeat(40)
const AUTH: EnrollmentAuthorization = {source: 'composer', verified: true, authorizationRef: 'user-action', assignmentId: 'assignment', lineageId: 'lineage'}
const CONFIG: ArtifactConfiguration = {repositoryRoot: '/repo', policyRevision: 'p1', reviewerConfigurationId: 'reviewer', checkConfigurationHash: 'b'.repeat(64), requiredCheckIds: ['standing'], requireReview: true, trustedCheckIds: ['standing', 'selected']}
function fixture() {
  const manifest = {schemaVersion: 1, baseRevision: 'HEAD', files: ['a.txt'], contextFiles: ['context.txt'], requirements: [{id: 'R1', text: 'Keep bytes.'}], checkIds: ['selected'], requireReview: false}
  const files = new Map<string, Uint8Array>([['/repo/a.txt', new Uint8Array([0, 255, 128, 10])], ['/repo/context.txt', new TextEncoder().encode('context')]])
  const aliases = new Map<string, string>()
  const dirs = new Set(['/repo', '/repo/src'])
  const base = new Set(['a.txt', 'removed.txt', 'gone/old.txt'])
  const calls: string[][] = []
  const resolve = (path: string) => {
    for (const [alias, target] of aliases) if (path === alias || path.startsWith(`${alias}/`)) return target + path.slice(alias.length)
    return path
  }
  const host: ArtifactHost = {
    fs: {
      async stat(path) {
        const realPath = resolve(path), kind = dirs.has(realPath) ? 'dir' : files.has(realPath) ? 'file' : 'other'
        if (kind === 'other') throw new Error('ENOENT')
        return {realPath, kind, isLink: aliases.has(path)}
      },
      async read(path) { const bytes = files.get(resolve(path)); if (!bytes) throw new Error('ENOENT'); return {base64: Buffer.from(bytes).toString('base64')} },
      async list(path) {
        const prefix = `${path}/`
        return [...new Set([...files.keys(), ...aliases.keys(), ...dirs])].filter(key => key.startsWith(prefix) && !key.slice(prefix.length).includes('/')).map(key => ({name: key.slice(prefix.length), isLink: aliases.has(key)}))
      },
    },
    process: {async run(argv) {
      calls.push(argv)
      if (argv[1] === 'rev-parse') return {exitCode: 0, stdout: COMMIT, stderr: ''}
      if (argv[1] === 'cat-file') return {exitCode: base.has(argv[3]!.slice(COMMIT.length + 1)) ? 0 : 1, stdout: 'blob', stderr: ''}
      throw new Error('unexpected process invocation')
    }},
  }
  const save = () => files.set('/repo/candidate.json', new TextEncoder().encode(JSON.stringify(manifest)))
  save()
  return {host, manifest, files, aliases, dirs, calls, save}
}
async function enrolled(f: ReturnType<typeof fixture>, configuration = CONFIG): Promise<EnrolledCandidate> {
  const result = await enrollCandidate(f.host, 'candidate.json', AUTH, configuration)
  ok(result.outcome === 'enrolled', JSON.stringify(result))
  return result.candidate
}
async function captured(f: ReturnType<typeof fixture>, candidate: EnrolledCandidate, configuration = CONFIG) {
  const result = await captureCandidate(f.host, candidate, configuration)
  ok(result.outcome === 'captured', JSON.stringify(result))
  return result.snapshot
}

test('enrollment requires separate verified authority; manifest authority and commands cannot mint it', async () => {
  const f = fixture()
  for (const source of ['prompt', 'tool', 'plugin', 'unknown']) {
    const result = await enrollCandidate(f.host, 'candidate.json', {...AUTH, source} as EnrollmentAuthorization, CONFIG)
    expect(result.outcome).toBe('unavailable')
  }
  expect((await enrollCandidate(f.host, 'candidate.json', {...AUTH, verified: false} as unknown as EnrollmentAuthorization, CONFIG)).outcome).toBe('unavailable')
  for (const field of ['authorization', 'command', 'providerPermissions', 'budget']) {
    f.files.set('/repo/candidate.json', new TextEncoder().encode(JSON.stringify({...f.manifest, [field]: AUTH})))
    expect((await enrollCandidate(f.host, 'candidate.json', AUTH, CONFIG)).outcome).toBe('unavailable')
  }
  expect(f.calls.length).toBe(0)
})

test('enrollment resolves base once, binds lineage and unions policy requirements without partial execution', async () => {
  const f = fixture(), candidate = await enrolled(f)
  ok(/^cand_[a-f0-9-]{36}$/.test(candidate.id))
  expect(candidate.baseCommit).toBe(COMMIT)
  expect(candidate.authorization).toEqual(AUTH)
  expect(candidate.checkIds).toEqual(['selected', 'standing'])
  expect(candidate.requireReview).toBe(true)
  expect(f.calls).toEqual([['git', 'rev-parse', '--verify', '--end-of-options', 'HEAD^{commit}']])
  await captured(f, candidate)
  expect(f.calls.length).toBe(1)
  ok(Object.isFrozen(candidate) && Object.isFrozen(candidate.configuration.requiredCheckIds))
  f.save()
  ok((await enrolled(f)).id !== candidate.id)
})

test('missing scope and requirements clarify while malformed or unavailable check data fails closed', async () => {
  const f = fixture()
  expect((await enrollCandidate(f.host, '', AUTH, CONFIG)).outcome).toBe('clarify')
  for (const key of ['files', 'requirements'] as const) {
    const saved = f.manifest[key]
    ;(f.manifest as any)[key] = []
    f.save()
    expect((await enrollCandidate(f.host, 'candidate.json', AUTH, CONFIG)).outcome).toBe('clarify')
    ;(f.manifest as any)[key] = saved
  }
  for (const requirements of [[{id: '', text: 'x'}], [{id: 'R', text: ' '}], [{id: 'R', text: 'one'}, {id: 'R', text: 'two'}]]) {
    f.manifest.requirements = requirements
    f.save()
    expect((await enrollCandidate(f.host, 'candidate.json', AUTH, CONFIG)).outcome).toBe('unavailable')
  }
  f.manifest.requirements = [{id: 'R', text: 'valid'}]
  f.manifest.checkIds = ['missing']
  f.save()
  expect((await enrollCandidate(f.host, 'candidate.json', AUTH, CONFIG)).outcome).toBe('unavailable')
  expect(f.calls.length).toBe(0)
})

test('explicit scope rejects traversal, globs, absolute paths and unsafe separators', async () => {
  const f = fixture()
  for (const path of ['../outside', 'src/../a.txt', '/repo/a.txt', '*.txt', 'a?.txt', '[a].txt', '{a,b}.txt', 'C:escape', 'a\\b', 'a\0b']) {
    f.manifest.files = [path]
    f.save()
    expect((await enrollCandidate(f.host, 'candidate.json', AUTH, CONFIG)).outcome).toBe('unavailable')
  }
  expect((await enrollCandidate(f.host, '../candidate.json', AUTH, CONFIG)).outcome).toBe('unavailable')
})

test('inside symlink aliases deduplicate and sort; outside links and dangling links never become deletions', async () => {
  const f = fixture()
  f.aliases.set('/repo/alias.txt', '/repo/a.txt')
  f.manifest.files = ['./a.txt', 'alias.txt', 'a.txt']
  f.save()
  expect((await enrolled(f)).files).toEqual(['a.txt'])
  f.files.set('/outside', new Uint8Array([1]))
  f.aliases.set('/repo/a.txt', '/outside')
  expect((await enrollCandidate(f.host, 'candidate.json', AUTH, CONFIG)).outcome).toBe('unavailable')
  f.aliases.set('/repo/a.txt', '/missing')
  expect((await enrollCandidate(f.host, 'candidate.json', AUTH, CONFIG)).outcome).toBe('unavailable')
  f.aliases.delete('/repo/a.txt')
  f.aliases.set('/repo/escape', '/outside-dir')
  f.dirs.add('/outside-dir')
  f.manifest.files = ['escape/file.txt']
  f.save()
  expect((await enrollCandidate(f.host, 'candidate.json', AUTH, CONFIG)).outcome).toBe('unavailable')
})

test('selected untracked bytes and base-present deletions are included; absent files or missing context are invalid', async () => {
  const f = fixture()
  f.files.set('/repo/new.txt', new TextEncoder().encode('untracked'))
  f.manifest.files = ['new.txt', 'removed.txt', 'gone/old.txt']
  f.save()
  const candidate = await enrolled(f), snapshot = await captured(f, candidate)
  expect(snapshot.manifest.files.map(entry => [entry.path, entry.sha256 === null])).toEqual([['gone/old.txt', true], ['new.txt', false], ['removed.txt', true]])
  for (const [files, contextFiles] of [[['missing.txt'], []], [['a.txt'], ['removed.txt']], [['src'], []]] as [string[], string[]][]) {
    f.manifest.files = files
    f.manifest.contextFiles = contextFiles
    f.save()
    expect((await enrollCandidate(f.host, 'candidate.json', AUTH, CONFIG)).outcome).toBe('unavailable')
  }
})

test('revisions hash unchanged binary bytes and fixed-key JSON with normalized requirements and immutable manifests', async () => {
  const f = fixture()
  f.manifest.requirements = [{id: 'Z', text: ' end '}, {id: 'A', text: 'first'}]
  f.save()
  const candidate = await enrolled(f), snapshot = await captured(f, candidate)
  expect(snapshot.manifest.requirements).toEqual([{id: 'A', text: 'first'}, {id: 'Z', text: 'end'}])
  expect(snapshot.manifest.files[0]!.sha256).toBe(createHash('sha256').update(f.files.get('/repo/a.txt')!).digest('hex'))
  expect(snapshot.revision).toBe(createHash('sha256').update(JSON.stringify(snapshot.manifest)).digest('hex'))
  ok(Object.isFrozen(snapshot.manifest.files[0]))
  expect((await captured(f, candidate)).revision).toBe(snapshot.revision)
  f.files.set('/repo/a.txt', new Uint8Array([0, 255, 128, 13, 10]))
  ok((await captured(f, candidate)).revision !== snapshot.revision)
})

test('content, context, scope, requirements and every fixed configuration key invalidate prior revisions', async () => {
  const f = fixture(), candidate = await enrolled(f), original = await captured(f, candidate)
  for (const configuration of [
    {...CONFIG, policyRevision: 'p2'}, {...CONFIG, reviewerConfigurationId: 'other'}, {...CONFIG, checkConfigurationHash: 'c'.repeat(64)},
    {...CONFIG, requireReview: false}, {...CONFIG, requiredCheckIds: []},
  ]) ok((await captured(f, candidate, configuration)).revision !== original.revision)
  for (const changed of [
    {...candidate, requirements: [{id: 'R1', text: 'different'}]}, {...candidate, files: ['a.txt', 'context.txt']}, {...candidate, contextFiles: []},
  ]) ok((await captured(f, changed)).revision !== original.revision)
  f.files.set('/repo/context.txt', new TextEncoder().encode('new context'))
  ok((await captured(f, candidate)).revision !== original.revision)
})

test('capture rejects retargeted scope, dangling paths and moved repository roots', async () => {
  const f = fixture(), candidate = await enrolled(f)
  f.aliases.set('/repo/a.txt', '/repo/context.txt')
  expect((await captureCandidate(f.host, candidate, CONFIG)).outcome).toBe('unavailable')
  f.aliases.set('/repo/a.txt', '/missing')
  expect((await captureCandidate(f.host, candidate, CONFIG)).outcome).toBe('unavailable')
  f.aliases.delete('/repo/a.txt')
  f.dirs.add('/other')
  expect((await captureCandidate(f.host, candidate, {...CONFIG, repositoryRoot: '/other'})).outcome).toBe('unavailable')
})

test('invalid local base and host read failures cannot produce enrollment or revision evidence', async () => {
  const f = fixture()
  f.host.process.run = async () => ({exitCode: 0, stdout: 'HEAD', stderr: ''})
  expect((await enrollCandidate(f.host, 'candidate.json', AUTH, CONFIG)).outcome).toBe('unavailable')
  const clean = fixture(), candidate = await enrolled(clean)
  clean.host.fs.read = async () => { throw new Error('host read unavailable') }
  expect((await captureCandidate(clean.host, candidate, CONFIG)).outcome).toBe('unavailable')
})

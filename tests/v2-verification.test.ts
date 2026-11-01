import {expect, test} from 'claude-code/testing'
import {ok} from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {captureCandidate, enrollCandidate} from '../hooks/v2/artifacts.ts'
import type {ArtifactConfiguration, EnrollmentAuthorization} from '../hooks/v2/artifacts.ts'
import {normalizeTrustedChecks, quoteCheckDirectory, runVerification} from '../hooks/v2/verification.ts'
import type {TrustedCheckDefinition, VerificationDefinitions, VerificationHost} from '../hooks/v2/verification.ts'

const AUTH: EnrollmentAuthorization = {source: 'coordinator', verified: true, authorizationRef: 'trusted-checkpoint', assignmentId: 'a', lineageId: 'l'}
const CHECK: TrustedCheckDefinition = {id: 'check', command: "printf 'literal command'", cwd: '.', timeoutMs: 120000}
async function fixture(root = '/repo', checks: TrustedCheckDefinition[] = [CHECK]) {
  const normalized = await normalizeTrustedChecks({schemaVersion: 1, source: 'user', checks})
  ok(normalized.outcome === 'valid')
  const configuration: ArtifactConfiguration = {repositoryRoot: root, policyRevision: 'p1', reviewerConfigurationId: 'reviewer', checkConfigurationHash: normalized.configurationHash,
    requiredCheckIds: ['check'], trustedCheckIds: ['check'], requireReview: true}
  const definitions: VerificationDefinitions = {...normalized.definitions, configuration}
  const manifest = {schemaVersion: 1, baseRevision: 'HEAD', files: ['artifact'], contextFiles: ['context'], requirements: [{id: 'R', text: 'Keep invariant'}], checkIds: [], requireReview: false}
  const files = new Map([[`${root}/candidate.json`, JSON.stringify(manifest)], [`${root}/artifact`, 'original'], [`${root}/context`, 'context']])
  const dirs = new Set([root])
  const links = new Map<string, string>()
  const calls: {tool: 'Bash'; command: string; timeout: number}[] = []
  const processes: string[][] = []
  let result: unknown = {result: {stdout: 'all checks passed', stderr: '', interrupted: false}}
  let action: (() => void) | null = null
  const host: VerificationHost = {
    fs: {
      async stat(path) {
        const realPath = links.get(path) ?? path
        if (dirs.has(realPath)) return {kind: 'dir', isLink: links.has(path), realPath}
        if (files.has(realPath)) return {kind: 'file', isLink: links.has(path), realPath}
        throw new Error('ENOENT')
      },
      async read(path) { const text = files.get(path); if (text === undefined) throw new Error('ENOENT'); return {base64: Buffer.from(text).toString('base64')} },
      async list(path) { return [...files.keys(), ...dirs, ...links.keys()].filter(key => key.startsWith(`${path}/`) && !key.slice(path.length + 1).includes('/')).map(key => ({name: key.slice(path.length + 1), isLink: links.has(key)})) },
    },
    process: {async run(argv) { processes.push(argv); ok(argv[0] === 'git'); return {exitCode: 0, stdout: argv[1] === 'rev-parse' ? 'a'.repeat(40) : 'blob', stderr: ''} }},
    tool: {async call(input) { calls.push(input); action?.(); return result }},
  }
  const enrollment = await enrollCandidate(host, 'candidate.json', AUTH, configuration)
  ok(enrollment.outcome === 'enrolled', JSON.stringify(enrollment))
  const candidate = enrollment.candidate
  const capture = await captureCandidate(host, candidate, configuration)
  ok(capture.outcome === 'captured')
  return {host, candidate, snapshot: capture.snapshot, definitions, files, dirs, links, calls, processes, root,
    setResult(value: unknown) { result = value }, duringCheck(fn: () => void) { action = fn }}
}

test('trusted check normalization accepts only observable user/policy provenance and binds sorted literal configuration', async () => {
  for (const source of ['project', 'local', 'flag', 'repository', 'plugin', 'unknown', undefined]) {
    expect((await normalizeTrustedChecks({schemaVersion: 1, source, checks: [CHECK]})).outcome).toBe('unavailable')
  }
  const first = await normalizeTrustedChecks({schemaVersion: 1, source: 'user', checks: [{...CHECK, id: 'z'}, {...CHECK, id: 'a', cwd: './'}]})
  const second = await normalizeTrustedChecks({schemaVersion: 1, source: 'user', checks: [{...CHECK, id: 'a'}, {...CHECK, id: 'z'}]})
  ok(first.outcome === 'valid' && second.outcome === 'valid')
  expect(first.configurationHash).toBe(second.configurationHash)
  expect(first.definitions.checks.map(check => check.id)).toEqual(['a', 'z'])
  const policy = await normalizeTrustedChecks({...first.definitions, source: 'managed-policy'})
  ok(policy.outcome === 'valid' && policy.configurationHash !== first.configurationHash)
})

test('timeouts, IDs, literal commands and repository-relative cwd are validated before any tool use', async () => {
  for (const value of [0, -1, 600001, 1.5, Infinity, NaN, '1000']) {
    expect((await normalizeTrustedChecks({schemaVersion: 1, source: 'user', checks: [{...CHECK, timeoutMs: value}]})).outcome).toBe('unavailable')
  }
  for (const patch of [{id: ''}, {command: ' '}, {command: 'x\0y'}, {cwd: '../escape'}, {cwd: '/outside'}, {cwd: '*'}, {command: undefined}]) {
    expect((await normalizeTrustedChecks({schemaVersion: 1, source: 'user', checks: [{...CHECK, ...patch}]})).outcome).toBe('unavailable')
  }
  expect((await normalizeTrustedChecks({schemaVersion: 1, source: 'user', checks: [CHECK, CHECK]})).outcome).toBe('unavailable')
  for (const timeoutMs of [1, 600000]) expect((await normalizeTrustedChecks({schemaVersion: 1, source: 'user', checks: [{...CHECK, timeoutMs}]})).outcome).toBe('valid')
})

test('governed Bash uses exact trusted literal command, finite timeout and shell-safe resolved cwd', async () => {
  const root = "/repo spaces' $HOME `echo nope` $(echo nope)"
  const f = await fixture(root)
  const result = await runVerification(f.host, f.candidate, f.snapshot, f.definitions)
  expect(result.outcome).toBe('unavailable')
  expect(f.calls).toEqual([{tool: 'Bash', command: `cd ${quoteCheckDirectory(root)} && ${CHECK.command}`, timeout: CHECK.timeoutMs}])
  expect(execFileSync('/bin/sh', ['-c', `printf '%s' ${quoteCheckDirectory(root)}`], {encoding: 'utf8'})).toBe(root)
  expect(f.processes.every(argv => argv[0] === 'git')).toBe(true)
  const check = result.checks[0]
  ok(check)
  expect(check.candidateId).toBe(f.candidate.id)
  expect(check.revision).toBe(f.snapshot.revision)
  expect(check.configurationHash).toBe(f.definitions.configuration.checkConfigurationHash)
  ok(Date.parse(check.endedAt) >= Date.parse(check.startedAt))
})

test('native foreground success prose, absent errors and invented exitCode never establish successful completion', async () => {
  const f = await fixture()
  for (const raw of [
    {result: {stdout: 'PASS', stderr: '', interrupted: false}},
    {result: {stdout: '', stderr: '', interrupted: false, exitCode: 0}, isError: false},
    {result: {completed: true, success: true, status: 'success', exitCode: 0}},
    {text: 'Exit code: 0, all tests passed'}, null,
  ]) {
    f.setResult(raw)
    const result = await runVerification(f.host, f.candidate, f.snapshot, f.definitions)
    expect(result.outcome).toBe('unavailable')
    expect(result.checks[0]!.status).toBe('unavailable')
    expect(result.checks[0]!.completion.exitCode).toBeNull()
  }
})

test('denied, interrupted, timed-out, background and host-error outcomes remain unsuccessful evidence', async () => {
  const f = await fixture()
  for (const [raw, status, outcome] of [
    [{deny: 'permission denied'}, 'denied', 'unavailable'],
    [{result: {interrupted: true}}, 'interrupted', 'unavailable'],
    [{result: {timedOutAfterMs: 120000, backgroundTaskId: 'b'}}, 'timeout', 'unavailable'],
    [{result: {backgroundTaskId: 'b', interrupted: false}}, 'unavailable', 'unavailable'],
    [{result: {backgroundedByUser: true}}, 'unavailable', 'unavailable'],
    [{result: {backgroundedByTurnAbort: true}}, 'unavailable', 'unavailable'],
    [{result: {stdout: '', stderr: 'failed', interrupted: false}, isError: true}, 'failed', 'failed'],
  ] as const) {
    f.setResult(raw)
    const result = await runVerification(f.host, f.candidate, f.snapshot, f.definitions)
    expect(result.outcome).toBe(outcome)
    expect(result.checks[0]!.status).toBe(status)
  }
  f.host.tool.call = async () => { throw new Error('governed call unavailable') }
  expect((await runVerification(f.host, f.candidate, f.snapshot, f.definitions)).outcome).toBe('unavailable')
})

test('scope, candidate identity, revision and requirements changes are stale before dispatch', async () => {
  const f = await fixture()
  for (const snapshot of [{...f.snapshot, candidateId: 'other'}, {...f.snapshot, revision: 'f'.repeat(64)},
    {...f.snapshot, manifest: {...f.snapshot.manifest, checkIds: []}}]) {
    expect((await runVerification(f.host, f.candidate, snapshot, f.definitions)).outcome).toBe('stale')
  }
  for (const candidate of [{...f.candidate, files: ['artifact', 'context']}, {...f.candidate, contextFiles: []}, {...f.candidate, requirements: [{id: 'R', text: 'changed'}]}]) {
    expect((await runVerification(f.host, candidate, f.snapshot, f.definitions)).outcome).toBe('stale')
  }
  expect(f.calls.length).toBe(0)
})

test('current policy, reviewer, standing review/check and check-definition configuration changes invalidate the freeze', async () => {
  const f = await fixture()
  for (const patch of [{policyRevision: 'p2'}, {reviewerConfigurationId: 'new'}, {requireReview: false}, {requiredCheckIds: []}, {checkConfigurationHash: 'c'.repeat(64)}]) {
    const definitions = {...f.definitions, configuration: {...f.definitions.configuration, ...patch}}
    expect((await runVerification(f.host, f.candidate, f.snapshot, definitions)).outcome).toBe('stale')
  }
  expect((await runVerification(f.host, f.candidate, f.snapshot, {...f.definitions, checks: [{...CHECK, command: 'different'}]})).outcome).toBe('stale')
  expect(f.calls.length).toBe(0)
})

test('untrusted or absent required definitions and unsafe cwd prevent all check dispatch', async () => {
  const f = await fixture()
  expect((await runVerification(f.host, f.candidate, f.snapshot, {...f.definitions, source: 'project'} as any)).outcome).toBe('unavailable')
  expect(f.calls.length).toBe(0)
  const missing = await fixture('/repo', [])
  expect((await runVerification(missing.host, missing.candidate, missing.snapshot, missing.definitions)).outcome).toBe('unavailable')
  expect(missing.calls.length).toBe(0)
  const unsafe = await fixture('/repo', [{...CHECK, cwd: 'outside'}])
  unsafe.dirs.add('/elsewhere')
  unsafe.links.set('/repo/outside', '/elsewhere')
  expect((await runVerification(unsafe.host, unsafe.candidate, unsafe.snapshot, unsafe.definitions)).outcome).toBe('unavailable')
  expect(unsafe.calls.length).toBe(0)
})

test('covered artifact or context changes during checks are stale, never attached to the new revision', async () => {
  for (const path of ['artifact', 'context']) {
    const f = await fixture()
    f.duringCheck(() => f.files.set(`${f.root}/${path}`, 'changed by check'))
    const result = await runVerification(f.host, f.candidate, f.snapshot, f.definitions)
    expect(result.outcome).toBe('stale')
    expect(result.checks[0]!.status).toBe('stale')
    expect(result.checks[0]!.revision).toBe(f.snapshot.revision)
    const current = await captureCandidate(f.host, f.candidate, f.definitions.configuration)
    ok(current.outcome === 'captured' && current.snapshot.revision !== result.revision)
    ok(Object.isFrozen(result.checks[0]))
  }
})

test('configuration changes during governed execution stale the recorded check evidence', async () => {
  const f = await fixture()
  f.duringCheck(() => { f.definitions.configuration.policyRevision = 'changed-during-check' })
  const result = await runVerification(f.host, f.candidate, f.snapshot, f.definitions)
  expect(result.outcome).toBe('stale')
  expect(result.checks[0]!.status).toBe('stale')
  expect(result.checks[0]!.revision).toBe(f.snapshot.revision)
})

test('uncovered check logs do not alter content evidence, but still cannot supply success status', async () => {
  const f = await fixture()
  f.duringCheck(() => f.files.set(`${f.root}/ignored.log`, 'test output'))
  expect((await runVerification(f.host, f.candidate, f.snapshot, f.definitions)).outcome).toBe('unavailable')
  const current = await captureCandidate(f.host, f.candidate, f.definitions.configuration)
  ok(current.outcome === 'captured')
  expect(current.snapshot.revision).toBe(f.snapshot.revision)
})

test('empty checks are explicit not-required evidence only when standing policy also requires none', async () => {
  const f = await fixture('/repo', [])
  const configuration = {...f.definitions.configuration, requiredCheckIds: [], trustedCheckIds: []}
  const candidate = {...f.candidate, checkIds: [], configuration}
  const capture = await captureCandidate(f.host, candidate, configuration)
  ok(capture.outcome === 'captured')
  const result = await runVerification(f.host, candidate, capture.snapshot, {...f.definitions, configuration})
  expect(result.outcome).toBe('not-required')
  expect(result.diagnostic).toBe('no executable checks were required')
  expect(result.checks).toEqual([])
  expect(f.calls.length).toBe(0)
})

test('pre-existing content changes and unresolvable covered paths cannot dispatch checks', async () => {
  const f = await fixture()
  f.files.set(`${f.root}/artifact`, 'edited before checkpoint')
  expect((await runVerification(f.host, f.candidate, f.snapshot, f.definitions)).outcome).toBe('stale')
  f.files.delete(`${f.root}/context`)
  expect((await runVerification(f.host, f.candidate, f.snapshot, f.definitions)).outcome).toBe('stale')
  expect(f.calls.length).toBe(0)
})

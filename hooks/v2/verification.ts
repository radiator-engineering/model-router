/** Governed, revision-bound checks with a nonce-bound shell completion protocol, never model PASS prose. */
import {isId, isObject} from './contract.ts'
import {artifactRoot, captureCandidate, freezeArtifact, relativeArtifactPath, resolveArtifactPath, sha256} from './artifacts.ts'
import type {ArtifactConfiguration, ArtifactFailure, ArtifactHost, EnrolledCandidate, FrozenSnapshot} from './artifacts.ts'

export interface VerificationHost extends ArtifactHost {
  tool: {call(input: {tool: 'Bash'; command: string; timeout: number}): Promise<unknown>}
}
export interface TrustedCheckDefinition {id: string; command: string; cwd: string; timeoutMs: number}
/** The adapter resolves user/managed-policy precedence and observable provenance before supplying this value. */
export interface TrustedCheckDefinitions {
  schemaVersion: 1
  source: 'user' | 'managed-policy'
  checks: readonly TrustedCheckDefinition[]
}
export interface VerificationDefinitions extends TrustedCheckDefinitions {
  /** Current trusted configuration, not the old frozen configuration. */
  configuration: ArtifactConfiguration
}
export type CheckStatus = 'failed' | 'denied' | 'timeout' | 'interrupted' | 'unavailable' | 'stale' | 'passed'
export interface ExecutedCheck {
  checkId: string
  configurationHash: string
  candidateId: string
  revision: string
  command: string
  startedAt: string
  endedAt: string
  status: CheckStatus
  completion: {
    isError: boolean | null
    interrupted: boolean | null
    backgroundTaskId: string | null
    timedOutAfterMs: number | null
    /** Captured only from our matching terminal receipt; raw result.exitCode is never trusted. */
    exitCode: number | null
    stdout: string | null
    stderr: string | null
  }
}
export interface VerificationOutcome {
  outcome: 'passed' | 'not-required' | 'failed' | 'unavailable' | 'stale'
  candidateId: string
  revision: string
  checks: readonly ExecutedCheck[]
  diagnostic: string
}

/** Fixed-key normalized check configuration; origin is part of its security digest. */
export async function normalizeTrustedChecks(input: unknown): Promise<{outcome: 'valid'; definitions: TrustedCheckDefinitions; configurationHash: string} | ArtifactFailure> {
  try {
    if (!isObject(input) || input.schemaVersion !== 1 || !['user', 'managed-policy'].includes(input.source as string) || !Array.isArray(input.checks)) throw new Error('check definitions require observable user or managed-policy provenance')
    const checks = input.checks.map(value => {
      if (!isObject(value) || Object.keys(value).some(key => !['id', 'command', 'cwd', 'timeoutMs'].includes(key)) || !isId(value.id) ||
          typeof value.command !== 'string' || !value.command.trim() || value.command.includes('\0') || !Number.isInteger(value.timeoutMs) || (value.timeoutMs as number) < 1 || (value.timeoutMs as number) > 600000) throw new Error('invalid trusted check definition')
      return {id: value.id, command: value.command, cwd: relativeArtifactPath(value.cwd, true), timeoutMs: value.timeoutMs as number}
    }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
    if (new Set(checks.map(check => check.id)).size !== checks.length) throw new Error('duplicate trusted check ID')
    const definitions: TrustedCheckDefinitions = {schemaVersion: 1, source: input.source as TrustedCheckDefinitions['source'], checks}
    return {outcome: 'valid', definitions: freezeArtifact(definitions), configurationHash: await sha256(new TextEncoder().encode(JSON.stringify(definitions)))}
  } catch (error) { return {outcome: 'unavailable', diagnostic: error instanceof Error ? error.message : 'invalid trusted check configuration'} }
}
export function quoteCheckDirectory(path: string): string { return `'${path.replace(/'/g, `'\\''`)}'` }
function sameSnapshot(current: FrozenSnapshot, frozen: FrozenSnapshot): boolean {
  return current.candidateId === frozen.candidateId && current.revision === frozen.revision && JSON.stringify(current.manifest) === JSON.stringify(frozen.manifest)
}
function completionOf(raw: unknown, marker: string): {status: CheckStatus; completion: ExecutedCheck['completion']} {
  const result = isObject(raw) && isObject(raw.result) ? raw.result : {}
  const completion: ExecutedCheck['completion'] = {
    isError: isObject(raw) && typeof raw.isError === 'boolean' ? raw.isError : null,
    interrupted: typeof result.interrupted === 'boolean' ? result.interrupted : null,
    backgroundTaskId: typeof result.backgroundTaskId === 'string' ? result.backgroundTaskId : null,
    timedOutAfterMs: typeof result.timedOutAfterMs === 'number' && Number.isFinite(result.timedOutAfterMs) ? result.timedOutAfterMs : null,
    exitCode: null,
    stdout: typeof result.stdout === 'string' ? result.stdout : null,
    stderr: typeof result.stderr === 'string' ? result.stderr : null,
  }
  if (isObject(raw) && typeof raw.deny === 'string') return {status: 'denied', completion}
  if (completion.timedOutAfterMs !== null) return {status: 'timeout', completion}
  if (completion.interrupted === true) return {status: 'interrupted', completion}
  if (completion.backgroundTaskId !== null || result.backgroundedByUser === true || result.backgroundedByTurnAbort === true || result.backgroundedToDeliverMessage === true) return {status: 'unavailable', completion}
  if (completion.isError === true) return {status: 'failed', completion}
  // The generated wrapper, not the check's prose or an extra result.exitCode, supplies this nonce.
  const last=completion.stdout?.trimEnd().split('\n').at(-1)
  const prefix=marker+':'
  if(last?.startsWith(prefix)&&/^\d{1,3}$/.test(last.slice(prefix.length))&&completion.interrupted===false){
    const code=Number(last.slice(prefix.length))
    if(code<=255){completion.exitCode=code;return {status:code===0?'passed':'failed',completion}}
  }
  return {status: 'unavailable', completion}
}

export async function runVerification($: VerificationHost, candidate: EnrolledCandidate, frozenSnapshot: FrozenSnapshot, trustedDefinitions: VerificationDefinitions): Promise<VerificationOutcome> {
  const checks: ExecutedCheck[] = []
  const base = {candidateId: candidate.id, revision: frozenSnapshot.revision, checks}
  try {
    const normalized = await normalizeTrustedChecks(trustedDefinitions)
    if (normalized.outcome !== 'valid') return {...base, outcome: 'unavailable', diagnostic: normalized.diagnostic}
    const configuration = trustedDefinitions.configuration
    if (normalized.configurationHash !== configuration.checkConfigurationHash) return {...base, outcome: 'stale', diagnostic: 'trusted check configuration changed'}
    let current = await captureCandidate($, candidate, configuration)
    if (current.outcome !== 'captured' || !sameSnapshot(current.snapshot, frozenSnapshot)) return {...base, outcome: 'stale', diagnostic: 'candidate scope, content or configuration changed before checking'}
    const root = await artifactRoot($, configuration.repositoryRoot)
    const selected: {definition: TrustedCheckDefinition; command: string}[] = []
    // Validate the complete selection before executing any check.
    for (const id of frozenSnapshot.manifest.checkIds) {
      const definition = normalized.definitions.checks.find(check => check.id === id)
      if (!definition) return {...base, outcome: 'unavailable', diagnostic: `required trusted check unavailable: ${id}`}
      const cwd = await resolveArtifactPath($, root, definition.cwd)
      if (!cwd.exists || cwd.kind !== 'dir') return {...base, outcome: 'unavailable', diagnostic: 'check working directory must exist inside repository'}
      selected.push({definition, command: `cd ${quoteCheckDirectory(cwd.absolute)} && ${definition.command}`})
    }
    if (!selected.length) return freezeArtifact({...base, outcome: 'not-required', diagnostic: 'no executable checks were required'})
    for (const {definition, command} of selected) {
      current = await captureCandidate($, candidate, configuration)
      if (current.outcome !== 'captured' || !sameSnapshot(current.snapshot, frozenSnapshot)) return freezeArtifact({...base, outcome: 'stale', diagnostic: 'candidate changed before check dispatch'})
      // Re-resolve cwd immediately before dispatch as symlinks may have moved since preparation.
      const cwd = await resolveArtifactPath($, root, definition.cwd)
      if (!cwd.exists || cwd.kind !== 'dir' || command !== `cd ${quoteCheckDirectory(cwd.absolute)} && ${definition.command}`) return freezeArtifact({...base, outcome: 'stale', diagnostic: 'check working directory changed'})
      const startedAt = new Date().toISOString()
      const marker=`__JEV_CHECK_${crypto.randomUUID()}__`
      // A child shell cannot replace the wrapper's status variable or skip its final receipt.
      const wrapped=`cd ${quoteCheckDirectory(cwd.absolute)} && /bin/sh -c ${quoteCheckDirectory(definition.command)}; __jev_status=$?; printf '\\n${marker}:%s\\n' "$__jev_status"; exit "$__jev_status"`
      let raw: unknown
      try { raw = await $.tool.call({tool: 'Bash', command:wrapped, timeout: definition.timeoutMs}) }
      catch (error) { raw = {result: {}, context: error instanceof Error ? error.message : 'governed check did not return'} }
      const result = completionOf(raw,marker)
      const check: ExecutedCheck = {checkId: definition.id, configurationHash: normalized.configurationHash, candidateId: candidate.id,
        revision: frozenSnapshot.revision, command, startedAt, endedAt: new Date().toISOString(), ...result}
      checks.push(check)
      current = await captureCandidate($, candidate, configuration)
      if (current.outcome !== 'captured' || !sameSnapshot(current.snapshot, frozenSnapshot)) {
        check.status = 'stale'
        return freezeArtifact({...base, outcome: 'stale', diagnostic: 'covered artifact, context or configuration changed during checking'})
      }
      // Stop on the first unsuccessful/unknown required check; no repair or review is authorized here.
      if(result.status!=='passed')return freezeArtifact({...base, outcome: result.status === 'failed' ? 'failed' : 'unavailable', diagnostic: result.status==='unavailable'?'Matching terminal shell receipt unavailable':`required check ${result.status}`})
    }
    return freezeArtifact({...base, outcome: 'passed', diagnostic: 'all required checks have matching terminal shell receipts'})
  } catch (error) {
    return freezeArtifact({...base, outcome: 'unavailable', diagnostic: error instanceof Error ? error.message : 'verification unavailable'})
  }
}

/** Explicit candidate enrollment and byte-bound revisions. No storage or acceptance authority. */
import {isId, isObject} from './contract.ts'

export interface ArtifactHost {
  fs: {
    stat(path: string, options: {resolve: true}): Promise<{kind: 'file' | 'dir' | 'other'; isLink: boolean; realPath?: string}>
    read(path: string, options: {as: 'bytes'}): Promise<{base64: string}>
    list(path: string): Promise<{name: string; isLink: boolean}[]>
  }
  process: {run(argv: string[], options: {cwd: string; timeoutMs: number; env?: Record<string, string>}): Promise<{exitCode: number; stdout: string; stderr: string}>}
}
/** Already verified by the composer/coordinator adapter, never parsed from manifest data. */
export interface EnrollmentAuthorization {
  source: 'composer' | 'coordinator'
  verified: true
  authorizationRef: string
  assignmentId: string
  lineageId: string
}
export interface ArtifactConfiguration {
  repositoryRoot: string
  policyRevision: string
  reviewerConfigurationId: string
  checkConfigurationHash: string
  requiredCheckIds: readonly string[]
  requireReview: boolean
  /** Supplied by the trusted check resolver, not by the candidate manifest. */
  trustedCheckIds: readonly string[]
}
export interface ArtifactRequirement {id: string; text: string}
export interface EnrolledCandidate {
  id: string
  baseCommit: string
  files: readonly string[]
  contextFiles: readonly string[]
  requirements: readonly ArtifactRequirement[]
  checkIds: readonly string[]
  requireReview: boolean
  authorization: EnrollmentAuthorization
  configuration: ArtifactConfiguration
}
export interface RevisionManifest {
  schemaVersion: 1
  baseCommit: string
  files: readonly {path: string; sha256: string | null}[]
  contextFiles: readonly {path: string; sha256: string | null}[]
  requirements: readonly ArtifactRequirement[]
  checkIds: readonly string[]
  requireReview: boolean
  configuration: {
    repositoryRoot: string
    policyRevision: string
    reviewerConfigurationId: string
    checkConfigurationHash: string
    requiredCheckIds: readonly string[]
    requireReview: boolean
  }
}
export interface FrozenSnapshot {candidateId: string; revision: string; manifest: RevisionManifest}
export type ArtifactFailure = {outcome: 'clarify' | 'unavailable'; diagnostic: string}
export type EnrollmentOutcome = {outcome: 'enrolled'; candidate: EnrolledCandidate} | ArtifactFailure
export type CaptureOutcome = {outcome: 'captured'; snapshot: FrozenSnapshot} | ArtifactFailure

const sorted = (values: readonly string[]) => [...new Set(values)].sort()
const ids = (value: unknown): value is string[] => Array.isArray(value) && value.every(isId)
const failure = (error: unknown): ArtifactFailure => ({outcome: 'unavailable', diagnostic: error instanceof Error ? error.message : 'artifact capture unavailable'})

/** Canonical insertion order is defined by RevisionManifest; bytes are never decoded as text for hashing. */
export async function sha256(bytes: Uint8Array): Promise<string> {
  const input = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(input).set(bytes)
  const digest = await crypto.subtle.digest('SHA-256', input)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}
export function freezeArtifact<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeArtifact(child)
    Object.freeze(value)
  }
  return value
}
function decode(base64: string): Uint8Array {
  return Uint8Array.from(atob(base64), char => char.charCodeAt(0))
}
/** POSIX repository-relative literal paths only; aliases such as ./a are normalized. */
export function relativeArtifactPath(value: unknown, directory = false): string {
  if (typeof value !== 'string' || !value || /^[~\/]/.test(value) || /^[A-Za-z]:/.test(value) || /[\\\x00-\x1f\x7f*?\[\]{}]/.test(value)) throw new Error('invalid explicit repository path')
  const pieces = value.split('/')
  if (pieces.includes('..')) throw new Error('path traversal is forbidden')
  const path = pieces.filter(piece => piece && piece !== '.').join('/')
  if (!path && !directory) throw new Error('artifact path must name a file')
  return path || '.'
}
function inside(root: string, path: string): boolean { return path === root || path.startsWith(`${root}/`) }
export async function artifactRoot($: ArtifactHost, path: string): Promise<string> {
  if (!path.startsWith('/') || /[\x00-\x1f\x7f]/.test(path)) throw new Error('repository root must be an absolute local directory')
  const stat = await $.fs.stat(path, {resolve: true})
  if (stat.kind !== 'dir' || !stat.realPath?.startsWith('/')) throw new Error('repository root cannot be resolved')
  return stat.realPath.replace(/\/$/, '') || '/'
}
/** Walk each ancestor, including missing entries, so dangling links never masquerade as deletions. */
export async function resolveArtifactPath($: ArtifactHost, root: string, path: string): Promise<{path: string; absolute: string; exists: boolean; kind: string}> {
  const pieces = relativeArtifactPath(path, true).split('/').filter(piece => piece !== '.')
  let absolute = root
  for (let index = 0; index < pieces.length; index++) {
    const parent = absolute
    absolute = `${parent}/${pieces[index]}`
    let stat
    try { stat = await $.fs.stat(absolute, {resolve: true}) } catch {
      // A failed stat alone cannot distinguish a missing file from a dangling link or denied read.
      const entries = await $.fs.list(parent)
      if (entries.some(entry => entry.name === pieces[index])) throw new Error('unresolvable or dangling path')
      absolute += pieces.slice(index + 1).map(piece => `/${piece}`).join('')
      return {path: absolute.slice(root.length + 1), absolute, exists: false, kind: 'missing'}
    }
    if (!stat.realPath || !inside(root, stat.realPath)) throw new Error('path resolves outside repository or is dangling')
    absolute = stat.realPath
    if (index < pieces.length - 1 && stat.kind !== 'dir') throw new Error('path ancestor is not a directory')
    if (index === pieces.length - 1) return {path: absolute.slice(root.length + 1), absolute, exists: true, kind: stat.kind}
  }
  return {path: '.', absolute: root, exists: true, kind: 'dir'}
}
async function git($: ArtifactHost, root: string, args: string[]): Promise<{exitCode: number; stdout: string; stderr: string}> {
  return $.process.run(['git', ...args], {cwd: root, timeoutMs: 10000, env: {GIT_NO_LAZY_FETCH: '1', GIT_OPTIONAL_LOCKS: '0'}})
}
function validConfiguration(configuration: ArtifactConfiguration): void {
  if (!isObject(configuration) || !isId(configuration.repositoryRoot) || !isId(configuration.policyRevision) || !isId(configuration.reviewerConfigurationId) ||
      !/^[a-f0-9]{64}$/.test(configuration.checkConfigurationHash) || !ids(configuration.requiredCheckIds) || !ids(configuration.trustedCheckIds) || typeof configuration.requireReview !== 'boolean') throw new Error('invalid trusted artifact configuration')
}
async function scopePaths($: ArtifactHost, root: string, paths: readonly string[], baseCommit: string, context: boolean): Promise<string[]> {
  const resolved: string[] = []
  for (const path of paths) {
    const entry = await resolveArtifactPath($, root, path)
    if (entry.exists && entry.kind !== 'file') throw new Error('scope must contain regular files')
    if (!entry.exists) {
      if (context) throw new Error('context file must exist')
      const base = await git($, root, ['cat-file', '-t', `${baseCommit}:${entry.path}`])
      if (base.exitCode !== 0 || base.stdout.trim() !== 'blob') throw new Error('artifact is absent from both working tree and base')
    }
    resolved.push(entry.path)
  }
  return sorted(resolved)
}
function normalizedRequirements(requirements: readonly ArtifactRequirement[]): ArtifactRequirement[] {
  if (!Array.isArray(requirements) || !requirements.length) throw new Error('nonempty requirements are required')
  const normalized = requirements.map(requirement => {
    if (!isObject(requirement) || !isId(requirement.id) || typeof requirement.text !== 'string' || !requirement.text.trim()) throw new Error('requirement IDs and text must be nonempty')
    return {id: requirement.id, text: requirement.text.trim()}
  }).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  if (new Set(normalized.map(requirement => requirement.id)).size !== normalized.length) throw new Error('duplicate requirement ID')
  return normalized
}

export async function enrollCandidate($: ArtifactHost, manifestPath: string, authorization: EnrollmentAuthorization, configuration: ArtifactConfiguration): Promise<EnrollmentOutcome> {
  if (!authorization || authorization.verified !== true || !['composer', 'coordinator'].includes(authorization.source) ||
      ![authorization.authorizationRef, authorization.assignmentId, authorization.lineageId].every(isId)) return {outcome: 'unavailable', diagnostic: 'verified composer/coordinator enrollment authorization required'}
  if (!manifestPath) return {outcome: 'clarify', diagnostic: 'select an explicit candidate manifest'}
  try {
    validConfiguration(configuration)
    const root = await artifactRoot($, configuration.repositoryRoot)
    const path = await resolveArtifactPath($, root, manifestPath)
    if (!path.exists || path.kind !== 'file') throw new Error('candidate manifest must exist')
    const value: unknown = JSON.parse(new TextDecoder('utf-8').decode(decode((await $.fs.read(path.absolute, {as: 'bytes'})).base64)))
    if (!isObject(value)) throw new Error('candidate manifest must be an object')
    const allowed = ['schemaVersion', 'baseRevision', 'files', 'contextFiles', 'requirements', 'checkIds', 'requireReview']
    if (Object.keys(value).some(key => !allowed.includes(key))) throw new Error('candidate manifest contains unsupported fields; data cannot grant authority')
    if (value.schemaVersion !== 1 || !isId(value.baseRevision) || !ids(value.contextFiles) || !ids(value.checkIds) || typeof value.requireReview !== 'boolean') throw new Error('invalid candidate manifest')
    if (!Array.isArray(value.files) || !value.files.length || !Array.isArray(value.requirements) || !value.requirements.length) return {outcome: 'clarify', diagnostic: 'select nonempty artifact files and requirements'}
    if (!ids(value.files)) throw new Error('invalid artifact file selection')
    const requirements = normalizedRequirements(value.requirements as ArtifactRequirement[])
    const checkIds = sorted([...configuration.requiredCheckIds, ...value.checkIds])
    if (checkIds.some(id => !configuration.trustedCheckIds.includes(id))) throw new Error('required trusted check is unavailable')
    const base = await git($, root, ['rev-parse', '--verify', '--end-of-options', `${value.baseRevision}^{commit}`])
    const baseCommit = base.stdout.trim()
    if (base.exitCode !== 0 || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(baseCommit)) throw new Error('base revision is not a local commit')
    const files = await scopePaths($, root, value.files, baseCommit, false)
    const contextFiles = await scopePaths($, root, value.contextFiles, baseCommit, true)
    return {outcome: 'enrolled', candidate: freezeArtifact({id: `cand_${crypto.randomUUID()}`, baseCommit, files, contextFiles, requirements, checkIds,
      requireReview: configuration.requireReview || value.requireReview, authorization: {...authorization},
      configuration: {...configuration, repositoryRoot: root, requiredCheckIds: sorted(configuration.requiredCheckIds), trustedCheckIds: sorted(configuration.trustedCheckIds)}})}
  } catch (error) { return failure(error) }
}
async function contentEntries($: ArtifactHost, root: string, paths: readonly string[], baseCommit: string, context: boolean): Promise<{path: string; sha256: string | null}[]> {
  const entries: {path: string; sha256: string | null}[] = []
  for (const path of paths) {
    const entry = await resolveArtifactPath($, root, path)
    if (entry.path !== path) throw new Error('enrolled path resolution changed')
    if (!entry.exists) {
      if (context) throw new Error('context file must exist')
      const base = await git($, root, ['cat-file', '-t', `${baseCommit}:${path}`])
      if (base.exitCode !== 0 || base.stdout.trim() !== 'blob') throw new Error('artifact is absent from both working tree and base')
    } else if (entry.kind !== 'file') throw new Error('enrolled scope is not a regular file')
    const hash = entry.exists ? await sha256(decode((await $.fs.read(entry.absolute, {as: 'bytes'})).base64)) : null
    // Detect a link retarget during the read; the host has no atomic no-follow read primitive.
    const after = await resolveArtifactPath($, root, path)
    if (after.path !== path || after.exists !== entry.exists || after.kind !== entry.kind) throw new Error('enrolled path changed during capture')
    entries.push({path, sha256: hash})
  }
  return entries
}

export async function captureCandidate($: ArtifactHost, candidate: EnrolledCandidate, configuration: ArtifactConfiguration): Promise<CaptureOutcome> {
  try {
    validConfiguration(configuration)
    if (!isId(candidate.id) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(candidate.baseCommit) || !ids(candidate.files) || !candidate.files.length || !ids(candidate.contextFiles) || !ids(candidate.checkIds) || typeof candidate.requireReview !== 'boolean') throw new Error('invalid enrolled candidate')
    const root = await artifactRoot($, configuration.repositoryRoot)
    if (root !== candidate.configuration.repositoryRoot) throw new Error('candidate repository root changed')
    const checkIds = sorted([...candidate.checkIds, ...configuration.requiredCheckIds])
    if (checkIds.some(id => !configuration.trustedCheckIds.includes(id))) throw new Error('required trusted check is unavailable')
    const manifest: RevisionManifest = {
      schemaVersion: 1, baseCommit: candidate.baseCommit,
      files: await contentEntries($, root, sorted(candidate.files), candidate.baseCommit, false),
      contextFiles: await contentEntries($, root, sorted(candidate.contextFiles), candidate.baseCommit, true),
      requirements: normalizedRequirements(candidate.requirements), checkIds,
      requireReview: candidate.requireReview || configuration.requireReview,
      configuration: {repositoryRoot: root, policyRevision: configuration.policyRevision, reviewerConfigurationId: configuration.reviewerConfigurationId,
        checkConfigurationHash: configuration.checkConfigurationHash, requiredCheckIds: sorted(configuration.requiredCheckIds), requireReview: configuration.requireReview},
    }
    const revision = await sha256(new TextEncoder().encode(JSON.stringify(manifest)))
    return {outcome: 'captured', snapshot: freezeArtifact({candidateId: candidate.id, revision, manifest})}
  } catch (error) { return failure(error) }
}

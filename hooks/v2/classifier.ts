/**
 * V2 classifier adapter: dimension questions and response normalization.
 * Separate from the legacy request, which stays byte-for-byte unchanged.
 * Jev names no models and grants no permissions; missing or invalid answers
 * become `unknown` with null confidence, never confident low-demand values.
 */
import type {Provider} from '../policy.ts'
import {OBSERVATION_KEYS, allowedValues, isConfidence, isObject} from './contract.ts'
import type {ClassifierInput, ClassifierOutput, ObservationKey} from './contract.ts'

const UNKNOWN = 'The supplied text does not establish this.'
const CRITERIA: Record<ObservationKey, Record<string, string>> = {
  role: {
    orchestration: 'Decompose, coordinate, delegate or reconcile work across agents.',
    'visual-analysis': 'Interpret screenshots, visual references or rendered layouts.',
    'file-scout': 'Locate files or gather paths/snippets without interpreting the system.',
    implementation: 'Create a plan, design or architecture, or change code.',
    investigation: 'Determine an unknown cause or understand interacting systems.',
    review: 'Independently evaluate work for defects or verify its behavior.',
    'simple-answer': 'Give a short literal answer from supplied or stable facts, or a brief standalone social reply to a greeting or thanks. No teaching, investigation or task execution; short messages alone are not simple answers.',
    explanation: 'Teach or explain concepts, causes, comparisons or tradeoffs, or summarize.',
    unknown: UNKNOWN,
  },
  specification: {
    explicit: 'Required behavior, inputs and acceptance are stated.',
    inferable: 'Required behavior follows from supplied references or established patterns.',
    unresolved: 'A material requirement or decision (for example authorization, compatibility or data handling) is missing and changes what must be built.',
    unknown: UNKNOWN,
  },
  verification: {
    executable: 'Correctness is established by named or obvious executable checks.',
    partial: 'Some behavior can be checked automatically; important parts cannot.',
    judgment: 'Correctness depends mainly on human or expert judgment.',
    unknown: UNKNOWN,
  },
  executionSpan: {
    bounded: 'One local change or answer with no dependent steps.',
    'dependent-steps': 'Several steps where later steps depend on earlier results.',
    extended: 'Crosses components or requires extended exploration and coordination.',
    unknown: UNKNOWN,
  },
  consequence: {
    reversible: 'Mistakes stay local and are easily reverted.',
    consequential: 'Carrying out the task could change production, real money, security boundaries or unrestorable data.',
    unknown: UNKNOWN,
  },
}
const INSTRUCTIONS: Record<ObservationKey, string> = {
  role: 'What kind of assignment is this? Classify the assignment itself, not its subject vocabulary. A standalone greeting or thanks is simple-answer. Approvals, confirmations and requests to continue prior work are not social replies; classify the underlying work when supplied, otherwise unknown. Do not infer simplicity from brevity.',
  specification: 'How completely is the required behavior specified?',
  verification: 'How strongly can a correct result be verified?',
  executionSpan: 'How long and interdependent is the work needed to respond? A brief standalone social reply to a greeting or thanks is bounded even when no coding task is requested. A continuation or approval with unspecified prior work is unknown, not bounded just because its text is short.',
  consequence: 'What is the effect of carrying out this task incorrectly?',
}

/** Questions for a separate, opt-in v2 classifier call. */
export function v2Questions(): Record<string, unknown> {
  return Object.fromEntries(OBSERVATION_KEYS.map(k => [k, {type: 'choice', instructions: INSTRUCTIONS[k], criteria: {...CRITERIA[k]}}]))
}

/** Request body; the Gateway carries the model in a header (legacy `requestHeaders`). */
export function v2RequestBody(provider: Provider, input: ClassifierInput, model: string): string {
  const state = input.context === undefined ? {prompt: input.prompt} : {prompt: input.prompt, context: input.context}
  return JSON.stringify(provider === 'typesafe' ? {model, state, questions: v2Questions()} : {state, questions: v2Questions()})
}

/**
 * The choice's own confidence. A reported but invalid confidence is not
 * rescued from probabilities; probabilities count only when they are all
 * valid and the chosen value is their unique maximum.
 */
function confidenceOf(answer: Record<string, unknown>, choice: string, valuesAllowed: readonly string[]): number | null {
  if ('confidence' in answer) return isConfidence(answer.confidence) ? answer.confidence : null
  const p = answer.probabilities
  if (!isObject(p)) return null
  const values = Object.values(p)
  if (!values.length || !values.every(isConfidence) || !isConfidence(p[choice]) || !Object.keys(p).every(k => valuesAllowed.includes(k))) return null
  if (Math.abs(values.reduce((sum, v) => sum + v, 0) - 1) > 1e-6) return null
  const chosen = p[choice] as number
  return values.filter(v => v >= chosen).length === 1 ? chosen : null
}

/**
 * Normalize a TypeSafe or Gateway response. Returns null when the response is
 * unreadable or answers none of the v2 dimensions (for example a legacy
 * tier-only answer), which the policy treats as `classification_invalid`.
 */
export function normalizeV2Response(text: string): ClassifierOutput | null {
  let parsed: unknown
  try { parsed = JSON.parse(text) } catch { return null }
  const answers = isObject(parsed) ? parsed.answers : null
  if (!isObject(answers) || !OBSERVATION_KEYS.some(k => k in answers)) return null
  const out: Record<string, {value: string; confidence: number | null}> = {}
  for (const key of OBSERVATION_KEYS) {
    const a = answers[key]
    const choice = isObject(a) && typeof a.choice === 'string' && allowedValues(key).includes(a.choice) ? a.choice : 'unknown'
    out[key] = {value: choice, confidence: choice === 'unknown' || !isObject(a) ? null : confidenceOf(a, choice, allowedValues(key))}
  }
  return out as unknown as ClassifierOutput
}

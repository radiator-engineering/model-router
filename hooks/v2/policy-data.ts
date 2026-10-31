/**
 * Versioned v2 policy data. Rules state workload hypotheses from the decision
 * contract (§5); they grant nothing by themselves. A configuration becomes
 * automatically selectable only when the catalog also holds a fresh verified
 * availability observation, compatibility for the exact environment/path and a
 * workload approval naming the rule. The migrated catalog holds none of those,
 * so this policy currently yields `unavailable` for matched automatic work.
 */
import type {Dimension, Purpose, TaskRole} from './contract.ts'

export interface WorkloadRule {
  id: string
  /** Higher wins. Overlapping rules at the same priority make the policy invalid. */
  priority: number
  purpose: Purpose
  roles: TaskRole[]
  /** Required observation values; every named observation must meet the threshold. */
  when: Partial<Record<Dimension, string[]>>
  /** Permitted primary configuration IDs. Membership grants no fallback permission. */
  primary: string[]
  /** Configured workload preference within `primary`, or null. */
  preference: string | null
}
export interface PolicyData {
  policyRevision: string
  contractVersion: 3
  /** Provisional per-field threshold (decision contract §5); not a calibrated claim. */
  confidenceThreshold: number
  /** Soft provider preference, most preferred first. */
  providerPreference: string[]
  /** Confident observations that mean a material decision is missing. */
  clarifyWhen: {specification: string[]}
  /** Confident observations that recommend (never require) review. */
  reviewTriggers: {id: string; when: Partial<Record<Dimension, string[]>>}[]
  rules: WorkloadRule[]
  /** Context margin/reserve for explicit manual selections; null means fit cannot be established. */
  manualLimits: {contextMarginFraction: number | null; outputReserveTokens: number | null}
}

const config = (model: string, level: string) => `configuration/${model}/level-${level}/unknown`

export const POLICY: PolicyData = {
  policyRevision: 'v2-policy-2026-10-31.1',
  contractVersion: 3,
  confidenceThreshold: 0.8,
  providerPreference: ['anthropic'],
  clarifyWhen: {specification: ['unresolved']},
  reviewTriggers: [{id: 'consequential-effect', when: {consequence: ['consequential']}}],
  rules: [
    {id: 'mechanical-exact', priority: 40, purpose: 'execution', roles: ['implementation', 'file-scout', 'simple-answer'],
      when: {specification: ['explicit'], verification: ['executable'], executionSpan: ['bounded']},
      primary: [config('claude-haiku-5-5', 'medium')], preference: null},
    {id: 'broad-or-orchestration', priority: 30, purpose: 'execution', roles: ['orchestration', 'investigation', 'implementation'],
      when: {executionSpan: ['extended']},
      primary: [config('claude-opus-5-5', 'medium')], preference: null},
    {id: 'visual-specialist', priority: 30, purpose: 'execution', roles: ['visual-analysis'], when: {},
      primary: [config('gpt-6-astra', 'medium')], preference: null},
    {id: 'specified-execution', priority: 20, purpose: 'execution', roles: ['implementation'],
      when: {specification: ['explicit', 'inferable'], verification: ['executable', 'partial']},
      primary: [config('claude-sonnet-5-5', 'medium')], preference: null},
    {id: 'orchestration', priority: 10, purpose: 'execution', roles: ['orchestration'], when: {},
      primary: [config('claude-opus-5-5', 'medium')], preference: null},
  ],
  // Unknown until measured; explicit pins cannot establish context fit yet.
  manualLimits: {contextMarginFraction: null, outputReserveTokens: null},
}

import type {ModelIdentity} from './model-catalog.ts'
import {requestModelId} from './policy.ts'

export const PROVIDER_PRESETS = ['mixed', 'claude', 'gpt'] as const
export type ProviderPreset = typeof PROVIDER_PRESETS[number]

export function isProviderPreset(value: unknown): value is ProviderPreset {
  return PROVIDER_PRESETS.some(preset => preset === value)
}

const CLAUDE_TIERS = ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']
const GPT_TIERS = ['gpt-6-luna', 'gpt-6.1-terra', 'gpt-6-astra']

/** Keep known same-provider preferences. Translate other defaults by their role's tier. */
export function presetModel(
  model: string,
  defaultModel: string,
  preset: ProviderPreset,
  models: readonly ModelIdentity[],
): string {
  if (preset === 'mixed') return model
  const provider = preset === 'claude' ? 'anthropic' : 'openai'
  const enabledForProvider = (id: string) => models.some(entry => entry.id === id && entry.provider === provider && entry.enabled)
  const preferred = requestModelId(model)
  if (enabledForProvider(preferred)) return preferred

  const defaultId = requestModelId(defaultModel)
  const tier = Math.max(CLAUDE_TIERS.indexOf(defaultId), GPT_TIERS.indexOf(defaultId))
  const replacement = (preset === 'claude' ? CLAUDE_TIERS : GPT_TIERS)[tier]
  return replacement && enabledForProvider(replacement) ? replacement : ''
}

import type { Register } from 'claude-code'

export const register: Register = on => {
  const switches: unknown[] = []
  const completions: unknown[] = []

  on('prompt.submit', async ($, e, next) => {
    if (e.text === 'BLOCK') return { drop: 'policy unavailable' }
    if (e.text === 'THROW') throw new Error('probe failure')
    return next(e)
  }).catch(() => ({ drop: 'policy error; request held' }))

  on('turn.step', async function* ($, e, next) {
    if (e.model === 'throwing-guard') throw new Error('step guard failure')
    if (e.model === 'blocked-model') {
      yield { kind: 'text', index: 0, text: 'Request held by policy.' }
      yield { kind: 'stop', stopReason: 'end_turn', usage: null }
      return { turnId: e.turnId, index: e.index, answer: 'Request held by policy.', toolUses: [], stopReason: 'end_turn', usage: null }
    }
    return yield* next({ ...e, model: 'claude-opus-5-5', effort: 'medium' })
  }).catch(async function* ($, e) {
    yield { kind: 'text', index: 0, text: 'Request held after guard error.' }
    yield { kind: 'stop', stopReason: 'end_turn', usage: null }
    return { turnId: e.turnId, index: e.index, answer: 'Request held after guard error.', toolUses: [], stopReason: 'end_turn', usage: null }
  })

  on('agent.spawn', ($, e, next) => e.description === 'BLOCK' ? { deny: 'review unavailable' } : next(e))

  on('classic.PostModelSwitch', ($, e, next) => {
    switches.push({ source: e.source, requested: e.requested_model, model: e.to_model })
    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId) completions.push({ agentId: e.agentId, answer: e.answer, reason: e.reason })
    return next(e)
  })

  on('command.run', { command: 'probe-state' }, () => ({ text: JSON.stringify({ switches, completions }) }))

  on('session.start', async ($, e, next) => {
    await $.agent.register({ name: 'reviewer', description: 'Inspect an artifact', prompt: 'Review the supplied artifact.', tools: ['Read', 'Grep', 'Glob'], model: 'opus', effort: 'medium', maxTurns: 4, omitClaudeMd: true })
    return next(e)
  })
}

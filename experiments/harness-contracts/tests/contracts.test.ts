import { expect, test } from 'claude-code/testing'

const step = { turnId: 't1', index: 0, model: 'sonnet', effort: 'low' as const, messageCount: 1 }
const state = { command: 'probe-state', args: '', origin: { kind: 'composer' as const }, presentation: { isFullscreen: false, columns: 80 } }
const spawn = { tool_use_id: 'tool1', prompt: 'Review this diff', description: 'BLOCK', subagentType: 'general-purpose', provider: { plugin: 'engine', tier: 'core' as const }, parentModel: 'opus', background: false, fork: false }
async function drain(stream: AsyncGenerator<any, any>) {
  const chunks: unknown[] = []
  while (true) {
    const item = await stream.next()
    if (item.done) return { chunks, result: item.value }
    chunks.push(item.value)
  }
}

test('main request model and effort reach the next hook', async ($, on) => {
  let received: any
  on('turn.step', async function* ($, e) {
    received = e
    yield { kind: 'stop', stopReason: 'end_turn', usage: null }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  await drain($.turn.step(step))
  expect(received.model).toBe('claude-opus-5-5')
  expect(received.effort).toBe('medium')
})

test('subagent request effort is rewritable at turn.step', async ($, on) => {
  let received: any
  on('turn.step', async function* ($, e) {
    received = e
    yield { kind: 'stop', stopReason: 'end_turn', usage: null }
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  await drain($.turn.step({ ...step, agentId: 'reviewer1' }))
  expect(received.agentId).toBe('reviewer1')
  expect(received.effort).toBe('medium')
})

test('synthetic turn response skips the downstream request', async ($, on) => {
  let calls = 0
  on('turn.step', async function* () { calls++; throw new Error('must not run') })
  const result = await drain($.turn.step({ ...step, model: 'blocked-model' }))
  expect(calls).toBe(0)
  expect(result.result.answer).toBe('Request held by policy.')
  expect(result.chunks.length).toBe(2)
})

test('prompt drop stops the downstream submission', async ($, on) => {
  let calls = 0
  on('prompt.submit', ($, e) => { calls++; return { text: e.text } })
  const result = await $.prompt.submit({ text: 'BLOCK', wait: false, origin: { kind: 'composer' } })
  expect(result.drop).toBe('policy unavailable')
  expect(calls).toBe(0)
})

test('streaming catch can hold a request before next runs', async ($, on) => {
  let calls = 0
  on('turn.step', async function* () { calls++; throw new Error('must not run') })
  const result = await drain($.turn.step({ ...step, model: 'throwing-guard' }))
  expect(calls).toBe(0)
  expect(result.result.answer).toBe('Request held after guard error.')
})

test('prompt catch fails closed after a thrown guard error', async ($, on) => {
  let calls = 0
  on('prompt.submit', ($, e) => { calls++; return { text: e.text } })
  const result = await $.prompt.submit({ text: 'THROW', wait: false, origin: { kind: 'composer' } })
  expect(result.drop).toBe('policy error; request held')
  expect(calls).toBe(0)
})

test('spawn denial prevents the downstream spawn', async ($, on) => {
  let calls = 0
  on('agent.spawn', () => { calls++; return { model: 'opus', agentId: 'must-not-start' } })
  expect((await $.agent.spawn(spawn)).deny).toBe('review unavailable')
  expect(calls).toBe(0)
})

test('classic model-switch source is visible to a mod', async ($, on) => {
  on('classic.PostModelSwitch', () => ({}))
  await $.classic.PostModelSwitch({ from_model: 'sonnet', to_model: 'opus', requested_model: 'opus', source: 'picker', context_tokens: 0, prompt_cache_warm: false, cache_ttl: '5m', estimated_cache_write_usd: 0, pricing: 'catalog' })
  const result = JSON.parse((await $.command.run(state)).text!)
  expect(result.switches[0].source).toBe('picker')
  expect(result.switches[0].requested).toBe('opus')
})

test('reviewer completion carries an agent id and answer', async ($, on) => {
  on('turn.complete', ($, e) => ({ text: e.answer }))
  await $.turn.complete({ turnId: 'review-turn', agentId: 'reviewer1', answer: 'No supported findings.', durationMs: 1, isAborted: false, reason: 'answer' })
  const result = JSON.parse((await $.command.run(state)).text!)
  expect(result.completions[0].agentId).toBe('reviewer1')
  expect(result.completions[0].answer).toBe('No supported findings.')
})

test('reviewer registration carries effort and tool restrictions', async ($, on) => {
  let received: any
  on('agent.register', ($, e) => { received = e; return { value: { agent: 'router-v2-harness-probe:reviewer' } } })
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect(received.effort).toBe('medium')
  expect(received.tools).toEqual(['Read', 'Grep', 'Glob'])
  expect(received.omitClaudeMd).toBe(true)
})

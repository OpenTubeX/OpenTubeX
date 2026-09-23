import assert from 'node:assert/strict'
import test from 'node:test'

import { PlayerScriptEvaluator } from '../../src/renderer/helpers/api/player-script-evaluator.js'

class FakeWorker extends EventTarget {
  requests = []
  terminated = false
  postMessage(data) { this.requests.push(data) }
  terminate() { this.terminated = true }
  reply(data) { this.dispatchEvent(new MessageEvent('message', { data })) }
}

test('matches concurrent requests and rejects errors without losing other replies', async () => {
  const worker = new FakeWorker()
  const evaluator = new PlayerScriptEvaluator(() => worker)
  const first = evaluator.evaluate('return 1')
  const second = evaluator.evaluate('throw Error()')
  const rejection = assert.rejects(second, /bad player/)
  worker.reply(null)
  worker.reply({ id: 999, result: 'unrelated' })
  worker.reply({ id: worker.requests[1].id, error: 'bad player' })
  worker.reply({ id: worker.requests[0].id, result: 1 })
  assert.equal(await first, 1)
  await rejection
  assert.equal(evaluator.requests.size, 0)
})

for (const event of ['error', 'messageerror', 'timeout']) {
  test(`recovers after worker ${event} and rejects all pending requests`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] })
    const workers = []
    const evaluator = new PlayerScriptEvaluator(() => {
      const worker = new FakeWorker()
      workers.push(worker)
      return worker
    })
    const first = assert.rejects(evaluator.evaluate('one'))
    const second = assert.rejects(evaluator.evaluate('two'))
    if (event === 'timeout') t.mock.timers.tick(30_000)
    else workers[0].dispatchEvent(new Event(event))
    await Promise.all([first, second])
    assert.equal(workers[0].terminated, true)
    assert.equal(evaluator.requests.size, 0)
    const next = evaluator.evaluate('next')
    workers[0].reply({ id: workers[1].requests[0].id, result: 'stale' })
    workers[1].reply({ id: workers[1].requests[0].id, result: 'recovered' })
    assert.equal(await next, 'recovered')
  })
}

test('rejects oversized player source before copying it to a worker', async () => {
  const worker = new FakeWorker()
  const evaluator = new PlayerScriptEvaluator(() => worker)
  const pending = evaluator.evaluate(' '.repeat(4 * 1024 * 1024 + 1))
  const rejection = assert.rejects(pending, /too large/)
  // Complete an incorrectly accepted request so the failing test leaves no timer.
  if (worker.requests.length) worker.reply({ id: worker.requests[0].id, result: null })
  await rejection
  assert.equal(worker.requests.length, 0)
  assert.equal(evaluator.requests.size, 0)
})

test('retries a QuickJS runtime abort in a fresh worker for all pending player scripts', async () => {
  const workers = []
  const evaluator = new PlayerScriptEvaluator(() => {
    const worker = new FakeWorker()
    workers.push(worker)
    return worker
  })
  const first = evaluator.evaluate('first')
  const second = evaluator.evaluate('second')
  workers[0].reply({
    id: workers[0].requests[0].id,
    error: 'RuntimeError: Aborted(Assertion failed: list_empty(&rt->gc_obj_list), at: ../../vendor/quickjs/quickjs.c,2036,JS_FreeRuntime)'
  })
  assert.equal(workers[0].terminated, true)
  assert.equal(workers.length, 2)
  assert.deepEqual(workers[1].requests.map(request => request.code), ['first', 'second'])
  for (const [index, result] of ['one', 'two'].entries()) {
    workers[1].reply({ id: workers[1].requests[index].id, result })
  }
  assert.deepEqual(await Promise.all([first, second]), ['one', 'two'])
  assert.equal(evaluator.requests.size, 0)
})

test('stops retrying after a second QuickJS runtime abort', async () => {
  const workers = []
  const evaluator = new PlayerScriptEvaluator(() => {
    const worker = new FakeWorker()
    workers.push(worker)
    return worker
  })
  const pending = assert.rejects(evaluator.evaluate('return 42'), /list_empty\(&rt->gc_obj_list\)/)
  const error = 'RuntimeError: Aborted(Assertion failed: list_empty(&rt->gc_obj_list), at: ../../vendor/quickjs/quickjs.c,2036,JS_FreeRuntime)'
  workers[0].reply({ id: workers[0].requests[0].id, error })
  workers[1].reply({ id: workers[1].requests[0].id, error })
  await pending
  assert.equal(workers.length, 2)
  assert.equal(workers[1].terminated, true)
  assert.equal(evaluator.requests.size, 0)
})

test('does not retry an ordinary player error containing the assertion text', async () => {
  const workers = []
  const evaluator = new PlayerScriptEvaluator(() => {
    const worker = new FakeWorker()
    workers.push(worker)
    return worker
  })
  const pending = evaluator.evaluate('throw Error()')
  workers[0].reply({ id: workers[0].requests[0].id, error: 'Error: Assertion failed: list_empty(&rt->gc_obj_list)' })
  if (workers[1]) workers[1].reply({ id: workers[1].requests[0].id, result: 42 })
  await assert.rejects(pending, /Assertion failed/)
  assert.equal(workers.length, 1)
  assert.equal(workers[0].terminated, false)
})

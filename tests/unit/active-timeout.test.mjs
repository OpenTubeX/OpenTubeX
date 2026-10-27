import { test } from 'node:test'
import assert from 'node:assert/strict'

import { setActiveTimeout } from '../../src/renderer/helpers/activeTimeout.js'
import { BackgroundJobClient } from '../../src/renderer/helpers/background-job-client.js'

// Only mobile builds count running time.
process.env.IS_CAPACITOR = 'true'

// Moving the clock alone leaves the next timer overdue, like a frozen app
// running its overdue timers once on resume.
function suspend(t, ms) {
  t.mock.timers.setTime(Date.now() + ms)
  t.mock.timers.tick(0)
}

// A single mock tick schedules nested timers from its end time, which looks
// like a suspension. Run the app in steps no longer than the helper's tick.
function run(t, ms) {
  for (let left = ms; left > 0; left -= 500) t.mock.timers.tick(Math.min(500, left))
}

test('active timeouts expire after their running time', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  let fired = 0
  setActiveTimeout(() => fired++, 5000)
  run(t, 4999)
  assert.equal(fired, 0)
  run(t, 1)
  assert.equal(fired, 1)
})

test('active timeouts do not count time the app was suspended', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  let fired = 0
  setActiveTimeout(() => fired++, 5000)
  run(t, 2000)
  // The overdue tick counts as one interval.
  suspend(t, 10 * 60 * 1000)
  assert.equal(fired, 0)
  run(t, 1999)
  assert.equal(fired, 0)
  run(t, 1)
  assert.equal(fired, 1)
})

test('cancelled active timeouts never fire', t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  let fired = 0
  setActiveTimeout(() => fired++, 5000)()
  run(t, 10000)
  assert.equal(fired, 0)
})

test('background jobs survive the app being suspended while they run', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 })
  let finish
  const jobs = new BackgroundJobClient(() => {
    const listeners = new Map()
    return {
      terminate() {},
      addEventListener: (type, listener) => listeners.set(type, listener),
      postMessage(message) {
        if (message.type !== 'run') return
        finish = () => {
          listeners.get('message')({ data: { type: 'value', id: message.id, path: [], value: 'done' } })
          listeners.get('message')({ data: { type: 'done', id: message.id } })
        }
      },
    }
  })
  try {
    const result = jobs.run('clone', { value: [] })
    for (let i = 0; i < 20 && !finish; i++) await Promise.resolve()
    run(t, 10000)
    suspend(t, 5 * 60 * 1000)
    finish()
    assert.equal(await result, 'done')
  } finally { jobs.dispose() }
})

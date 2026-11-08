import assert from 'node:assert/strict'
import test from 'node:test'

test('player extraction does not queue behind other background jobs', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] })
  const workers = []
  globalThis.Worker = class {
    constructor(url, options) {
      this.url = String(url)
      this.options = options
      this.operations = []
      workers.push(this)
    }

    postMessage(message) {
      if (message.type === 'run') this.operations.push(message.operation)
    }

    addEventListener() {}
    terminate() {}
  }
  t.after(() => { delete globalThis.Worker })
  const { runWorkerJob } = await import('../../src/renderer/helpers/background-job-platform.js')

  runWorkerJob('mergeHistory', { local: [], remote: [] })
  runWorkerJob('stringify', { value: [] })
  runWorkerJob('extractPlayer', { source: '', playerId: 'player' })
  // Sending an input yields to other tasks after a few milliseconds.
  for (let step = 0; step < 20 && workers.flatMap(worker => worker.operations).length < 3; step++) {
    t.mock.timers.tick(5)
    await new Promise(resolve => setImmediate(resolve))
  }

  assert.equal(workers.length, 2)
  assert.ok(workers.every(worker => worker.url.endsWith('/background-job-worker.js')))
  assert.deepEqual(workers.map(worker => worker.operations.toSorted()), [['mergeHistory', 'stringify'], ['extractPlayer']])
})
